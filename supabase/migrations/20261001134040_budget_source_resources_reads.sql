-- Stage 3: source drift and provisional member reads.
-- The source engine is supplied by 20261001134001.  This migration keeps the
-- stage 2 public signatures and augments their JSON contracts additively.

create or replace function finance.budget_resources(
  p_household uuid, p_asof timestamptz
)
returns jsonb
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare
  v_rec record;
  v_state jsonb;
  v_exposure jsonb;
  v_accounts jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_cash numeric := 0;
  v_debt numeric := 0;
  v_observation_known boolean := true;
  v_hard_uncertainty boolean := false;
  v_reasons jsonb := '[]'::jsonb;
  v_complete boolean := false;
  v_provisional_known boolean := false;
  v_net numeric;
  v_provisional_net numeric;
begin
  select r.* into v_rec
  from finance.budget_reconciliations r
  where r.household_id = p_household and r.as_of <= p_asof
  order by r.as_of desc, r.recorded_at desc, r.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'reconciliation_id', null,
      'reconciliation_fingerprint', null,
      'complete', false,
      'reasons', jsonb_build_array(jsonb_build_object('code','reconciliation_missing')),
      'net_liquid_cents', null,
      'provisional_net_liquid_cents', null,
      'provisional_fund_deltas', '{}'::jsonb,
      'restricted_resources', '[]'::jsonb,
      'accounts', '[]'::jsonb,
      'pending_adjustments', '[]'::jsonb
    );
  end if;

  v_state := finance.budget_reconciliation_state(p_household, v_rec.id, p_asof);
  v_reasons := coalesce(v_state->'reasons', '[]'::jsonb);

  -- The reconciliation snapshot is the only authoritative observed balance.
  -- Missing or malformed values remain unknown; they are never treated as zero.
  for v_entry in select value from jsonb_array_elements(
    coalesce(v_rec.coverage_snapshot->'accounts', '[]'::jsonb)
  ) loop
    v_accounts := v_accounts || jsonb_build_array(v_entry);
    if coalesce(v_entry->>'status','') = 'included' then
      if (v_entry->'settings_snapshot'->>'resource_class') = 'liquid' then
        if v_entry->>'normalized_cash_cents' is null then
          v_observation_known := false;
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
            'code','resource_balance_unknown','account_id',v_entry->>'account_id'));
        else
          v_cash := v_cash + (v_entry->>'normalized_cash_cents')::numeric;
        end if;
      elsif (v_entry->'settings_snapshot'->>'resource_class') = 'card' then
        if v_entry->>'normalized_debt_cents' is null then
          v_observation_known := false;
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
            'code','resource_balance_unknown','account_id',v_entry->>'account_id'));
        else
          v_debt := v_debt + (v_entry->>'normalized_debt_cents')::numeric;
        end if;
      elsif (v_entry->'settings_snapshot'->>'resource_class') in ('restricted','mortgage') then
        v_hard_uncertainty := true;
      elsif coalesce(v_entry->>'status','') = 'included' then
        v_hard_uncertainty := true;
      end if;
      if v_entry->'settings_snapshot' is null
         or v_entry->'snapshot_snapshot' is null then
        v_hard_uncertainty := true;
      end if;
    end if;
  end loop;

  v_exposure := finance.budget_source_exposure(
    p_household, v_rec.coverage_snapshot, p_asof);
  v_reasons := v_reasons || coalesce(v_exposure->'reasons','[]'::jsonb);

  -- The source engine owns all live-source examination and identity collapse.
  -- Re-checking broad historical rows here would debit pre-cutover activity,
  -- and would count confirmed pending/posting mirrors a second time.
  -- State and exposure may report the same bounded fact through two layers.
  -- Deduplicate with the JSON itself as a final key for stable output.
  select coalesce(jsonb_agg(value order by value->>'code', value->>'account_id',
    value->>'transaction_id', value->>'set_id', value::text), '[]'::jsonb)
    into v_reasons
  from (select distinct value from jsonb_array_elements(v_reasons)) q;
  -- Only a small set of reasons proves conservative arithmetic despite an
  -- incomplete read. Every other (including newly added) reason is unknown
  -- until the engine explicitly models it, so it must not expose a total.
  if exists (
    select 1 from jsonb_array_elements(v_reasons) x
    where x->>'code' not in (
      'allocation_needs_review',
      'pending_activity_provisional',
      'purpose_exposure_unresolved',
      'source_allocation_stale'
    )
  ) then
    v_hard_uncertainty := true;
  end if;
  if coalesce((v_exposure->>'provisional_known')::boolean,false)
     and v_observation_known and not v_hard_uncertainty then
    v_provisional_known := true;
  end if;

  v_complete := coalesce((v_state->>'status') = 'complete', false)
    and coalesce((v_exposure->>'complete')::boolean, false)
    and jsonb_array_length(v_reasons) = 0;
  if v_complete then
    v_net := finance.budget_checked_bigint(v_cash - v_debt
      + coalesce((v_exposure->>'resource_delta_cents')::numeric,0));
  end if;
  if v_provisional_known and v_exposure->>'resource_delta_cents' is not null then
    v_provisional_net := finance.budget_checked_bigint(v_cash - v_debt
      + (v_exposure->>'resource_delta_cents')::numeric);
  end if;

  return jsonb_build_object(
    'reconciliation_id',v_rec.id::text,
    'reconciliation_fingerprint',v_state->>'reconciliation_fingerprint',
    'complete',v_complete,
    'reasons',v_reasons,
    'net_liquid_cents',case when v_net is null then null else v_net::text end,
    'provisional_net_liquid_cents',case when v_provisional_net is null then null else v_provisional_net::text end,
    'provisional_fund_deltas',case when v_provisional_known
      then coalesce(v_exposure->'fund_deltas','{}'::jsonb) else null end,
    'restricted_resources','[]'::jsonb,
    'accounts',v_accounts,
    'pending_adjustments',coalesce(v_exposure->'adjustments','[]'::jsonb)
  );
end;
$$;

-- Preserve the already reviewed stage 2 implementations as private compatibility
-- bodies. The public wrappers below retain their exact signatures and grants.
alter function public.budget_get_overview_v1(date,timestamptz)
  set schema finance;
alter function finance.budget_get_overview_v1(date,timestamptz)
  rename to budget_get_overview_v1_legacy;
alter function public.budget_get_fund_v1(uuid,date,date,text,integer)
  set schema finance;
alter function finance.budget_get_fund_v1(uuid,date,date,text,integer)
  rename to budget_get_fund_v1_legacy;

create or replace function public.budget_get_overview_v1(
  p_cycle_start date, p_as_of timestamptz default now()
)
returns jsonb language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare
  v jsonb;
  r jsonb;
  v_fund jsonb;
  v_id text;
  v_delta numeric;
  v_claims numeric;
  v_net numeric;
begin
  -- Keep the legacy validation order (including request authentication) before
  -- adding stage 3 fields. This preserves the stage 2 error contract.
  v := finance.budget_get_overview_v1_legacy(p_cycle_start,p_as_of);
  r := v->'provenance'->'resources';
  v_net := nullif(r->>'provisional_net_liquid_cents','')::numeric;
  v_claims := nullif(v->>'net_claims_cents','')::numeric;
  v_fund := coalesce(v->'funds','[]'::jsonb);
  select coalesce(jsonb_agg(
    x || jsonb_build_object('provisional_available_cents',
      case when r->>'provisional_net_liquid_cents' is null then null
        else finance.budget_checked_bigint((x->>'balance_cents')::numeric + coalesce(
          (r->'provisional_fund_deltas'->>(x->>'fund_id'))::numeric,0))::text end)
    order by ord),'[]'::jsonb)
    into v_fund
  from jsonb_array_elements(v_fund) with ordinality q(x,ord);
  return v || jsonb_build_object(
    'funds',v_fund,
    'provisional_net_liquid_cents',case when v_net is null then null else v_net::text end,
    'provisional_net_claims_cents',case when v_net is null then null else
      finance.budget_checked_bigint(coalesce(v_claims,0) + coalesce((
        select sum(value::numeric) from jsonb_each_text(coalesce(r->'provisional_fund_deltas','{}'::jsonb))
      ),0))::text end,
    'provisional_unassigned_cents',case when v_net is null then null else
      finance.budget_checked_bigint(v_net - coalesce(v_claims,0) - coalesce((
        select sum(value::numeric) from jsonb_each_text(coalesce(r->'provisional_fund_deltas','{}'::jsonb))
      ),0))::text end,
    'pending_adjustments',coalesce(r->'pending_adjustments','[]'::jsonb));
end;
$$;

create or replace function public.budget_get_fund_v1(
  p_fund_id uuid, p_from date, p_to date, p_cursor text default null,
  p_limit integer default 50
)
returns jsonb language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare
  v jsonb;
  r jsonb;
  d numeric;
begin
  v := finance.budget_get_fund_v1_legacy(p_fund_id,p_from,p_to,p_cursor,p_limit);
  -- The legacy detail body has already bounded the balance at this exact as_of.
  r := finance.budget_resources(finance.budget_reader_household(),
    (v->>'as_of')::timestamptz);
  d := case when r->>'provisional_net_liquid_cents' is null then null
    else coalesce(nullif(r->'provisional_fund_deltas'->>p_fund_id::text,'')::numeric,0) end;
  return v || jsonb_build_object(
    'provisional_available_cents',case when d is null then null else
      finance.budget_checked_bigint((v->'balances'->>'balance_cents')::numeric + d)::text end,
    'source_adjustments',coalesce((select jsonb_agg(x order by x->>'transaction_id')
      from jsonb_array_elements(coalesce(r->'pending_adjustments','[]'::jsonb)) x
      where x->'fund_deltas' ? p_fund_id::text),'[]'::jsonb));
end;
$$;

revoke all on function finance.budget_resources(uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_get_overview_v1_legacy(date,timestamptz),
  finance.budget_get_fund_v1_legacy(uuid,date,date,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.budget_get_overview_v1(date,timestamptz),
  public.budget_get_fund_v1(uuid,date,date,text,integer) from public,anon,service_role;
grant execute on function public.budget_get_overview_v1(date,timestamptz),
  public.budget_get_fund_v1(uuid,date,date,text,integer) to authenticated;
notify pgrst, 'reload schema';
