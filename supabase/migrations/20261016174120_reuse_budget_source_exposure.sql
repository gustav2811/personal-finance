-- Source exposure is a full transaction/reconciliation pass. The pending
-- implementation had recomputed it in the reconciliation state, resource
-- wrapper, and public overview wrapper. Carry the already-checked result
-- through those internal layers so one overview read performs one pass.
do $migration$
declare
  v_sql text;
  v_old constant text := '''reconciliation_fingerprint'',finance.budget_hash(';
  v_new constant text := '''source_exposure'',exposure,''reconciliation_fingerprint'',finance.budget_hash(';
begin
  select pg_get_functiondef(
    'finance.budget_reconciliation_state_stage3(uuid,uuid,timestamp with time zone)'::regprocedure
  ) into v_sql;
  if position(v_old in v_sql)=0 then
    raise exception 'budget exposure reuse invariant failed: reconciliation result marker missing';
  end if;
  execute replace(v_sql,v_old,v_new);
end $migration$;

do $migration$
declare
  v_sql text;
  v_exposure_call constant text := $old$
  v_exposure := finance.budget_source_exposure(
    p_household, v_rec.coverage_snapshot, p_asof);$old$;
  v_exposure_reuse constant text := '  v_exposure := coalesce(v_state->''source_exposure'',''{}''::jsonb);';
  v_result_marker constant text := '''pending_adjustments'',coalesce(v_exposure->''adjustments'',''[]''::jsonb)';
  v_result_with_exposure constant text := v_result_marker || ',''source_exposure'',v_exposure';
begin
  select pg_get_functiondef(
    'finance.budget_resources_stage3(uuid,timestamp with time zone)'::regprocedure
  ) into v_sql;
  if position(v_exposure_call in v_sql)=0 or position(v_result_marker in v_sql)=0 then
    raise exception 'budget exposure reuse invariant failed: resource source marker missing';
  end if;
  v_sql := replace(v_sql,v_exposure_call,v_exposure_reuse);
  v_sql := replace(v_sql,v_result_marker,v_result_with_exposure);
  execute v_sql;
end $migration$;

-- The state wrapper can decide whether the only warnings are known pending
-- reservations from the exposure just attached by the stage-3 checker.
do $migration$
declare
  v_sql text;
  v_old constant text := $old$
  pending_only := finance.budget_pending_only_state(
    p_household,r.coverage_snapshot,p_checked_at,reasons
  );$old$;
  v_new constant text := $new$
  pending_only := coalesce((state->'source_exposure'->>'provisional_known')::boolean,false)
    and exists (
      select 1 from jsonb_array_elements(coalesce(reasons,'[]'::jsonb)) x
      where x->>'code' in ('pending_activity_provisional','posted_awaiting_allocation')
    )
    and not exists (
      select 1 from jsonb_array_elements(coalesce(reasons,'[]'::jsonb)) x
      where x->>'code' not in ('pending_activity_provisional','posted_awaiting_allocation')
    );$new$;
begin
  select pg_get_functiondef(
    'finance.budget_reconciliation_state(uuid,uuid,timestamp with time zone)'::regprocedure
  ) into v_sql;
  if position(v_old in v_sql)=0 then
    raise exception 'budget exposure reuse invariant failed: pending state marker missing';
  end if;
  execute replace(v_sql,v_old,v_new);
end $migration$;

-- Reuse the exposure returned by budget_resources_stage3 rather than invoking
-- both pending_only_state and source_exposure again. Keep the internal field
-- out of the public resource payload after it has served its purpose.
do $migration$
declare
  v_sql text;
  v_pending_old constant text := $old$
    pending_only := finance.budget_pending_only_state(
      p_household,(select coverage_snapshot from finance.budget_reconciliations where id=rec),p_asof,r->'reasons'
    );$old$;
  v_pending_new constant text := $new$
    pending_only := coalesce((r->'source_exposure'->>'provisional_known')::boolean,false)
      and exists (
        select 1 from jsonb_array_elements(coalesce(r->'reasons','[]'::jsonb)) x
        where x->>'code' in ('pending_activity_provisional','posted_awaiting_allocation')
      )
      and not exists (
        select 1 from jsonb_array_elements(coalesce(r->'reasons','[]'::jsonb)) x
        where x->>'code' not in ('pending_activity_provisional','posted_awaiting_allocation')
      );$new$;
  v_exposure_old constant text := $old$
    exposure := finance.budget_source_exposure(
      p_household,(select coverage_snapshot from finance.budget_reconciliations where id=rec),p_asof
    );$old$;
  v_exposure_new constant text := '    exposure := coalesce(r->''source_exposure'',''{}''::jsonb);';
  v_return_marker constant text := '  return r || jsonb_build_object(';
  v_return_new constant text := '  r := r - ''source_exposure'';' || chr(10) || v_return_marker;
begin
  select pg_get_functiondef('finance.budget_resources(uuid,timestamp with time zone)'::regprocedure)
    into v_sql;
  if position(v_pending_old in v_sql)=0 or position(v_exposure_old in v_sql)=0
     or position(v_return_marker in v_sql)=0 then
    raise exception 'budget exposure reuse invariant failed: resource wrapper marker missing';
  end if;
  v_sql := replace(v_sql,v_pending_old,v_pending_new);
  v_sql := replace(v_sql,v_exposure_old,v_exposure_new);
  v_sql := replace(v_sql,v_return_marker,v_return_new);
  execute v_sql;
end $migration$;

-- The dispatched overview already contains the resource result under
-- query_provenance.resources. Do not calculate the same resource state again
-- just to lift selected fields to the top level.
do $migration$
declare
  v_sql text;
  v_old constant text := 'h:=finance.budget_reader_household(); r:=finance.budget_resources(h,p_as_of);';
  v_new constant text := $new$
  h:=finance.budget_reader_household();
  r:=v->'query_provenance'->'resources';
  if r is null then r:=finance.budget_resources(h,p_as_of); end if;$new$;
begin
  select pg_get_functiondef('public.budget_get_overview_v1(date,timestamp with time zone)'::regprocedure)
    into v_sql;
  if position(v_old in v_sql)=0 then
    raise exception 'budget exposure reuse invariant failed: public overview wrapper marker missing';
  end if;
  execute replace(v_sql,v_old,v_new);
end $migration$;

notify pgrst, 'reload schema';
