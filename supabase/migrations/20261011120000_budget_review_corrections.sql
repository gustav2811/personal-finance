-- Member reads the review queue and fund detail already have, plus the
-- missing live source amount and plan line, and one transaction for a
-- publish that also moves money.

alter function public.budget_get_review_queue_v1(text, integer) set schema finance;
alter function finance.budget_get_review_queue_v1(text, integer) rename to budget_get_review_queue_v1_stage5;

create or replace function public.budget_get_review_queue_v1(p_cursor text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  base jsonb;
  h uuid;
  items jsonb := '[]'::jsonb;
  entry jsonb;
  tx text;
  utility uuid;
  snap jsonb;
  live text;
begin
  base := finance.budget_get_review_queue_v1_stage5(p_cursor, p_limit);
  h := nullif(base->>'household_id', '')::uuid;
  if h is null then perform finance.budget_fail('budget_forbidden', 'household'); end if;
  for entry in select value from jsonb_array_elements(coalesce(base->'items', '[]'::jsonb)) loop
    tx := nullif(entry->>'source_transaction_id', '');
    utility := nullif(entry->>'utility_entry_id', '')::uuid;
    live := null;
    snap := null;
    if tx is not null then
      begin
        snap := finance.budget_source_snapshot(h, tx);
        live := snap->>'amount_cents';
      exception when others then
        live := null;
      end;
    elsif utility is not null then
      begin
        snap := finance.budget_utility_snapshot(h, utility);
        live := coalesce(snap->>'signed_amount_cents', snap->>'amount_cents');
      exception when others then
        live := null;
      end;
    end if;
    if live is not null then
      entry := jsonb_set(
        entry,
        '{provenance}',
        coalesce(entry->'provenance', '{}'::jsonb) || jsonb_build_object(
          'live_source_amount_cents', live,
          'source_snapshot', coalesce(entry->'provenance'->'source_snapshot', '{}'::jsonb) || jsonb_build_object('amount_cents', live)
        ),
        true
      );
    end if;
    items := items || jsonb_build_array(entry);
  end loop;
  return base || jsonb_build_object('items', items, 'entries', items);
end $$;

alter function public.budget_get_fund_v1(uuid, date, date, text, integer) set schema finance;
alter function finance.budget_get_fund_v1(uuid, date, date, text, integer) rename to budget_get_fund_v1_stage5;

create or replace function public.budget_get_fund_v1(
  p_fund_id uuid,
  p_from date,
  p_to date,
  p_cursor text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v jsonb;
  h uuid;
  asof timestamptz;
  plan_id uuid;
  line jsonb;
begin
  v := finance.budget_get_fund_v1_stage5(p_fund_id, p_from, p_to, p_cursor, p_limit);
  h := finance.budget_reader_household();
  asof := nullif(v->>'as_of', '')::timestamptz;
  if asof is null then perform finance.budget_fail('budget_invalid', 'fund as_of'); end if;
  select nullif(finance.budget_plan_versions(
    h,
    finance.budget_cycle_start((asof at time zone 'Africa/Johannesburg')::date),
    asof
  )->>'current_version_id', '')::uuid into plan_id;
  select jsonb_build_object(
    'funding_behaviour', l.funding_behaviour,
    'target_cents', case when l.target_cents is null then null else l.target_cents::text end,
    'due_on', l.due_on,
    'contribution_cents', l.contribution_cents::text,
    'kind', l.kind,
    'recurrence', l.recurrence
  )
  into line
  from finance.budget_lines l
  where l.household_id = h and l.fund_id = p_fund_id and l.version_id = plan_id;
  return v || jsonb_build_object('plan_line', line);
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

revoke all on function finance.budget_get_review_queue_v1_stage5(text, integer) from public, anon, authenticated, service_role;
revoke all on function finance.budget_get_fund_v1_stage5(uuid, date, date, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.budget_get_review_queue_v1(text, integer) from public, anon, service_role;
revoke all on function public.budget_get_fund_v1(uuid, date, date, text, integer) from public, anon, service_role;
revoke all on function public.budget_publish_with_movement_v1(uuid, jsonb) from public, anon, service_role;
grant execute on function public.budget_get_review_queue_v1(text, integer) to authenticated;
grant execute on function public.budget_get_fund_v1(uuid, date, date, text, integer) to authenticated;
grant execute on function public.budget_publish_with_movement_v1(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
