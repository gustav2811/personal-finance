-- Finish the v1 experience seams the member client cannot invent:
-- the saved review decision, and one transaction for publish-plus-movement.

create or replace function public.budget_get_source_review_v1(
  p_transaction_id text default null,
  p_utility_entry_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  h uuid;
  live finance.budget_allocation_sets%rowtype;
  components jsonb := '[]'::jsonb;
  trail jsonb := '[]'::jsonb;
  hop finance.budget_allocation_sets%rowtype;
  guard integer := 0;
begin
  h := finance.budget_reader_household();
  if (p_transaction_id is null) = (p_utility_entry_id is null) then
    perform finance.budget_fail('budget_invalid', 'exactly one source');
  end if;
  select * into live
  from finance.budget_allocation_sets s
  where s.household_id = h
    and s.status in ('current', 'needs_review')
    and (
      (p_transaction_id is not null and s.transaction_id = p_transaction_id)
      or (p_utility_entry_id is not null and s.utility_entry_id = p_utility_entry_id)
    )
  order by s.revision_number desc, s.id desc
  limit 1;
  if not found then
    return jsonb_build_object(
      'calculation_version', 'household-budget-v1',
      'household_id', h::text,
      'as_of', statement_timestamp(),
      'found', false,
      'status', null,
      'provisional', false,
      'components', '[]'::jsonb,
      'trail', '[]'::jsonb
    );
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'allocation_id', a.id::text,
    'amount_cents', a.amount_cents::text,
    'effect_kind', a.effect_kind,
    'fund_id', a.fund_id,
    'beneficiary_scope', a.beneficiary_scope,
    'beneficiary_member_id', a.beneficiary_member_id,
    'paid_by_member_id', a.paid_by_member_id,
    'category_name_snapshot', a.category_name_snapshot,
    'original_refund_allocation_id', a.original_refund_allocation_id
  ) order by a.ordinal), '[]'::jsonb)
  into components
  from finance.budget_allocations a
  where a.household_id = h and a.set_id = live.id;
  hop := live;
  while hop.supersedes_id is not null and guard < 20 loop
    guard := guard + 1;
    trail := trail || jsonb_build_array(jsonb_build_object(
      'set_id', hop.id::text,
      'supersedes_id', hop.supersedes_id::text,
      'revision_number', hop.revision_number,
      'status', hop.status
    ));
    select * into hop from finance.budget_allocation_sets where household_id = h and id = hop.supersedes_id;
    if not found then exit; end if;
  end loop;
  return jsonb_build_object(
    'calculation_version', 'household-budget-v1',
    'household_id', h::text,
    'as_of', statement_timestamp(),
    'found', true,
    'set_id', live.id::text,
    'status', live.status,
    'provisional', live.status = 'needs_review',
    'source_amount_cents', live.source_amount_cents::text,
    'source_fingerprint', live.source_fingerprint,
    'transaction_id', live.transaction_id,
    'utility_entry_id', live.utility_entry_id,
    'components', components,
    'trail', trail
  );
end $$;

create or replace function public.budget_publish_with_movement_v1(p_command_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  canonical jsonb;
  replay jsonb;
  published jsonb;
  moved jsonb;
  movement jsonb;
  publish_id uuid;
  move_id uuid;
begin
  perform finance.budget_validate_object(p_payload, array['publish_command_id', 'move_command_id', 'publish', 'movement'], array[]::text[]);
  publish_id := finance.budget_uuid(p_payload, 'publish_command_id');
  move_id := finance.budget_uuid(p_payload, 'move_command_id');
  if publish_id = p_command_id or move_id = p_command_id or publish_id = move_id then
    perform finance.budget_fail('budget_invalid', 'command');
  end if;
  if jsonb_typeof(p_payload->'publish') <> 'object' or jsonb_typeof(p_payload->'movement') <> 'object' then
    perform finance.budget_fail('budget_invalid', 'payload');
  end if;
  canonical := jsonb_build_object(
    'publish_command_id', publish_id::text,
    'move_command_id', move_id::text,
    'publish', p_payload->'publish',
    'movement', p_payload->'movement'
  );
  replay := finance.budget_begin_command(p_command_id, 'budget_publish_with_movement_v1', canonical);
  if replay is not null then return replay; end if;
  published := public.budget_publish_v1(publish_id, p_payload->'publish');
  movement := p_payload->'movement' || jsonb_build_object('expected_version_id', published->>'version_id');
  moved := public.budget_move_funds_v1(move_id, movement);
  return finance.budget_finish_command(
    p_command_id,
    'budget_publish_with_movement_v1',
    canonical,
    jsonb_build_object('published', published, 'movement', moved)
  );
end $$;

create or replace function public.budget_list_devices_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  h uuid;
  devices jsonb;
begin
  h := finance.budget_reader_household();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', d.id::text,
    'name', d.name,
    'utility_type', d.utility_type
  ) order by d.name, d.id), '[]'::jsonb)
  into devices
  from consumption.devices d
  where d.household_id = h;
  return jsonb_build_object(
    'calculation_version', 'household-budget-v1',
    'household_id', h::text,
    'as_of', statement_timestamp(),
    'devices', devices
  );
end $$;

revoke all on function public.budget_get_source_review_v1(text, uuid) from public, anon, service_role;
revoke all on function public.budget_publish_with_movement_v1(uuid, jsonb) from public, anon, service_role;
revoke all on function public.budget_list_devices_v1() from public, anon, service_role;
grant execute on function public.budget_get_source_review_v1(text, uuid) to authenticated;
grant execute on function public.budget_publish_with_movement_v1(uuid, jsonb) to authenticated;
grant execute on function public.budget_list_devices_v1() to authenticated;
