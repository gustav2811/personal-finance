-- A pending authorisation is a reservation, not an unresolved reconciliation.
-- The source engine continues to prove amount, identity, sign, source time and
-- balance reflection.  This migration only permits the already-proved pending
-- case to be usable by the working budget; every other source reason remains a
-- hard block.

-- A category match alone is not enough for a member-owned purpose.  Pending
-- reservations may use a shared line, or the line belonging to the account's
-- configured member.  This keeps a Gustav purpose from consuming Cara's
-- budget merely because their categories happen to share a name.
do $migration$
declare
  v_sql text;
  v_old constant text :=
    'and l.match_category_id=category and l.kind=line_kind;';
  v_new constant text := $matcher$
and l.match_category_id=category and l.kind=line_kind
            and (l.beneficiary_scope='shared'
              or l.beneficiary_member_id=nullif(a->'settings_snapshot'->>'owner_member_id','')::uuid);$matcher$;
begin
  select pg_get_functiondef(
    'finance.budget_source_exposure_stage4(uuid,jsonb,timestamp with time zone,date,boolean)'::regprocedure
  ) into v_sql;
  if position(v_old in v_sql) = 0 then
    raise exception 'budget pending reservation invariant failed: plan matcher missing';
  end if;
  v_sql := replace(v_sql, v_old, v_new);
  execute v_sql;
end $migration$;

-- A same-provider pending row may settle before the user has had a chance to
-- create its posted allocation.  Preserve the proved reservation through that
-- narrow lifecycle transition.  The existing source identity checks still
-- reject a changed amount, account, provider identity, missing row, or an
-- ambiguous matching debit.
do $migration$
declare
  v_sql text;
  v_old text;
  v_new text;
begin
  select pg_get_functiondef(
    'finance.budget_source_exposure_stage4(uuid,jsonb,timestamp with time zone,date,boolean)'::regprocedure
  ) into v_sql;
  v_old := 'prior_unreflected boolean; observed_at timestamptz;';
  v_new := 'prior_unreflected boolean; pending_reservation boolean; observed_at timestamptz;';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: lifecycle declaration missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := 'prior_unreflected := false;';
  v_new := 'prior_unreflected := false; pending_reservation := false;';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: lifecycle initializer missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := E'if prior_unreflected then\n        observed := false;';
  v_new := E'if prior_unreflected then\n        observed := false; pending_reservation := true;';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: unreflected transition missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := E'        observed := t.id = any(included);\n      elsif finance.budget_effective_source_pending(p_household,t) is true then';
  v_new := E'        observed := t.id = any(included); pending_reservation := true;\n      elsif finance.budget_effective_source_pending(p_household,t) is true then';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: settled transition missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := E'      if finance.budget_effective_source_pending(p_household,t) is true then\n        reasons := reasons || jsonb_build_array(jsonb_build_object(''code'',''pending_activity_provisional'',''account_id'',a->>''account_id'',''transaction_id'',t.id));\n      end if;';
  v_new := E'      if finance.budget_effective_source_pending(p_household,t) is true then\n        reasons := reasons || jsonb_build_array(jsonb_build_object(''code'',''pending_activity_provisional'',''account_id'',a->>''account_id'',''transaction_id'',t.id));\n      elsif pending_reservation then\n        reasons := reasons || jsonb_build_array(jsonb_build_object(''code'',''posted_awaiting_allocation'',''account_id'',a->>''account_id'',''transaction_id'',t.id));\n      end if;';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: pending reason missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := 'if finance.budget_effective_source_pending(p_household,t) and cents < 0 and';
  v_new := 'if (finance.budget_effective_source_pending(p_household,t) or pending_reservation) and cents < 0 and';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: fund reservation condition missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := '      elsif cents < 0 and (p_opening_cutover is null or t.occurred_on is null';
  v_new := '      elsif cents < 0 and not pending_reservation and (p_opening_cutover is null or t.occurred_on is null';
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: unresolved-purpose condition missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_old := $kind$'kind',case when finance.budget_effective_source_pending(p_household,t) then 'pending' else 'posted_after_observation' end,$kind$;
  v_new := $kind$'kind',case when finance.budget_effective_source_pending(p_household,t) then 'pending' when pending_reservation then 'posted_awaiting_allocation' else 'posted_after_observation' end,$kind$;
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: adjustment kind missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  execute v_sql;
end $migration$;

create or replace function finance.budget_pending_only_state(
  p_household uuid,
  p_coverage jsonb,
  p_as_of timestamptz,
  p_reasons jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_reason jsonb;
  v_has_pending boolean := false;
  v_exposure jsonb;
begin
  v_exposure := finance.budget_source_exposure(p_household,p_coverage,p_as_of);
  if coalesce((v_exposure->>'provisional_known')::boolean,false) is not true then
    return false;
  end if;
  for v_reason in select value from jsonb_array_elements(coalesce(p_reasons,'[]'::jsonb)) loop
    if v_reason->>'code' in ('pending_activity_provisional','posted_awaiting_allocation') then
      v_has_pending := true;
    elsif v_reason->>'code' <> 'posted_awaiting_allocation' then
      return false;
    end if;
  end loop;
  return v_has_pending;
end $$;

-- This is deliberately a read model, never a movement or allocation.  It
-- gives funding commands the reserved version of a fund balance while ordinary
-- fund reads continue to report posted actuals separately.
create or replace function finance.budget_pending_fund_deltas(
  p_household uuid,
  p_asof date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_coverage jsonb;
  v_exposure jsonb;
  v_at timestamptz;
begin
  select coverage_snapshot into v_coverage
  from finance.budget_reconciliations
  where household_id=p_household and as_of <= statement_timestamp()
  order by as_of desc,recorded_at desc,id desc limit 1;
  if v_coverage is null then return '{}'::jsonb; end if;
  v_at := least(statement_timestamp(),
    ((p_asof + 1)::timestamp at time zone 'Africa/Johannesburg') - interval '1 microsecond');
  v_exposure := finance.budget_source_exposure(p_household,v_coverage,v_at);
  if coalesce((v_exposure->>'provisional_known')::boolean,false) is not true then
    return '{}'::jsonb;
  end if;
  return coalesce(v_exposure->'fund_deltas','{}'::jsonb);
end $$;

-- The command dispatcher opts in through a transaction-local setting.  The
-- stored balance definition stays posted-only for dashboard and audit reads.
do $migration$
declare
  v_sql text;
  v_old constant text := 'balance_cents:=finance.budget_checked_bigint(movement+allocation_delta);';
  v_new constant text := $body$
if current_setting('finance.include_pending_reservations',true)='on' then
      allocation_delta:=allocation_delta + coalesce((finance.budget_pending_fund_deltas(p_household,p_asof)->>f.id::text)::numeric,0);
    end if;
    balance_cents:=finance.budget_checked_bigint(movement+allocation_delta);$body$;
begin
  select pg_get_functiondef('finance.budget_fund_balances(uuid,date)'::regprocedure) into v_sql;
  if position(v_old in v_sql)=0 then
    raise exception 'budget pending reservation invariant failed: fund balance marker missing';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  execute v_sql;
end $migration$;

-- The existing movement commands retain their locking, receipt and earmark
-- behaviour.  This wrapper only makes their balance checks see the pending
-- reservations for the duration of the command transaction.
alter function public.budget_move_funds_v1(uuid,jsonb) set schema finance;
alter function finance.budget_move_funds_v1(uuid,jsonb) rename to budget_move_funds_v1_pending_dispatch;
create or replace function public.budget_move_funds_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
begin
  perform set_config('finance.include_pending_reservations','on',true);
  return finance.budget_move_funds_v1_pending_dispatch(p_command_id,p_payload);
end $$;

alter function public.budget_correct_movement_v1(uuid,jsonb) set schema finance;
alter function finance.budget_correct_movement_v1(uuid,jsonb) rename to budget_correct_movement_v1_pending_dispatch;
create or replace function public.budget_correct_movement_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
begin
  perform set_config('finance.include_pending_reservations','on',true);
  return finance.budget_correct_movement_v1_pending_dispatch(p_command_id,p_payload);
end $$;

-- Keep the existing restricted-resource discharge exactly as-is, then classify
-- a fully proved pending-only state as a working reconciliation.  The raw
-- diagnostics remain in warnings so the UI can still show the reservation.
create or replace function finance.budget_reconciliation_state(
  p_household uuid,
  p_reconciliation uuid,
  p_checked_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  state jsonb;
  r finance.budget_reconciliations%rowtype;
  reason jsonb;
  reasons jsonb := '[]'::jsonb;
  verified_all boolean := true;
  has_restricted boolean := false;
  pending_only boolean := false;
begin
  state := finance.budget_reconciliation_state_stage3(p_household,p_reconciliation,p_checked_at);
  select * into r from finance.budget_reconciliations
    where household_id=p_household and id=p_reconciliation;
  for reason in select value from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) loop
    if reason->'settings_snapshot'->>'resource_class' in ('restricted','mortgage') then
      has_restricted := true;
      if coalesce(reason->>'eligible_restricted_cents','') !~ '^[0-9]+$'
         or nullif(btrim(coalesce(reason->>'restricted_evidence','')),'') is null then
        verified_all := false;
      end if;
    end if;
  end loop;
  for reason in select value from jsonb_array_elements(coalesce(state->'reasons','[]'::jsonb)) loop
    if reason->>'code'='restricted_resources_unverified' and exists(
      select 1 from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) a
      where a->>'account_id'=reason->>'account_id'
        and a->'settings_snapshot'->>'resource_class' in ('restricted','mortgage')
        and coalesce(a->>'eligible_restricted_cents','') ~ '^[0-9]+$'
        and nullif(btrim(coalesce(a->>'restricted_evidence','')),'') is not null
    ) then continue; end if;
    if reason->>'code'='historic_incomplete' and has_restricted and verified_all then continue; end if;
    reasons := reasons || jsonb_build_array(reason);
  end loop;
  pending_only := finance.budget_pending_only_state(
    p_household,r.coverage_snapshot,p_checked_at,reasons
  );
  return state || jsonb_build_object(
    'status',case when jsonb_array_length(reasons)=0 or pending_only then 'complete' else 'incomplete' end,
    'reasons',case when pending_only then '[]'::jsonb else reasons end,
    'warnings',case when pending_only then reasons else '[]'::jsonb end,
    'posted_reconciliation_complete',jsonb_array_length(reasons)=0,
    'working_complete',jsonb_array_length(reasons)=0 or pending_only
  );
end $$;

-- `budget_resources_stage3` already has the correct conservative arithmetic:
-- pending debits not reflected in a balance reduce resources, while reflected
-- ones carry a zero resource delta.  Promote only the proved provisional total
-- to the working total and retain its fund deltas as visible reservations.
create or replace function finance.budget_resources(
  p_household uuid,
  p_asof timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  r jsonb;
  rec uuid;
  restricted jsonb := '[]'::jsonb;
  claims jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  reservations jsonb := '[]'::jsonb;
  pending_only boolean := false;
  exposure jsonb := '{}'::jsonb;
  entry jsonb;
  cash numeric := 0;
  debt numeric := 0;
  working_net bigint;
begin
  r := finance.budget_resources_stage3(p_household,p_asof);
  rec := nullif(r->>'reconciliation_id','')::uuid;
  if rec is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'account_id',x->>'account_id',
      'resource_class',x->'settings_snapshot'->>'resource_class',
      'eligible_restricted_cents',coalesce(x->>'eligible_restricted_cents',x->'observation'->>'eligible_restricted_cents'),
      'evidence',coalesce(x->>'restricted_evidence',x->'observation'->>'restricted_evidence')
    ) order by x->>'account_id'),'[]'::jsonb) into restricted
    from finance.budget_reconciliations q,
      lateral jsonb_array_elements(q.coverage_snapshot->'accounts') x
    where q.id=rec and x->'settings_snapshot'->>'resource_class' in ('restricted','mortgage');

    pending_only := finance.budget_pending_only_state(
      p_household,(select coverage_snapshot from finance.budget_reconciliations where id=rec),p_asof,r->'reasons'
    );
    exposure := finance.budget_source_exposure(
      p_household,(select coverage_snapshot from finance.budget_reconciliations where id=rec),p_asof
    );
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'fund_id',fund_id::text,
    'restricted_cents',restricted_cents::text,
    'liquid_cents',greatest(balance_cents-restricted_cents,0)::text
  ) order by fund_id),'[]'::jsonb) into claims
  from (
    select b.fund_id,b.restricted_cents,
      b.balance_cents + case when pending_only then
        coalesce((exposure->'fund_deltas'->>b.fund_id::text)::numeric,0)
      else 0 end as balance_cents
    from finance.budget_fund_balances(
      p_household,(p_asof at time zone 'Africa/Johannesburg')::date
    ) b
  ) b;
  if pending_only then
    for entry in select value from jsonb_array_elements(coalesce(r->'accounts','[]'::jsonb)) loop
      if entry->>'status'='included' and entry->'settings_snapshot'->>'resource_class'='liquid' then
        cash:=cash+(entry->>'normalized_cash_cents')::numeric;
      elsif entry->>'status'='included' and entry->'settings_snapshot'->>'resource_class'='card' then
        debt:=debt+(entry->>'normalized_debt_cents')::numeric;
      end if;
    end loop;
    working_net:=finance.budget_checked_bigint(cash-debt+(exposure->>'resource_delta_cents')::numeric);
    warnings := coalesce(r->'reasons','[]'::jsonb);
    select coalesce(jsonb_agg(x order by x->>'transaction_id'),'[]'::jsonb) into reservations
      from jsonb_array_elements(coalesce(r->'pending_adjustments','[]'::jsonb)) x
      where x->>'kind' in ('pending','posted_awaiting_allocation');
    r := r || jsonb_build_object(
      'complete',true,
      'working_complete',true,
      'posted_reconciliation_complete',coalesce((r->>'complete')::boolean,false),
      'reasons','[]'::jsonb,
      'warnings',warnings,
      'net_liquid_cents',working_net::text,
      'provisional_net_liquid_cents',working_net::text,
      'pending_reservations',reservations,
      'pending_fund_reservations',coalesce(exposure->'fund_deltas','{}'::jsonb),
      'provisional_fund_deltas',coalesce(exposure->'fund_deltas','{}'::jsonb)
    );
  else
    r := r || jsonb_build_object(
      'working_complete',coalesce((r->>'complete')::boolean,false),
      'posted_reconciliation_complete',coalesce((r->>'complete')::boolean,false),
      'warnings','[]'::jsonb,
      'pending_reservations','[]'::jsonb,
      'pending_fund_reservations','{}'::jsonb
    );
  end if;
  return r || jsonb_build_object('restricted_resources',restricted,'restricted_claims',claims);
end $$;

-- Make the reservation contract available at the top-level overview as well
-- as its provenance, so clients do not need to infer it from source rows.
alter function public.budget_get_overview_v1(date,timestamptz) set schema finance;
alter function finance.budget_get_overview_v1(date,timestamptz) rename to budget_get_overview_v1_pending_dispatch;
create or replace function public.budget_get_overview_v1(
  p_cycle_start date,p_as_of timestamptz default now()
)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare v jsonb; h uuid; r jsonb;
begin
  v:=finance.budget_get_overview_v1_pending_dispatch(p_cycle_start,p_as_of);
  h:=finance.budget_reader_household(); r:=finance.budget_resources(h,p_as_of);
  return v||jsonb_build_object(
    'complete',coalesce((r->>'complete')::boolean,false),
    'working_complete',coalesce((r->>'working_complete')::boolean,false),
    'posted_reconciliation_complete',coalesce((r->>'posted_reconciliation_complete')::boolean,false),
    'reasons',coalesce(r->'reasons','[]'::jsonb),
    'warnings',coalesce(r->'warnings','[]'::jsonb),
    'net_liquid_cents',r->'net_liquid_cents',
    'pending_reservations',coalesce(r->'pending_reservations','[]'::jsonb),
    'pending_fund_reservations',coalesce(r->'pending_fund_reservations','{}'::jsonb),
    'query_provenance',coalesce(v->'query_provenance','{}'::jsonb)||jsonb_build_object('resources',r)
  );
end $$;

revoke all on function finance.budget_pending_only_state(uuid,jsonb,timestamptz,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function finance.budget_pending_fund_deltas(uuid,date)
  from public,anon,authenticated,service_role;
revoke all on function finance.budget_source_exposure_stage4(uuid,jsonb,timestamptz,date,boolean)
  from public,anon,authenticated,service_role;
revoke all on function finance.budget_reconciliation_state(uuid,uuid,timestamptz),
  finance.budget_resources(uuid,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function finance.budget_move_funds_v1_pending_dispatch(uuid,jsonb),
  finance.budget_correct_movement_v1_pending_dispatch(uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.budget_move_funds_v1(uuid,jsonb),
  public.budget_correct_movement_v1(uuid,jsonb)
  from public,anon,service_role;
grant execute on function public.budget_move_funds_v1(uuid,jsonb),
  public.budget_correct_movement_v1(uuid,jsonb) to authenticated;
revoke all on function finance.budget_get_overview_v1_pending_dispatch(date,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.budget_get_overview_v1(date,timestamptz)
  from public,anon,service_role;
grant execute on function public.budget_get_overview_v1(date,timestamptz) to authenticated;

notify pgrst, 'reload schema';
