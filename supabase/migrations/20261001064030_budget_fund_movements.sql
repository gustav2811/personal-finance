-- PR2 packet D.  The command layer deliberately delegates all resource and
-- balance arithmetic to packet F; this file owns only command validation,
-- locking, and append-only movement history.

create or replace function finance.budget_movement_payload(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_kind text;
  v_from uuid;
  v_to uuid;
  v_amount bigint;
  v_effective date;
  v_reason text;
  v_occurrence text;
  v_occurrence_parts text[];
  v_occurrence_cycle date;
  v_occurrence_line uuid;
  v_occurrence_number bigint;
begin
  perform finance.budget_validate_object(
    p_value,
    array['kind','amount_cents','effective_on','expected_version_id',
          'expected_reconciliation_id','expected_reconciliation_fingerprint','reason'],
    array['from_fund_id','to_fund_id','funding_occurrence_key','earmarks']);

  v_kind := finance.budget_text(p_value, 'kind');
  v_from := finance.budget_uuid(p_value, 'from_fund_id', true);
  v_to := finance.budget_uuid(p_value, 'to_fund_id', true);
  v_amount := finance.budget_cents(p_value, 'amount_cents');
  v_effective := finance.budget_date(p_value, 'effective_on');
  v_reason := finance.budget_text(p_value, 'reason');
  v_occurrence := finance.budget_text(p_value, 'funding_occurrence_key', true);

  if v_kind not in ('opening','assign','release','reallocate') or v_amount <= 0 then
    perform finance.budget_fail('budget_invalid', 'invalid movement');
  end if;
  if (v_kind in ('opening','assign') and (v_from is not null or v_to is null))
     or (v_kind = 'release' and (v_from is null or v_to is not null))
     or (v_kind = 'reallocate' and (v_from is null or v_to is null or v_from = v_to)) then
    perform finance.budget_fail('budget_invalid', 'invalid movement endpoints');
  end if;
  if coalesce(p_value->'earmarks', '[]'::jsonb) <> '[]'::jsonb
     or jsonb_typeof(coalesce(p_value->'earmarks', '[]'::jsonb)) <> 'array' then
    perform finance.budget_fail('budget_incomplete', 'earmarks are unavailable until PR4');
  end if;
  if v_occurrence is not null then
    v_occurrence_parts := regexp_match(v_occurrence,
      '^cycle:([0-9]{4}-[0-9]{2}-[0-9]{2}):line:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}):occurrence:([0-9]+)$');
    if v_kind <> 'assign' or v_occurrence_parts is null then
      perform finance.budget_fail('budget_invalid', 'invalid funding_occurrence_key');
    end if;
    begin
      v_occurrence_cycle := v_occurrence_parts[1]::date;
      v_occurrence_line := v_occurrence_parts[2]::uuid;
      v_occurrence_number := v_occurrence_parts[3]::bigint;
    exception when others then
      perform finance.budget_fail('budget_invalid', 'invalid funding_occurrence_key');
    end;
    if v_occurrence_cycle::text <> v_occurrence_parts[1]
       or v_occurrence_number < 1 or v_occurrence_number > 9007199254740991 then
      perform finance.budget_fail('budget_invalid', 'invalid funding_occurrence_key');
    end if;
    v_occurrence := format('cycle:%s:line:%s:occurrence:%s',
      v_occurrence_cycle::text, v_occurrence_line::text, v_occurrence_number::text);
  end if;

  return jsonb_build_object(
    'kind', v_kind,
    'from_fund_id', case when v_from is null then null else v_from::text end,
    'to_fund_id', case when v_to is null then null else v_to::text end,
    'amount_cents', v_amount::text,
    'effective_on', v_effective::text,
    'expected_version_id', finance.budget_uuid(p_value, 'expected_version_id')::text,
    'expected_reconciliation_id', finance.budget_uuid(p_value, 'expected_reconciliation_id')::text,
    'expected_reconciliation_fingerprint', finance.budget_text(p_value, 'expected_reconciliation_fingerprint'),
    'reason', v_reason,
    'funding_occurrence_key', v_occurrence,
    'earmarks', '[]'::jsonb);
end;
$$;

create or replace function finance.budget_correction_payload(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_replacement jsonb;
  v_kind text;
  v_from uuid;
  v_to uuid;
  v_amount bigint;
  v_date date;
  v_version uuid;
begin
  perform finance.budget_validate_object(
    p_value,
    array['movement_id','expected_reconciliation_id','expected_reconciliation_fingerprint','reason'],
    array['replacement']);
  v_replacement := p_value->'replacement';
  if v_replacement is not null and v_replacement <> 'null'::jsonb then
    perform finance.budget_validate_object(v_replacement,
      array['kind','amount_cents','effective_on'],
      array['from_fund_id','to_fund_id','budget_version_id']);
    v_kind := finance.budget_text(v_replacement, 'kind');
    v_from := finance.budget_uuid(v_replacement, 'from_fund_id', true);
    v_to := finance.budget_uuid(v_replacement, 'to_fund_id', true);
    v_amount := finance.budget_cents(v_replacement, 'amount_cents');
    v_date := finance.budget_date(v_replacement, 'effective_on');
    v_version := finance.budget_uuid(v_replacement, 'budget_version_id', true);
    if v_kind not in ('opening','assign','release','reallocate') or v_amount <= 0
       or (v_kind in ('opening','assign') and (v_from is not null or v_to is null))
       or (v_kind = 'release' and (v_from is null or v_to is not null))
       or (v_kind = 'reallocate' and (v_from is null or v_to is null or v_from = v_to)) then
      perform finance.budget_fail('budget_invalid', 'invalid replacement');
    end if;
    v_replacement := jsonb_build_object('kind',v_kind,
      'from_fund_id',case when v_from is null then null else v_from::text end,
      'to_fund_id',case when v_to is null then null else v_to::text end,
      'amount_cents',v_amount::text,'effective_on',v_date::text,
      'budget_version_id',case when v_version is null then null else v_version::text end);
  else
    v_replacement := null;
  end if;
  return jsonb_build_object(
    'movement_id', finance.budget_uuid(p_value,'movement_id')::text,
    'expected_reconciliation_id', finance.budget_uuid(p_value,'expected_reconciliation_id')::text,
    'expected_reconciliation_fingerprint', finance.budget_text(p_value,'expected_reconciliation_fingerprint'),
    'reason', finance.budget_text(p_value,'reason'),
    'replacement', v_replacement);
end;
$$;

create or replace function finance.budget_lock_movement_context(p_household uuid, p_fund_ids uuid[])
returns void
language plpgsql
volatile
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
begin
  perform 1 from finance.households where id = p_household for update;
  perform 1 from public.accounts where household_id = p_household order by account_id for update;
  perform 1 from public.snapshots s join public.accounts a on a.account_id=s.account_id
    where a.household_id=p_household order by s.account_id,s.date for update of s;
  perform 1 from public.transactions where household_id=p_household order by account_id,id for update;
  perform 1 from finance.funds
    where household_id=p_household and id = any(p_fund_ids)
    order by id for update;
end;
$$;

create or replace function finance.budget_assert_movement_final(
  p_household uuid,
  p_as_of date,
  p_net_liquid bigint,
  p_delta jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_previous_positive numeric := 0;
  v_previous_net numeric := 0;
  v_final_positive numeric := 0;
  v_final_net numeric := 0;
  v_balance record;
  v_delta numeric;
begin
  for v_balance in select * from finance.budget_fund_balances(p_household,p_as_of) loop
    v_delta := coalesce((p_delta->>v_balance.fund_id::text)::numeric,0);
    v_previous_positive := v_previous_positive + greatest(v_balance.balance_cents::numeric,0);
    v_previous_net := v_previous_net + v_balance.balance_cents::numeric;
    v_final_positive := v_final_positive + greatest(v_balance.balance_cents::numeric + v_delta,0);
    v_final_net := v_final_net + v_balance.balance_cents::numeric + v_delta;
  end loop;
  -- Deltas may name a fund with no balance row only if it is not household-owned;
  -- ownership is checked before this helper runs.
  if v_final_positive > greatest(p_net_liquid::numeric,v_previous_positive) then
    perform finance.budget_fail('budget_invalid', 'movement would create unbacked positive claims');
  end if;
  if v_final_net > greatest(p_net_liquid::numeric,v_previous_net) then
    perform finance.budget_fail('budget_invalid', 'movement would create unbacked net claims');
  end if;
end;
$$;

create or replace function public.budget_move_funds_v1(p_command_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  p jsonb;
  v_replay jsonb;
  v_household uuid;
  v_actor uuid;
  v_resources jsonb;
  v_versions jsonb;
  v_cutover date;
  v_cycle date;
  v_from uuid;
  v_to uuid;
  v_amount bigint;
  v_movement uuid;
  v_source_balance bigint;
  v_available numeric;
  v_line uuid;
  v_occurrence_cycle date;
  v_today date;
  v_delta jsonb := '{}'::jsonb;
begin
  p := finance.budget_movement_payload(p_payload);
  v_replay := finance.budget_begin_command(p_command_id,'budget_move_funds_v1',p);
  if v_replay is not null then return v_replay; end if;
  set constraints all deferred;

  v_household := finance.resolve_caller_household();
  v_actor := finance.budget_actor_member(v_household);
  v_from := (p->>'from_fund_id')::uuid;
  v_to := (p->>'to_fund_id')::uuid;
  v_amount := (p->>'amount_cents')::bigint;
  v_today := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  perform finance.budget_lock_movement_context(v_household,array_remove(array[v_from,v_to],null));

  v_cutover := finance.budget_opening_cutover(v_household);
  if v_cutover is null then perform finance.budget_fail('budget_incomplete','opening fund cutover is missing'); end if;
  if (p->>'effective_on')::date < v_cutover or (p->>'effective_on')::date > v_today then
    perform finance.budget_fail('budget_invalid','effective_on is outside the established range');
  end if;
  v_cycle := finance.budget_cycle_start((p->>'effective_on')::date);
  v_versions := finance.budget_plan_versions(v_household,v_cycle,statement_timestamp());
  if v_versions->>'current_version_id' is null then perform finance.budget_fail('budget_incomplete','current plan is missing'); end if;
  if v_versions->>'current_version_id' is distinct from p->>'expected_version_id' then perform finance.budget_fail('budget_stale','plan version'); end if;
  v_resources := finance.budget_resources(v_household,statement_timestamp());
  if coalesce((v_resources->>'complete')::boolean,false) is not true or v_resources->>'net_liquid_cents' is null then perform finance.budget_fail('budget_incomplete','resources are incomplete'); end if;
  if v_resources->>'reconciliation_id' is distinct from p->>'expected_reconciliation_id'
     or v_resources->>'reconciliation_fingerprint' is distinct from p->>'expected_reconciliation_fingerprint' then perform finance.budget_fail('budget_stale','reconciliation'); end if;
  if exists (select 1 from finance.fund_earmarks where household_id=v_household and fund_id = any(array_remove(array[v_from,v_to],null))) then
    perform finance.budget_fail('budget_incomplete','earmarked funds are unavailable until PR4');
  end if;
  if (v_to is not null and not exists(select 1 from finance.funds where household_id=v_household and id=v_to and status='active'))
     or (v_from is not null and not exists(select 1 from finance.funds where household_id=v_household and id=v_from)) then
    perform finance.budget_fail('budget_not_found','fund');
  end if;
  if p->>'kind' = 'opening' then
    if (p->>'effective_on')::date <> v_cutover then perform finance.budget_fail('budget_invalid','opening must use cutover date'); end if;
    if exists(select 1 from finance.fund_movements where household_id=v_household and to_fund_id=v_to and kind='opening' and correction_role is null) then perform finance.budget_fail('budget_conflict','opening already exists'); end if;
  end if;
  if p->>'funding_occurrence_key' is not null then
    v_occurrence_cycle := substring(p->>'funding_occurrence_key' from '^cycle:([0-9]{4}-[0-9]{2}-[0-9]{2}):')::date;
    v_line := substring(p->>'funding_occurrence_key' from ':line:([0-9a-fA-F-]{36}):occurrence:')::uuid;
    if v_occurrence_cycle <> v_cycle or not exists(select 1 from finance.budget_lines where household_id=v_household and version_id=(p->>'expected_version_id')::uuid and stable_line_id=v_line and fund_id=v_to) then
      perform finance.budget_fail('budget_invalid','funding_occurrence_key does not match plan line');
    end if;
    if exists(select 1 from finance.fund_movements where household_id=v_household and funding_occurrence_key=p->>'funding_occurrence_key' and correction_role is null) then
      perform finance.budget_fail('budget_conflict','funding occurrence already exists');
    end if;
  end if;
  if p->>'kind' in ('release','reallocate') then
    select balance_cents into v_source_balance from finance.budget_fund_balances(v_household,v_today) where fund_id=v_from;
    if coalesce(v_source_balance,0) < v_amount then perform finance.budget_fail('budget_insufficient','source fund balance'); end if;
  else
    select (v_resources->>'net_liquid_cents')::numeric - coalesce(sum(balance_cents),0)::numeric into v_available from finance.budget_fund_balances(v_household,v_today);
    if greatest(v_available,0) < v_amount then perform finance.budget_fail('budget_insufficient','backed unassigned resources'); end if;
  end if;
  if v_from is not null then v_delta := v_delta || jsonb_build_object(v_from::text,(-v_amount)::text); end if;
  if v_to is not null then v_delta := v_delta || jsonb_build_object(v_to::text,v_amount::text); end if;
  perform finance.budget_assert_movement_final(v_household,v_today,(v_resources->>'net_liquid_cents')::bigint,v_delta);
  insert into finance.fund_movements(household_id,from_fund_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,budget_version_id,reconciliation_id,reason,funding_occurrence_key)
  values(v_household,v_from,v_to,v_amount,p->>'kind',(p->>'effective_on')::date,v_actor,p_command_id,(p->>'expected_version_id')::uuid,(p->>'expected_reconciliation_id')::uuid,p->>'reason',p->>'funding_occurrence_key') returning id into v_movement;
  p := p || jsonb_build_object('earmarks','[]'::jsonb);
  v_replay := finance.budget_finish_command(p_command_id,'budget_move_funds_v1',p,jsonb_build_object('movement_id',v_movement::text));
  set constraints all immediate;
  return v_replay;
end;
$$;

create or replace function public.budget_correct_movement_v1(p_command_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  p jsonb;
  v_replay jsonb;
  v_household uuid;
  v_actor uuid;
  v_original finance.fund_movements%rowtype;
  v_resources jsonb;
  v_cutover date;
  v_reversal_kind text;
  v_reversal uuid;
  v_replacement uuid;
  v_rep jsonb;
  v_rep_from uuid;
  v_rep_to uuid;
  v_rep_amount bigint;
  v_rep_version uuid;
  v_versions jsonb;
  v_delta jsonb := '{}'::jsonb;
begin
  p := finance.budget_correction_payload(p_payload);
  v_replay := finance.budget_begin_command(p_command_id,'budget_correct_movement_v1',p);
  if v_replay is not null then return v_replay; end if;
  set constraints all deferred;
  v_household := finance.resolve_caller_household();
  v_actor := finance.budget_actor_member(v_household);
  select * into v_original from finance.fund_movements where household_id=v_household and id=(p->>'movement_id')::uuid for update;
  if not found then perform finance.budget_fail('budget_not_found','movement'); end if;
  if v_original.correction_of is not null then
    perform finance.budget_fail('budget_invalid','correction must reference an original movement');
  end if;
  if exists(select 1 from finance.fund_movements where household_id=v_household and correction_of=v_original.id and correction_role='reversal') then
    perform finance.budget_fail('budget_conflict','movement is already corrected');
  end if;
  v_rep := p->'replacement';
  v_rep_from := case when v_rep is null then null else (v_rep->>'from_fund_id')::uuid end;
  v_rep_to := case when v_rep is null then null else (v_rep->>'to_fund_id')::uuid end;
  perform finance.budget_lock_movement_context(v_household,array_remove(array[v_original.from_fund_id,v_original.to_fund_id,v_rep_from,v_rep_to],null));
  v_resources := finance.budget_resources(v_household,statement_timestamp());
  if coalesce((v_resources->>'complete')::boolean,false) is not true or v_resources->>'net_liquid_cents' is null then perform finance.budget_fail('budget_incomplete','resources are incomplete'); end if;
  if v_resources->>'reconciliation_id' is distinct from p->>'expected_reconciliation_id' or v_resources->>'reconciliation_fingerprint' is distinct from p->>'expected_reconciliation_fingerprint' then perform finance.budget_fail('budget_stale','reconciliation'); end if;
  if exists(select 1 from finance.fund_earmarks where household_id=v_household and fund_id=any(array_remove(array[v_original.from_fund_id,v_original.to_fund_id,v_rep_from,v_rep_to],null))) then perform finance.budget_fail('budget_incomplete','earmarked funds are unavailable until PR4'); end if;
  v_cutover := finance.budget_opening_cutover(v_household);
  if v_cutover is null then perform finance.budget_fail('budget_incomplete','opening fund cutover is missing'); end if;
  if v_original.kind='opening' and v_rep is not null and ((v_rep->>'kind') <> 'opening' or (v_rep->>'effective_on')::date <> v_cutover) then perform finance.budget_fail('budget_invalid','opening replacement must preserve cutover semantics'); end if;
  if v_original.kind<>'opening' and v_rep is not null and v_rep->>'kind'='opening' then perform finance.budget_fail('budget_invalid','replacement cannot invent opening'); end if;
  if v_rep is not null then
    if (v_rep->>'effective_on')::date < v_cutover
       or (v_rep->>'effective_on')::date > (statement_timestamp() at time zone 'Africa/Johannesburg')::date then
      perform finance.budget_fail('budget_invalid','replacement effective_on is outside the established range');
    end if;
    if (v_rep_to is not null and not exists(select 1 from finance.funds where household_id=v_household and id=v_rep_to and status='active'))
       or (v_rep_from is not null and not exists(select 1 from finance.funds where household_id=v_household and id=v_rep_from)) then
      perform finance.budget_fail('budget_not_found','replacement fund');
    end if;
    if (v_rep->>'kind') = 'opening' and exists(
      select 1 from finance.fund_movements
      where household_id=v_household and to_fund_id=v_rep_to and kind='opening'
        and correction_role is null and id <> v_original.id
    ) then
      perform finance.budget_fail('budget_conflict','opening already exists');
    end if;
  end if;
  v_reversal_kind := case v_original.kind when 'opening' then 'release' when 'assign' then 'release' when 'release' then 'assign' else 'reallocate' end;
  if v_original.to_fund_id is not null then v_delta := v_delta || jsonb_build_object(v_original.to_fund_id::text,(-v_original.amount_cents)::text); end if;
  if v_original.from_fund_id is not null then v_delta := v_delta || jsonb_build_object(v_original.from_fund_id::text,v_original.amount_cents::text); end if;
  if v_rep is not null then
    v_rep_amount := (v_rep->>'amount_cents')::bigint;
    v_rep_version := coalesce((v_rep->>'budget_version_id')::uuid, (finance.budget_plan_versions(v_household,finance.budget_cycle_start((v_rep->>'effective_on')::date),statement_timestamp())->>'current_version_id')::uuid);
    v_versions := finance.budget_plan_versions(v_household,finance.budget_cycle_start((v_rep->>'effective_on')::date),statement_timestamp());
    if v_rep_version is null or v_rep_version::text is distinct from v_versions->>'current_version_id' then perform finance.budget_fail('budget_stale','plan version'); end if;
    if v_rep_from is not null then v_delta := v_delta || jsonb_build_object(v_rep_from::text,(coalesce((v_delta->>v_rep_from::text)::numeric,0)-v_rep_amount)::text); end if;
    if v_rep_to is not null then v_delta := v_delta || jsonb_build_object(v_rep_to::text,(coalesce((v_delta->>v_rep_to::text)::numeric,0)+v_rep_amount)::text); end if;
  end if;
  perform finance.budget_assert_movement_final(v_household,(statement_timestamp() at time zone 'Africa/Johannesburg')::date,(v_resources->>'net_liquid_cents')::bigint,v_delta);
  insert into finance.fund_movements(household_id,from_fund_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,budget_version_id,reconciliation_id,reason,correction_of,correction_role)
  values(v_household,v_original.to_fund_id,v_original.from_fund_id,v_original.amount_cents,v_reversal_kind,v_original.effective_on,v_actor,p_command_id,v_original.budget_version_id,(p->>'expected_reconciliation_id')::uuid,p->>'reason',v_original.id,'reversal') returning id into v_reversal;
  if v_rep is not null then
    insert into finance.fund_movements(household_id,from_fund_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,budget_version_id,reconciliation_id,reason,funding_occurrence_key,correction_of,correction_role)
    values(v_household,v_rep_from,v_rep_to,(v_rep->>'amount_cents')::bigint,v_rep->>'kind',(v_rep->>'effective_on')::date,v_actor,p_command_id,v_rep_version,(p->>'expected_reconciliation_id')::uuid,p->>'reason',v_original.funding_occurrence_key,v_original.id,'replacement') returning id into v_replacement;
  end if;
  v_replay := finance.budget_finish_command(p_command_id,'budget_correct_movement_v1',p,jsonb_build_object('reversal_movement_id',v_reversal::text,'replacement_movement_id',case when v_replacement is null then null else v_replacement::text end));
  set constraints all immediate;
  return v_replay;
end;
$$;

revoke all on function finance.budget_movement_payload(jsonb), finance.budget_correction_payload(jsonb), finance.budget_lock_movement_context(uuid,uuid[]), finance.budget_assert_movement_final(uuid,date,bigint,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.budget_move_funds_v1(uuid,jsonb), public.budget_correct_movement_v1(uuid,jsonb) from public, anon, service_role;
grant execute on function public.budget_move_funds_v1(uuid,jsonb), public.budget_correct_movement_v1(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
