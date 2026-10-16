-- Establishing the first opening cutover is deliberately prospective: source
-- rows before it are already represented by the reconciled account balances.
-- We derive Stage4 from the immediately preceding Stage3 definition so every
-- frozen-journal and identity rule remains byte-for-byte aligned.
do $migration$
declare
  v_sql text;
  v_marker constant text := 'select value into base from jsonb_array_elements(coalesce(baseline,''[]''::jsonb)) where value->>''transaction_id''=t.id limit 1;';
  v_journal_marker constant text := 'for setrow in select s.* from finance.budget_allocation_sets s where s.household_id=p_household and s.status in (''current'',''needs_review'') order by s.id loop';
  v_skip constant text := $body$
      -- Initial opening balances already include unallocated opening history.
      -- Never use this for undated rows, explicit pending rows, archived rows,
      -- or any reviewed allocation.  After establishment, a row must also be
      -- present in the frozen source baseline before it can be treated as
      -- opening-balance history.
      if p_opening_cutover is not null
         and t.occurred_on is not null
         and t.occurred_on < p_opening_cutover
         and source_time <= cutoff
         and finance.budget_effective_source_pending(p_household,t) is not true
         and t.source_is_archived is false
         and not exists (
           select 1 from finance.budget_allocation_sets x
           where x.household_id=p_household and x.transaction_id=t.id
             and x.status in ('current','needs_review')
         )
         and (p_fresh_observation or (
           base is not null
           and base->>'account_id'=t.account_id::text
           and base->>'amount_cents' is not distinct from finance.budget_source_snapshot(p_household,t.id)->>'amount_cents'
           and base->>'source_fingerprint'=finance.budget_source_snapshot(p_household,t.id)->>'source_fingerprint'
           and (not (base ? 'source_system') or base->>'source_system'=t.source_system)
           and (not (base ? 'source_transaction_id') or base->>'source_transaction_id'=coalesce(t.source_transaction_id,t.id))
         )) then
        continue;
      end if;$body$;
  v_archived constant text := $body$
      -- Archived source rows carry no live economic activity.  A fresh
      -- balance may establish that fact; otherwise only an unchanged frozen
      -- archived source can remain settled.  A later archival of an active
      -- frozen row stays visible as source drift.
      if t.source_is_archived is true and not exists (
        select 1 from finance.budget_allocation_sets x
        where x.household_id=p_household and x.transaction_id=t.id
          and x.status in ('current','needs_review')
      ) then
        if p_fresh_observation or base is null or (
          coalesce((base->>'archived')::boolean,false) is true
          and base->>'source_fingerprint'=finance.budget_source_snapshot(p_household,t.id)->>'source_fingerprint'
        ) then
          continue;
        end if;
        reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_unverified','account_id',a->>'account_id','transaction_id',t.id));
        known:=false; arithmetic:=false; continue;
      end if;$body$;
begin
  select pg_get_functiondef('finance.budget_source_exposure_stage3(uuid,jsonb,timestamp with time zone)'::regprocedure)
    into v_sql;
  if position(v_marker in v_sql)=0 then
    raise exception 'budget migration invariant failed: Stage3 exposure marker missing';
  end if;
  if position(v_journal_marker in v_sql)=0 then
    raise exception 'budget migration invariant failed: Stage3 reviewed-journal marker missing';
  end if;
  v_sql := replace(
    v_sql,
    'FUNCTION finance.budget_source_exposure_stage3(p_household uuid, p_coverage jsonb, p_asof timestamp with time zone)',
    'FUNCTION finance.budget_source_exposure_stage4(p_household uuid, p_coverage jsonb, p_asof timestamp with time zone, p_opening_cutover date, p_fresh_observation boolean)'
  );
  if position('budget_source_exposure_stage4' in v_sql)=0 then
    raise exception 'budget migration invariant failed: Stage3 signature changed';
  end if;
  v_sql := replace(v_sql, v_marker, v_marker || v_skip || v_archived);
  -- Utility allocation sets are validated by budget_utility_source_state. They
  -- do not have a bank transaction, so never pass them through the bank-source
  -- frozen-journal loop below.
  v_sql := replace(v_sql, v_journal_marker,
    'for setrow in select s.* from finance.budget_allocation_sets s where s.household_id=p_household and s.transaction_id is not null and s.status in (''current'',''needs_review'') order by s.id loop');
  v_sql := replace(v_sql, 'finance.budget_opening_cutover(p_household)', 'p_opening_cutover');
  execute v_sql;
end $migration$;

create or replace function finance.budget_source_exposure_with_cutover(
  p_household uuid, p_coverage jsonb, p_asof timestamptz,
  p_opening_cutover date, p_fresh_observation boolean default false
) returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare r jsonb; u jsonb; utility_ids uuid[]:='{}'; removed_delta numeric:=0; reasons jsonb; adjustments jsonb;
  v_latest_complete jsonb; v_accounts jsonb;
begin
  -- Fresh client coverage intentionally cannot supply server-only source
  -- state. Reattach only the latest completed baseline, and only for accounts
  -- that did not already carry a frozen baseline (state revalidation does).
  if p_opening_cutover is not null then
    select q.coverage_snapshot into v_latest_complete
      from finance.budget_reconciliations q
      where q.household_id=p_household and q.status='complete' and q.as_of<=p_asof
      order by q.as_of desc,q.recorded_at desc,q.id desc limit 1;
    if v_latest_complete is not null then
      select coalesce(jsonb_agg(case when a.value ? 'source_state_snapshot' then a.value
        else a.value || jsonb_build_object('source_state_snapshot',old.value->'source_state_snapshot') end
        order by a.ord),'[]'::jsonb) into v_accounts
      from jsonb_array_elements(coalesce(p_coverage->'accounts','[]'::jsonb)) with ordinality a(value,ord)
      left join lateral (
        select x.value from jsonb_array_elements(coalesce(v_latest_complete->'accounts','[]'::jsonb)) x(value)
        where x.value->>'account_id'=a.value->>'account_id' limit 1
      ) old on true;
      p_coverage:=p_coverage||jsonb_build_object('accounts',v_accounts);
    end if;
  end if;
  r:=finance.budget_source_exposure_stage4(p_household,p_coverage,p_asof,p_opening_cutover,p_fresh_observation);
  select coalesce(array_agg(s.id),'{}') into utility_ids from finance.budget_allocation_sets s
    where s.household_id=p_household and s.utility_entry_id is not null and s.status in ('current','needs_review');
  select coalesce(sum((x->>'resource_delta_cents')::numeric),0) into removed_delta
    from jsonb_array_elements(coalesce(r->'adjustments','[]'::jsonb)) x
    where nullif(x->>'set_id','')::uuid=any(utility_ids);
  select coalesce(jsonb_agg(x),'[]'::jsonb) into adjustments
    from jsonb_array_elements(coalesce(r->'adjustments','[]'::jsonb)) x
    where nullif(x->>'set_id','')::uuid is null or not (nullif(x->>'set_id','')::uuid=any(utility_ids));
  select coalesce(jsonb_agg(x),'[]'::jsonb) into reasons
    from jsonb_array_elements(coalesce(r->'reasons','[]'::jsonb)) x
    where not (x->>'code'='source_allocation_stale' and x->>'transaction_id' is null);
  u:=finance.budget_utility_source_state(p_household,p_asof);
  reasons:=reasons||coalesce(u->'reasons','[]'::jsonb);
  return r||jsonb_build_object('complete',jsonb_array_length(reasons)=0,'reasons',reasons,
    'adjustments',adjustments,'resource_delta_cents',case when r->>'resource_delta_cents' is null then null
      else finance.budget_checked_bigint((r->>'resource_delta_cents')::numeric-removed_delta)::text end,
    'provisional_known',coalesce((r->>'provisional_known')::boolean,false) and coalesce((u->>'complete')::boolean,false));
end $$;

create or replace function finance.budget_source_exposure(p_household uuid,p_coverage jsonb,p_asof timestamptz)
returns jsonb language sql stable security definer set search_path=pg_temp set timezone='UTC' as $$
  select finance.budget_source_exposure_with_cutover(
  p_household,p_coverage,p_asof,finance.budget_opening_cutover(p_household),false
  )
$$;

-- Retain every base coverage check.  The former blanket restricted gate is
-- discharged only by the exact account's non-negative capacity and evidence.
create or replace function finance.budget_check_coverage_base(p_household uuid,p_coverage jsonb,p_asof timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare r jsonb; reasons jsonb; status text; evidence text;
begin
  r:=finance.budget_check_coverage_base_stage3(p_household,p_coverage,p_asof);
  status:=p_coverage->'utility_coverage'->>'status';
  evidence:=nullif(btrim(p_coverage->'utility_coverage'->>'evidence'),'');
  select coalesce(jsonb_agg(x),'[]'::jsonb) into reasons
    from jsonb_array_elements(coalesce(r->'reasons','[]'::jsonb)) x
    where not (x->>'code'='utilities_unverified' and status='verified' and evidence is not null)
      and not (
        x->>'code'='restricted_resources_unverified' and exists (
          select 1 from jsonb_array_elements(coalesce(r->'coverage_snapshot'->'accounts','[]'::jsonb)) a
          where a->>'account_id'=x->>'account_id'
            and a->'settings_snapshot'->>'resource_class' in ('restricted','mortgage')
            and coalesce(a->>'eligible_restricted_cents','') ~ '^[0-9]+$'
            and nullif(btrim(coalesce(a->>'restricted_evidence','')),'') is not null
        )
      );
  if status='not_required' and evidence is not null and exists(select 1 from consumption.devices d where d.household_id=p_household) then
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utilities_unverified'));
  end if;
  if status='verified' and evidence is null and not (reasons @> '[{"code":"utilities_unverified"}]'::jsonb) then
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utilities_unverified'));
  end if;
  return r||jsonb_build_object('status',case when jsonb_array_length(reasons)=0 then 'complete' else 'incomplete' end,'reasons',reasons);
end $$;

create or replace function finance.budget_check_coverage_with_cutover(
  p_household uuid, p_coverage jsonb, p_as_of timestamptz,
  p_opening_cutover date, p_fresh_observation boolean default false
) returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare v_base jsonb; v_exposure jsonb; v_reasons jsonb;
begin
  v_base:=finance.budget_check_coverage_base(p_household,p_coverage,p_as_of);
  v_exposure:=finance.budget_source_exposure_with_cutover(p_household,v_base->'coverage_snapshot',p_as_of,p_opening_cutover,p_fresh_observation);
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_reasons
    from jsonb_array_elements(v_base->'reasons') where value->>'code'<>'source_activity_unreconciled';
  v_reasons:=v_reasons||coalesce(v_exposure->'reasons','[]'::jsonb);
  return v_base||jsonb_build_object('status',case when jsonb_array_length(v_reasons)=0 then 'complete' else 'incomplete' end,'reasons',v_reasons,'source_exposure',v_exposure);
end $$;

create or replace function finance.budget_check_coverage(p_household uuid,p_coverage jsonb,p_as_of timestamptz)
returns jsonb language sql stable security definer set search_path=pg_temp set timezone='UTC' as $$
  select finance.budget_check_coverage_with_cutover(
    p_household,p_coverage,p_as_of,finance.budget_opening_cutover(p_household),false
  )
$$;

create or replace function public.budget_record_reconciliation_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare
  v_as_of timestamptz; v_cutover date; v_effective_cutover date; v_notes text; v_coverage jsonb; v_canonical jsonb;
  v_replay jsonb; v_check jsonb; v_household uuid; v_actor uuid; v_existing_cutover date;
  v_id uuid:=gen_random_uuid(); v_result jsonb; v_frozen jsonb;
begin
  perform finance.budget_validate_object(p_payload,array['as_of','coverage_snapshot','notes'],array['opening_fund_cutover']);
  v_as_of:=finance.budget_timestamp(p_payload,'as_of');
  if v_as_of>statement_timestamp() then perform finance.budget_fail('budget_invalid','as_of must not be in the future'); end if;
  v_cutover:=finance.budget_date(p_payload,'opening_fund_cutover',true);
  if v_cutover is not null and v_cutover>(v_as_of at time zone 'Africa/Johannesburg')::date then perform finance.budget_fail('budget_invalid','opening fund cutover must not be after as_of'); end if;
  v_coverage:=finance.budget_validate_coverage(p_payload->'coverage_snapshot'); v_notes:=finance.budget_text(p_payload,'notes');
  v_canonical:=jsonb_build_object('as_of',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',case when v_cutover is null then null else v_cutover::text end,'coverage_snapshot',v_coverage,'notes',v_notes);
  v_replay:=finance.budget_begin_command(p_command_id,'budget_record_reconciliation_v1',v_canonical); if v_replay is not null then return v_replay; end if;
  v_household:=finance.resolve_caller_household(); v_actor:=finance.budget_actor_member(v_household);
  select opening_fund_cutover into v_existing_cutover from finance.budget_reconciliations where household_id=v_household and status='complete' and opening_fund_cutover is not null order by recorded_at,id limit 1;
  if v_cutover is not null and v_existing_cutover is not null and v_cutover<>v_existing_cutover then perform finance.budget_fail('budget_conflict','opening fund cutover is already established'); end if;
  v_effective_cutover:=coalesce(v_existing_cutover,v_cutover);
  v_check:=finance.budget_check_coverage_with_cutover(v_household,v_coverage,v_as_of,v_effective_cutover,v_existing_cutover is null and v_cutover is not null);
  if v_cutover is not null and v_check->>'status'<>'complete' then perform finance.budget_fail('budget_incomplete','opening fund cutover requires complete coverage'); end if;
  v_frozen:=finance.budget_source_state_snapshot(v_household,v_check->'coverage_snapshot');
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
    values(v_id,v_household,v_as_of,v_actor,v_check->>'status',v_frozen,v_cutover,v_notes);
  v_result:=jsonb_build_object('reconciliation_id',v_id::text,'status',v_check->>'status','reasons',v_check->'reasons','reconciliation_fingerprint',finance.budget_hash(jsonb_build_object('id',v_id::text,'as_of',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',v_cutover::text,'coverage_snapshot',v_frozen)));
  set constraints all immediate;
  return finance.budget_finish_command(p_command_id,'budget_record_reconciliation_v1',v_canonical,v_result);
end $$;

revoke all on function finance.budget_source_exposure_stage4(uuid,jsonb,timestamptz,date,boolean),finance.budget_source_exposure_with_cutover(uuid,jsonb,timestamptz,date,boolean),finance.budget_check_coverage_with_cutover(uuid,jsonb,timestamptz,date,boolean) from public,anon,authenticated,service_role;
revoke all on function finance.budget_source_exposure(uuid,jsonb,timestamptz),finance.budget_check_coverage(uuid,jsonb,timestamptz),finance.budget_check_coverage_base(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.budget_record_reconciliation_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.budget_record_reconciliation_v1(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
