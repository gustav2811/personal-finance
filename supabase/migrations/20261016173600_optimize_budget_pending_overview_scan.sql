-- The pending-settlement lookup used to expand every historical reconciliation
-- snapshot once per transaction. On the live household that meant thousands of
-- identical JSON scans inside one overview request. Build the matching IDs once
-- per account, then use an in-memory membership check in the transaction loop.
do $migration$
declare
  v_sql text;
  v_old constant text := 'prior_unreflected boolean; pending_reservation boolean; observed_at timestamptz;';
  v_new constant text := 'prior_unreflected boolean; pending_reservation boolean; prior_unreflected_ids text[] := ''{}''; observed_at timestamptz;';
  v_loop constant text := '    for t in select x.* from public.transactions x';
  v_cached_loop constant text := $cached$
    prior_unreflected_ids := '{}';
    if observed_at is not null then
      select coalesce(array_agg(distinct old_t.id), '{}')
      into prior_unreflected_ids
      from finance.budget_reconciliations r
      cross join lateral jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) old_a
      cross join lateral jsonb_array_elements(coalesce(old_a.value->'source_state_snapshot'->'sources','[]'::jsonb)) old_s
      join public.transactions old_t
        on old_t.household_id=p_household
       and old_t.id=old_s.value->>'transaction_id'
       and old_t.account_id::text=a->>'account_id'
       and old_s.value->>'source_system'=old_t.source_system
       and old_s.value->>'source_transaction_id'=coalesce(old_t.source_transaction_id,old_t.id)
      where r.household_id=p_household and r.as_of >= observed_at and r.as_of<=p_asof
        and old_a.value->>'account_id'=a->>'account_id'
        and old_a.value->>'snapshot_fingerprint'=a->>'snapshot_fingerprint'
        and coalesce((old_s.value->>'pending')::boolean,false)
        and not exists (
          select 1
          from jsonb_array_elements_text(coalesce(old_a.value->'pending_included_ids','[]'::jsonb)) x
          where x.value=old_t.id
        );
    end if;
    for t in select x.* from public.transactions x$cached$;
  v_old_lookup constant text := $lookup$
        select exists(
          select 1 from finance.budget_reconciliations r
          cross join lateral jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) old_a
          cross join lateral jsonb_array_elements(coalesce(old_a.value->'source_state_snapshot'->'sources','[]'::jsonb)) old_s
          where r.household_id=p_household and r.as_of >= observed_at and r.as_of<=p_asof
            and old_a.value->>'account_id'=t.account_id::text
            and old_a.value->>'snapshot_fingerprint'=a->>'snapshot_fingerprint'
            and old_s.value->>'transaction_id'=t.id and old_s.value->>'source_system'=t.source_system
            and old_s.value->>'source_transaction_id'=coalesce(t.source_transaction_id,t.id)
            and coalesce((old_s.value->>'pending')::boolean,false)
            and not exists(select 1 from jsonb_array_elements_text(coalesce(old_a.value->'pending_included_ids','[]'::jsonb)) x where x=t.id)
        ) into prior_unreflected;$lookup$;
  v_new_lookup constant text := '        prior_unreflected := t.id = any(prior_unreflected_ids);';
begin
  select pg_get_functiondef(
    'finance.budget_source_exposure_stage4(uuid,jsonb,timestamp with time zone,date,boolean)'::regprocedure
  ) into v_sql;
  if position(v_old in v_sql)=0 or position(v_loop in v_sql)=0 or position(v_old_lookup in v_sql)=0 then
    raise exception 'budget overview optimization invariant failed: source function changed';
  end if;
  v_sql := replace(v_sql,v_old,v_new);
  v_sql := replace(v_sql,v_loop,v_cached_loop);
  v_sql := replace(v_sql,v_old_lookup,v_new_lookup);
  execute v_sql;
end $migration$;
