-- Household budget PR2 packet F: deterministic calculations and member reads.

create or replace function finance.budget_checked_bigint(p_value numeric)
returns bigint
language plpgsql immutable set search_path = pg_temp set timezone = 'UTC' as $$
begin
  if p_value is null or p_value::text in ('NaN','Infinity','-Infinity')
     or p_value <> trunc(p_value)
     or p_value < -9223372036854775808::numeric
     or p_value > 9223372036854775807::numeric then
    perform finance.budget_fail('budget_invalid', 'numeric result is outside bigint');
  end if;
  return p_value::bigint;
end;
$$;

create or replace function finance.budget_reader_household()
returns uuid
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare v_household uuid; v_count bigint;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    perform finance.budget_fail('budget_forbidden', 'authenticated caller required');
  end if;
  select count(distinct household_id)
  into v_count
  from finance.household_members
  where auth_user_id = auth.uid();
  if v_count <> 1 then
    perform finance.budget_fail('budget_forbidden', 'bound household member required');
  end if;
  select household_id into v_household
  from finance.household_members
  where auth_user_id = auth.uid()
  order by household_id limit 1;
  return v_household;
end;
$$;

create or replace function finance.budget_cycle_start(p_date date)
returns date language sql immutable set search_path = pg_temp set timezone = 'UTC' as $$
  select case when extract(day from p_date) >= 23
    then make_date(extract(year from p_date)::int, extract(month from p_date)::int, 23)
    else (date_trunc('month', p_date::timestamp) - interval '1 month' + interval '22 days')::date
  end
$$;

create or replace function finance.budget_plan_versions(
  p_household uuid, p_cycle date, p_asof timestamptz
)
returns jsonb language sql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
with applicable as (
  select v.*, row_number() over (
    order by v.starts_on_cycle desc, v.version_number desc
  ) as current_rank
  from finance.budget_versions v
  where v.household_id = p_household and v.state = 'published'
    and v.starts_on_cycle <= p_cycle and v.published_at <= p_asof
), original as (
  select v.*, row_number() over (
    order by v.starts_on_cycle desc, v.version_number desc
  ) as original_rank
  from finance.budget_versions v
  where v.household_id = p_household and v.state = 'published'
    and v.starts_on_cycle <= p_cycle
    and v.published_at <= (p_cycle::timestamp at time zone 'Africa/Johannesburg')
), fallback as (
  select v.*, row_number() over (order by v.published_at, v.version_number) as fallback_rank
  from finance.budget_versions v
  where v.household_id = p_household and v.state = 'published'
    and v.starts_on_cycle <= p_cycle and v.published_at <= p_asof
)
select jsonb_build_object(
  'original_version_id', coalesce((select id::text from original where original_rank = 1),
    (select id::text from fallback where fallback_rank = 1)),
  'current_version_id', (select id::text from applicable where current_rank = 1)
)
$$;

create or replace function finance.budget_opening_cutover(p_household uuid)
returns date language sql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
  select r.opening_fund_cutover
  from finance.budget_reconciliations r
  where r.household_id = p_household and r.status = 'complete'
    and r.opening_fund_cutover is not null
  order by r.recorded_at, r.id
  limit 1
$$;

create or replace function finance.budget_fund_balances(
  p_household uuid, p_asof date
)
returns table(
  fund_id uuid, balance_cents bigint, assigned_cents bigint,
  outflow_cents bigint, refund_cents bigint, restricted_cents bigint
)
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare
  v_fund record; v_cutover date; v_movement numeric; v_assigned numeric;
  v_outflow numeric; v_refund numeric; v_alloc_delta numeric; v_delta numeric;
begin
  v_cutover := finance.budget_opening_cutover(p_household);
  for v_fund in select f.id from finance.funds f
    where f.household_id = p_household order by f.id loop
    select coalesce(sum(case when m.to_fund_id = v_fund.id then m.amount_cents
      when m.from_fund_id = v_fund.id then -m.amount_cents else 0 end), 0),
      coalesce(sum(case when m.to_fund_id = v_fund.id then m.amount_cents else 0 end), 0)
    into v_movement, v_assigned
    from finance.fund_movements m
    where m.household_id = p_household and m.effective_on <= p_asof
      and (m.to_fund_id = v_fund.id or m.from_fund_id = v_fund.id);
    select coalesce(sum(case when a.amount_cents < 0
      and a.effect_kind in ('consumption','contribution','required_debt_payment','extra_debt_payment')
      then -(a.amount_cents::numeric) else 0 end), 0),
      coalesce(sum(case when a.amount_cents > 0 and a.effect_kind = 'refund'
      then a.amount_cents else 0 end), 0)
    into v_outflow, v_refund
    from finance.budget_allocations a
    join finance.budget_allocation_sets s on s.household_id = a.household_id
      and s.id = a.set_id
    where a.household_id = p_household and a.fund_id = v_fund.id
      and s.occurred_on <= p_asof and s.status in ('current','needs_review')
      ;
    select coalesce(sum(a.amount_cents),0)
    into v_alloc_delta
    from finance.budget_allocations a
    join finance.budget_allocation_sets s on s.household_id = a.household_id
      and s.id = a.set_id
    where a.household_id = p_household and a.fund_id = v_fund.id
      and s.occurred_on <= p_asof and s.status in ('current','needs_review')
      and v_cutover is not null and s.occurred_on >= v_cutover;
    v_delta := v_movement + v_alloc_delta;
    fund_id := v_fund.id;
    balance_cents := finance.budget_checked_bigint(v_delta);
    assigned_cents := finance.budget_checked_bigint(v_movement);
    outflow_cents := finance.budget_checked_bigint(v_outflow);
    refund_cents := finance.budget_checked_bigint(v_refund);
    restricted_cents := 0;
    return next;
  end loop;
end;
$$;

create or replace function finance.budget_resources(
  p_household uuid, p_asof timestamptz
)
returns jsonb language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare
  v_rec record; v_state jsonb; v_accounts jsonb := '[]'::jsonb;
  v_entry jsonb; v_cash numeric := 0; v_debt numeric := 0; v_reasons jsonb;
  v_complete boolean := false; v_liquid bigint; v_set record; v_source jsonb;
begin
  select r.* into v_rec from finance.budget_reconciliations r
  where r.household_id = p_household and r.as_of <= p_asof
  order by r.as_of desc, r.recorded_at desc, r.id desc limit 1;
  if not found then
    return jsonb_build_object('reconciliation_id',null,'reconciliation_fingerprint',null,
      'complete',false,'reasons',jsonb_build_array(jsonb_build_object('code','reconciliation_missing')),
      'net_liquid_cents',null,'restricted_resources','[]'::jsonb,
      'accounts','[]'::jsonb,'pending_adjustments','[]'::jsonb);
  end if;
  v_state := finance.budget_reconciliation_state(p_household, v_rec.id, p_asof);
  v_reasons := coalesce(v_state->'reasons','[]'::jsonb);
  for v_set in select s.id, s.transaction_id, s.source_snapshot, s.source_fingerprint
    from finance.budget_allocation_sets s
    where s.household_id = p_household and s.status in ('current','needs_review')
      and s.transaction_id is not null loop
    begin
      v_source := finance.budget_source_snapshot(p_household, v_set.transaction_id::text);
      if v_source->>'source_fingerprint' is distinct from v_set.source_fingerprint then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code','source_allocation_stale','set_id',v_set.id::text));
      end if;
    exception when others then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','source_unverified','set_id',v_set.id::text));
    end;
  end loop;
  if exists (select 1 from finance.budget_allocation_sets s
    where s.household_id=p_household and s.status='needs_review') then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code','allocation_needs_review'));
  end if;
  if exists (select 1 from finance.budget_allocations a
    join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    where a.household_id=p_household and s.status in ('current','needs_review')
      and a.effect_kind='unresolved') then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
      'code','purpose_exposure_unresolved'));
  end if;
  for v_set in select t.id as transaction_id
    from public.transactions t
    join finance.budget_account_settings s on s.household_id=t.household_id
      and s.account_id=t.account_id and s.included
    where t.household_id=p_household and t.source_is_archived is distinct from true
      and (t.occurred_on is null or (t.occurred_on >= finance.budget_opening_cutover(p_household)
        and t.occurred_on <= (p_asof at time zone 'Africa/Johannesburg')::date))
      and not exists (select 1 from finance.budget_allocation_sets x
        where x.household_id=t.household_id and x.transaction_id=t.id
          and x.status in ('current','needs_review')) loop
    begin
      v_source := finance.budget_source_snapshot(p_household,v_set.transaction_id::text);
      if not coalesce((v_source->>'complete')::boolean,false)
         or v_source->>'amount_cents' is null then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code','source_unverified','transaction_id',v_set.transaction_id));
      elsif (v_source->>'amount_cents')::numeric < 0 then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
          'code','purpose_exposure_unresolved','transaction_id',v_set.transaction_id));
      end if;
    exception when others then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
        'code','source_unverified','transaction_id',v_set.transaction_id));
    end;
  end loop;
  for v_entry in select value from jsonb_array_elements(
    coalesce(v_state->'coverage_snapshot'->'accounts', v_rec.coverage_snapshot->'accounts')) loop
    v_accounts := v_accounts || jsonb_build_array(v_entry);
    if v_entry->>'status' = 'included' and v_entry->>'resource_class' is null then
      -- resource_class lives in the frozen settings snapshot in PR1b.
      if (v_entry->'settings_snapshot'->>'resource_class') = 'liquid' then
        if v_entry->>'normalized_cash_cents' is null then
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
            'code','resource_balance_unknown','account_id',v_entry->>'account_id'));
        else v_cash := v_cash + (v_entry->>'normalized_cash_cents')::numeric; end if;
      elsif (v_entry->'settings_snapshot'->>'resource_class') = 'card' then
        if v_entry->>'normalized_debt_cents' is null then
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object(
            'code','resource_balance_unknown','account_id',v_entry->>'account_id'));
        else v_debt := v_debt + (v_entry->>'normalized_debt_cents')::numeric; end if;
      end if;
    end if;
  end loop;
  v_complete := v_state->>'status' = 'complete' and jsonb_array_length(v_reasons) = 0;
  if v_complete then v_liquid := finance.budget_checked_bigint(v_cash - v_debt); end if;
  return jsonb_build_object('reconciliation_id',v_rec.id::text,
    'reconciliation_fingerprint',v_state->>'reconciliation_fingerprint',
    'complete',v_complete,'reasons',v_reasons,
    'net_liquid_cents',case when v_complete then v_liquid::text else null end,
    'restricted_resources','[]'::jsonb,'accounts',v_accounts,'pending_adjustments','[]'::jsonb);
end;
$$;

create or replace function finance.budget_target_suggestion(
  p_line jsonb, p_balance bigint, p_asof date
)
returns jsonb language plpgsql immutable
set search_path = pg_temp set timezone = 'UTC' as $$
declare v_short numeric; v_dates bigint; v_each numeric; v_due boolean := false;
  v_target bigint; v_due_on date; v_behaviour text;
begin
  v_behaviour := p_line->>'funding_behaviour';
  v_target := nullif(p_line->>'target_cents','')::bigint;
  v_due_on := nullif(p_line->>'due_on','')::date;
  if v_behaviour in ('target_by_date','reserve_target') and v_target is not null then
    v_short := greatest(v_target::numeric - greatest(coalesce(p_balance,0)::numeric,0), 0);
  else v_short := greatest(coalesce((p_line->>'contribution_cents')::numeric,0),0); end if;
  if v_behaviour = 'target_by_date' and v_due_on is not null then
    select count(*) into v_dates from generate_series(
      finance.budget_cycle_start(p_asof), v_due_on, interval '1 month') d
    where extract(day from d) = 23 and d::date >= p_asof;
    if v_dates = 0 then v_due := true; else v_each := ceil(v_short / v_dates); end if;
  else v_dates := 0; v_each := v_short; end if;
  return jsonb_build_object('shortfall_cents',finance.budget_checked_bigint(v_short)::text,
    'remaining_funding_dates',v_dates,
    'suggested_contribution_cents',finance.budget_checked_bigint(coalesce(v_each, v_short))::text,
    'due_now',v_due or (v_behaviour = 'reserve_target' and v_short > 0));
end;
$$;

create or replace function public.budget_get_overview_v1(
  p_cycle_start date, p_as_of timestamptz default now()
)
returns jsonb language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare h uuid; v_plan jsonb; v_original uuid; v_current uuid; v_resources jsonb;
  v_funds jsonb := '[]'::jsonb; v_row record; v_complete boolean; v_reasons jsonb := '[]'::jsonb;
  v_claims numeric := 0; v_positive numeric := 0; v_negative numeric := 0;
  v_contrib numeric := 0; v_income numeric := 0;
  v_plan_json jsonb; v_original_json jsonb; v_end date; v_net numeric;
begin
  if p_cycle_start is null or not isfinite(p_cycle_start)
     or extract(day from p_cycle_start) <> 23 then
    perform finance.budget_fail('budget_invalid','cycle_start must be day 23'); end if;
  if p_as_of is null or not isfinite(p_as_of) or p_as_of > statement_timestamp() then
    perform finance.budget_fail('budget_invalid','as_of must be finite and not in the future'); end if;
  h := finance.budget_reader_household();
  v_plan := finance.budget_plan_versions(h,p_cycle_start,p_as_of);
  v_original := nullif(v_plan->>'original_version_id','')::uuid;
  v_current := nullif(v_plan->>'current_version_id','')::uuid;
  v_end := (p_cycle_start + interval '1 month')::date;
  v_resources := finance.budget_resources(h,p_as_of);
  for v_row in select b.*, f.name, f.status, f.beneficiary_scope,
      f.beneficiary_member_id
    from finance.budget_fund_balances(h,(p_as_of at time zone 'Africa/Johannesburg')::date) b
    join finance.funds f on f.household_id=h and f.id=b.fund_id loop
    v_funds := v_funds || jsonb_build_array(jsonb_build_object(
      'fund_id',v_row.fund_id,'name',v_row.name,'status',v_row.status,
      'beneficiary_scope',v_row.beneficiary_scope,
      'beneficiary_member_id',v_row.beneficiary_member_id,
      'balance_cents',v_row.balance_cents::text,'assigned_cents',v_row.assigned_cents::text,
      'outflow_cents',v_row.outflow_cents::text,'refund_cents',v_row.refund_cents::text,
      'restricted_cents',v_row.restricted_cents::text,
      'planned_payer_member_id',(select l.planned_payer_member_id
        from finance.budget_lines l where l.household_id=h and l.version_id=v_current
          and l.fund_id=v_row.fund_id),
      'target_suggestion',(select finance.budget_target_suggestion(to_jsonb(l),v_row.balance_cents,
        (p_as_of at time zone 'Africa/Johannesburg')::date)
        from finance.budget_lines l where l.household_id=h and l.version_id=v_current
          and l.fund_id=v_row.fund_id)));
    v_claims := v_claims + v_row.balance_cents;
    v_positive := v_positive + greatest(v_row.balance_cents,0);
    v_negative := v_negative + greatest(-v_row.balance_cents,0);
  end loop;
  if v_current is not null then
    select coalesce(sum(l.contribution_cents),0)
    into v_contrib from finance.budget_lines l
    where l.household_id=h and l.version_id=v_current;
    select coalesce(sum((income.value->>'expected_net_cents')::numeric),0)
    into v_income from finance.budget_versions v
    left join lateral jsonb_array_elements(v.income_assumptions) income(value) on true
    where v.household_id=h and v.id=v_current;
    select jsonb_build_object('id',v.id::text,'version_number',v.version_number,
      'starts_on_cycle',v.starts_on_cycle,'published_at',v.published_at,
      'reason',v.reason,'calculation_version',v.calculation_version,
      'income_assumptions',v.income_assumptions,'source_references',v.source_references,
      'lines',coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
          'contribution_cents',l.contribution_cents::text,
          'target_cents',case when l.target_cents is null then null else l.target_cents::text end)
          order by l.id)
        from finance.budget_lines l where l.household_id=h and l.version_id=v.id),'[]'::jsonb))
    into v_plan_json from finance.budget_versions v where v.id=v_current;
  end if;
  if v_original is not null then
    select jsonb_build_object('id',v.id::text,'version_number',v.version_number,
      'starts_on_cycle',v.starts_on_cycle,'published_at',v.published_at,
      'reason',v.reason,'calculation_version',v.calculation_version,
      'income_assumptions',v.income_assumptions,'source_references',v.source_references,
      'lines',coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object(
          'contribution_cents',l.contribution_cents::text,
          'target_cents',case when l.target_cents is null then null else l.target_cents::text end)
          order by l.id)
        from finance.budget_lines l where l.household_id=h and l.version_id=v.id),'[]'::jsonb))
    into v_original_json from finance.budget_versions v where v.id=v_original;
  end if;
  v_complete := coalesce((v_resources->>'complete')::boolean,false)
    and v_current is not null and finance.budget_opening_cutover(h) is not null;
  if v_current is null then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','plan_missing')); end if;
  if finance.budget_opening_cutover(h) is null then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','cutover_missing')); end if;
  v_reasons := v_reasons || coalesce(v_resources->'reasons','[]'::jsonb);
  v_net := case when (v_resources->>'net_liquid_cents') is null then null
    else (v_resources->>'net_liquid_cents')::numeric end;
  return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,
    'as_of',p_as_of,'complete',v_complete,'reasons',v_reasons,'cycle_start',p_cycle_start,
    'end_exclusive',v_end,'original_version_id',v_original,'current_version_id',v_current,
    'original_plan',v_original_json,'current_plan',v_plan_json,'funds',v_funds,
    'net_liquid_cents',case when v_net is null then null else v_net::text end,
    'net_claims_cents',finance.budget_checked_bigint(v_claims)::text,
    'positive_claims_cents',finance.budget_checked_bigint(v_positive)::text,
    'deficit_cents',case when v_net is null then null else
      finance.budget_checked_bigint(greatest(v_positive-v_net,v_negative,0))::text end,
    'unassigned_cents',case when v_net is null or not v_complete then null else
      finance.budget_checked_bigint(v_net-v_claims)::text end,
    'provisional_unassigned_cents',null,'forecast_gap_cents',case when v_current is null then null
      else finance.budget_checked_bigint(v_contrib-v_income)::text end,
    'provenance',jsonb_build_object('resources',v_resources,'plan',v_plan));
end;
$$;

create or replace function public.budget_get_fund_v1(
  p_fund_id uuid, p_from date, p_to date, p_cursor text default null,
  p_limit integer default 50
)
returns jsonb language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare h uuid; v_fund record; v_cursor jsonb; v_entries jsonb := '[]'::jsonb;
  v_row record; v_balance record; v_next text; v_today date; v_asof timestamptz;
  v_resources jsonb; v_last_effective date; v_last_recorded timestamptz;
  v_last_type text; v_last_id uuid; v_target jsonb; v_plan_id uuid;
  v_balance_date date;
begin
  h := finance.budget_reader_household();
  if p_fund_id is null or p_from is null or p_to is null
     or not isfinite(p_from) or not isfinite(p_to) or p_limit is null
     or p_from >= p_to or p_limit not between 1 and 200 then
    perform finance.budget_fail('budget_invalid','invalid fund date range or limit'); end if;
  if p_cursor is not null then begin
    v_cursor := convert_from(decode(p_cursor,'base64'),'utf8')::jsonb;
    perform finance.budget_validate_object(v_cursor,
      array['v','household_id','fund_id','from','to','effective_on','recorded_at','entry_type','id'],
      array[]::text[]);
    if finance.budget_integer(v_cursor,'v',1,1) <> 1
       or finance.budget_uuid(v_cursor,'household_id') <> h
       or finance.budget_uuid(v_cursor,'fund_id') <> p_fund_id
       or finance.budget_date(v_cursor,'from') <> p_from
       or finance.budget_date(v_cursor,'to') <> p_to
       or finance.budget_date(v_cursor,'effective_on') is null
       or finance.budget_timestamp(v_cursor,'recorded_at') is null
       or finance.budget_text(v_cursor,'entry_type') not in ('movement','allocation')
       or finance.budget_uuid(v_cursor,'id') is null then
      perform finance.budget_fail('budget_invalid','cursor does not match filters'); end if;
  exception when others then perform finance.budget_fail('budget_invalid','invalid cursor'); end; end if;
  select * into v_fund from finance.funds where household_id=h and id=p_fund_id;
  if not found then perform finance.budget_fail('budget_not_found','fund'); end if;
  v_today := (statement_timestamp() at time zone 'Africa/Johannesburg')::date;
  v_balance_date := least(p_to - 1, v_today);
  select * into v_balance from finance.budget_fund_balances(h,v_balance_date) where fund_id=p_fund_id;
  v_asof := least(statement_timestamp(),
    (p_to::timestamp at time zone 'Africa/Johannesburg') - interval '1 microsecond');
  select nullif(x->>'current_version_id','')::uuid into v_plan_id
  from (select finance.budget_plan_versions(h,
    finance.budget_cycle_start((v_asof at time zone 'Africa/Johannesburg')::date),v_asof) x) q;
  select finance.budget_target_suggestion(to_jsonb(l),v_balance.balance_cents,
    (v_asof at time zone 'Africa/Johannesburg')::date)
  into v_target
  from finance.budget_lines l
  join finance.budget_versions v on v.household_id=l.household_id and v.id=l.version_id
  where l.household_id=h and l.fund_id=p_fund_id and l.version_id=v_plan_id;
  v_resources := finance.budget_resources(h,v_asof);
  for v_row in select m.effective_on as effective_on,m.recorded_at,
      'movement'::text as entry_type,m.id,
      case when m.to_fund_id=p_fund_id then m.amount_cents else -m.amount_cents end::numeric as signed_amount,
      case when m.to_fund_id=p_fund_id then m.amount_cents else -m.amount_cents end::numeric as delta,
      null::text as source_transaction_id,null::uuid as set_id,null::uuid as supersedes_id,
      null::text as status,null::text as category_name_snapshot,null::uuid as beneficiary_member_id,
      null::uuid as paid_by_member_id,null::uuid as payment_account_id,
      null::text as beneficiary_scope,null::text as effect_kind,true as active_effect,
      m.correction_of,m.correction_role
    from finance.fund_movements m where m.household_id=h and (m.from_fund_id=p_fund_id or m.to_fund_id=p_fund_id)
      and m.effective_on >= p_from and m.effective_on < p_to
      and (v_cursor is null or (m.effective_on,m.recorded_at,'movement'::text,m.id) <
        (finance.budget_date(v_cursor,'effective_on'),finance.budget_timestamp(v_cursor,'recorded_at'),
          finance.budget_text(v_cursor,'entry_type'),finance.budget_uuid(v_cursor,'id')))
    union all
    select s.occurred_on,s.recorded_at,'allocation',a.id,a.amount_cents::numeric,
      case when s.status='superseded' or finance.budget_opening_cutover(h) is null
        or s.occurred_on < finance.budget_opening_cutover(h) then 0 else a.amount_cents end::numeric,
      s.transaction_id,s.id,s.supersedes_id,s.status,a.category_name_snapshot,a.beneficiary_member_id,
      a.paid_by_member_id,a.payment_account_id,a.beneficiary_scope,a.effect_kind,
      (s.status in ('current','needs_review') and finance.budget_opening_cutover(h) is not null
        and s.occurred_on >= finance.budget_opening_cutover(h)),null,null
    from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id
    where a.household_id=h and a.fund_id=p_fund_id and s.occurred_on >= p_from and s.occurred_on < p_to
      and (v_cursor is null or (s.occurred_on,s.recorded_at,'allocation'::text,a.id) <
        (finance.budget_date(v_cursor,'effective_on'),finance.budget_timestamp(v_cursor,'recorded_at'),
          finance.budget_text(v_cursor,'entry_type'),finance.budget_uuid(v_cursor,'id')))
    order by effective_on desc,recorded_at desc,entry_type desc,id desc
    limit p_limit + 1 loop
    if jsonb_array_length(v_entries) >= p_limit then
      v_next := encode(convert_to(jsonb_build_object('v',1,'household_id',h::text,
        'fund_id',p_fund_id::text,'from',p_from::text,'to',p_to::text,
        'effective_on',v_last_effective,'recorded_at',v_last_recorded,'entry_type',v_last_type,
        'id',v_last_id::text)::text,'utf8'),'base64'); exit; end if;
    v_last_effective := v_row.effective_on;
    v_last_recorded := v_row.recorded_at;
    v_last_type := v_row.entry_type;
    v_last_id := v_row.id;
    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'effective_on',v_row.effective_on,'recorded_at',v_row.recorded_at,'entry_type',v_row.entry_type,
      'id',v_row.id::text,'signed_amount_cents',v_row.signed_amount::text,
      'effective_delta_cents',v_row.delta::text,'source_transaction_id',v_row.source_transaction_id,
      'set_id',v_row.set_id,'supersedes_id',v_row.supersedes_id,'status',v_row.status,
      'category_name_snapshot',v_row.category_name_snapshot,'beneficiary_member_id',v_row.beneficiary_member_id,
      'paid_by_member_id',v_row.paid_by_member_id,'payment_account_id',v_row.payment_account_id,
      'beneficiary_scope',v_row.beneficiary_scope,'effect_kind',v_row.effect_kind,
      'active_effect',v_row.active_effect,
      'correction_of',v_row.correction_of,'correction_role',v_row.correction_role));
  end loop;
  if finance.budget_opening_cutover(h) is null then
    v_resources := v_resources || jsonb_build_object('complete',false,
      'reasons',coalesce(v_resources->'reasons','[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('code','cutover_missing')));
  end if;
  if v_plan_id is null then
    v_resources := v_resources || jsonb_build_object('complete',false,
      'reasons',coalesce(v_resources->'reasons','[]'::jsonb) ||
        jsonb_build_array(jsonb_build_object('code','plan_missing')));
  end if;
  return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,
    'as_of',v_asof,'complete',(v_resources->>'complete')::boolean,
    'reasons',coalesce(v_resources->'reasons','[]'::jsonb),
    'fund',to_jsonb(v_fund),'balances',jsonb_build_object(
      'fund_id',v_balance.fund_id,'balance_cents',v_balance.balance_cents::text,
      'assigned_cents',v_balance.assigned_cents::text,'outflow_cents',v_balance.outflow_cents::text,
      'refund_cents',v_balance.refund_cents::text,'restricted_cents',v_balance.restricted_cents::text),
    'restricted_cents','0','liquid_cents',coalesce(v_balance.balance_cents,0)::text,
    'target_suggestion',v_target,
    'entries',v_entries,'next_cursor',v_next);
end;
$$;

revoke all on function finance.budget_checked_bigint(numeric), finance.budget_reader_household(),
  finance.budget_cycle_start(date), finance.budget_plan_versions(uuid,date,timestamptz),
  finance.budget_opening_cutover(uuid), finance.budget_fund_balances(uuid,date),
  finance.budget_resources(uuid,timestamptz), finance.budget_target_suggestion(jsonb,bigint,date)
  from public, anon, authenticated, service_role;
revoke all on function public.budget_get_overview_v1(date,timestamptz),
  public.budget_get_fund_v1(uuid,date,date,text,integer) from public, anon, service_role;
grant execute on function public.budget_get_overview_v1(date,timestamptz),
  public.budget_get_fund_v1(uuid,date,date,text,integer) to authenticated;
