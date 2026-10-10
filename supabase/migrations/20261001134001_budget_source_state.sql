-- PR3 core: source state is evaluated from the immutable reconciliation
-- evidence.  It never edits reviewed allocations or their command receipts.

alter function finance.budget_check_coverage(uuid, jsonb, timestamptz)
  rename to budget_check_coverage_base;

create or replace function finance.budget_source_effective_at(p_transaction public.transactions)
returns timestamptz
language sql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
  select coalesce(
    p_transaction.effective_at,
    p_transaction.posted_at,
    (p_transaction.occurred_on::timestamp at time zone 'Africa/Johannesburg'),
    p_transaction.date)
$$;

create or replace function finance.budget_pending_lifecycle_proved(
  p_household uuid, p_old jsonb
)
returns boolean language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare v_fact jsonb; v_tx public.transactions%rowtype; v_snap jsonb;
begin
  if jsonb_typeof(p_old) <> 'array' then return false; end if;
  for v_fact in select value from jsonb_array_elements(p_old) loop
    select * into v_tx from public.transactions t
      where t.household_id=p_household and t.id=v_fact->>'id';
    if not found or v_tx.account_id::text is distinct from v_fact->>'account_id'
       or v_tx.source_is_archived is not false or v_tx.source_is_pending is null then return false; end if;
    -- Same provider row identity is the only ordinary transition.  We require
    -- its amount and current normalized source facts to remain exact.
    if v_tx.amount::text is distinct from v_fact->>'amount'
       or v_tx.occurred_on::text is distinct from v_fact->>'occurred_on' then return false; end if;
    begin v_snap := finance.budget_source_snapshot(p_household,v_tx.id);
    exception when others then return false; end;
    if not coalesce((v_snap->>'complete')::boolean,false)
       or v_snap->>'amount_cents' is null then return false; end if;
  end loop;
  return true;
end $$;

create or replace function public.budget_record_reconciliation_v1(p_command_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare
  v_as_of timestamptz; v_cutover date; v_notes text; v_coverage jsonb; v_canonical jsonb;
  v_replay jsonb; v_check jsonb; v_household uuid; v_actor uuid; v_existing_cutover date;
  v_id uuid:=gen_random_uuid(); v_result jsonb; v_frozen jsonb;
begin
  perform finance.budget_validate_object(p_payload,array['as_of','coverage_snapshot','notes'],array['opening_fund_cutover']);
  v_as_of:=finance.budget_timestamp(p_payload,'as_of');
  if v_as_of>statement_timestamp() then perform finance.budget_fail('budget_invalid','as_of must not be in the future'); end if;
  v_cutover:=finance.budget_date(p_payload,'opening_fund_cutover',true);
  v_coverage:=finance.budget_validate_coverage(p_payload->'coverage_snapshot'); v_notes:=finance.budget_text(p_payload,'notes');
  v_canonical:=jsonb_build_object('as_of',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',case when v_cutover is null then null else v_cutover::text end,'coverage_snapshot',v_coverage,'notes',v_notes);
  v_replay:=finance.budget_begin_command(p_command_id,'budget_record_reconciliation_v1',v_canonical); if v_replay is not null then return v_replay; end if;
  v_household:=finance.resolve_caller_household(); v_actor:=finance.budget_actor_member(v_household);
  v_check:=finance.budget_check_coverage(v_household,v_coverage,v_as_of);
  if v_cutover is not null and v_cutover>(v_as_of at time zone 'Africa/Johannesburg')::date then perform finance.budget_fail('budget_invalid','opening fund cutover must not be after as_of'); end if;
  if v_cutover is not null and v_check->>'status'<>'complete' then perform finance.budget_fail('budget_incomplete','opening fund cutover requires complete coverage'); end if;
  select opening_fund_cutover into v_existing_cutover from finance.budget_reconciliations where household_id=v_household and status='complete' and opening_fund_cutover is not null order by recorded_at,id limit 1;
  if v_cutover is not null and v_existing_cutover is not null and v_cutover<>v_existing_cutover then perform finance.budget_fail('budget_conflict','opening fund cutover is already established'); end if;
  v_frozen:=finance.budget_source_state_snapshot(v_household,v_check->'coverage_snapshot');
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
    values(v_id,v_household,v_as_of,v_actor,v_check->>'status',v_frozen,v_cutover,v_notes);
  v_result:=jsonb_build_object('reconciliation_id',v_id::text,'status',v_check->>'status','reasons',v_check->'reasons','reconciliation_fingerprint',finance.budget_hash(jsonb_build_object('id',v_id::text,'as_of',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',v_cutover::text,'coverage_snapshot',v_frozen)));
  set constraints all immediate;
  return finance.budget_finish_command(p_command_id,'budget_record_reconciliation_v1',v_canonical,v_result);
end $$;

create or replace function finance.budget_check_coverage(p_household uuid, p_coverage jsonb, p_as_of timestamptz)
returns jsonb language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare v_base jsonb; v_exposure jsonb; v_reasons jsonb;
begin
  v_base := finance.budget_check_coverage_base(p_household,p_coverage,p_as_of);
  v_exposure := finance.budget_source_exposure(p_household,v_base->'coverage_snapshot',p_as_of);
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_reasons
  from jsonb_array_elements(v_base->'reasons')
  where value->>'code' <> 'source_activity_unreconciled';
  v_reasons := v_reasons || coalesce(v_exposure->'reasons','[]'::jsonb);
  return v_base || jsonb_build_object('status',case when jsonb_array_length(v_reasons)=0 then 'complete' else 'incomplete' end,
    'reasons',v_reasons,'source_exposure',v_exposure);
end $$;

-- Serialize all source evidence changes against funding's household-first lock.
create or replace function finance.budget_lock_source_household()
returns trigger language plpgsql security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare v_old uuid; v_new uuid; v_id uuid;
begin
  if tg_op <> 'INSERT' then v_old := nullif(to_jsonb(old)->>'household_id','')::uuid; end if;
  if tg_op <> 'DELETE' then v_new := nullif(to_jsonb(new)->>'household_id','')::uuid; end if;
  for v_id in select x from unnest(array[v_old,v_new]) x where x is not null group by x order by x loop
    perform 1 from finance.households h where h.id=v_id for update;
  end loop;
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$
declare v_table regclass; v_name text;
begin
  foreach v_table in array array[
    'public.accounts'::regclass,'public.snapshots'::regclass,'public.transactions'::regclass,
    'finance.budget_account_settings'::regclass,'finance.transaction_classifications'::regclass,
    'finance.transaction_treatments'::regclass,'finance.financial_events'::regclass,
    'finance.financial_event_legs'::regclass,'finance.transaction_source_observations'::regclass
  ] loop
    v_name := 'budget_source_household_lock';
    execute format('drop trigger if exists %I on %s',v_name,v_table);
    execute format('create trigger %I before insert or update or delete on %s for each row execute function finance.budget_lock_source_household()',v_name,v_table);
  end loop;
end $$;

-- Final stage-3 implementation.  Keep the client supplied coverage shape
-- separate from source evidence: the latter is created only by the server and
-- is immutable once the reconciliation row has been written.
create or replace function finance.budget_source_state_snapshot(
  p_household uuid, p_coverage jsonb
) returns jsonb
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare v_account jsonb; v_sources jsonb; v_out jsonb := '[]'::jsonb; v_source jsonb;
begin
  for v_account in select value from jsonb_array_elements(coalesce(p_coverage->'accounts','[]'::jsonb)) order by value->>'account_id' loop
    select coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id', t.id, 'account_id', t.account_id::text,
      'source_system', t.source_system,
      'source_transaction_id', coalesce(t.source_transaction_id,t.id),
      'amount_cents', s->>'amount_cents',
      'effective_at', case when finance.budget_source_effective_at(t) is null then null
        else to_char(finance.budget_source_effective_at(t) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'pending', t.source_is_pending, 'archived', t.source_is_archived,
      'source_fingerprint', s->>'source_fingerprint') order by t.id), '[]'::jsonb)
    into v_sources
    from public.transactions t
    cross join lateral (select finance.budget_source_snapshot(p_household,t.id) as s) z
    where t.household_id=p_household and t.account_id::text=v_account->>'account_id';
    v_out := v_out || jsonb_build_array(v_account || jsonb_build_object(
      'source_state_snapshot',jsonb_build_object('schema_version',1,'sources',v_sources)));
  end loop;
  return p_coverage || jsonb_build_object('accounts',v_out);
end $$;

create or replace function finance.budget_source_exposure(
  p_household uuid, p_coverage jsonb, p_asof timestamptz
) returns jsonb
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC' as $$
declare
  a jsonb; t public.transactions%rowtype; s jsonb; base jsonb; baseline jsonb;
  reasons jsonb := '[]'::jsonb; adjustments jsonb := '[]'::jsonb; funds jsonb := '{}'::jsonb;
  review_groups jsonb := '{}'::jsonb;
  included text[]; skip_ids text[] := '{}'; source_ids jsonb; group_ids text[];
  cutoff timestamptz; observed boolean; known boolean := true; arithmetic boolean := true;
  cents bigint; delta numeric := 0; fdelta jsonb; category uuid; line_kind text; fund uuid; matches integer;
  setrow record; frozen bigint; live bigint; extra numeric; source_time timestamptz;
  group_ok boolean; group_pending_included boolean; group_has_pending boolean; group_rep text; group_count integer; group_event uuid;
  prior_unreflected boolean; observed_at timestamptz;
  review_tx public.transactions%rowtype; review_cutoff timestamptz; review_reflected boolean;
  review_fund uuid; review_fund_ok boolean; drift_funds jsonb; review_snap jsonb; review_base jsonb; checked_funds jsonb:='{}'::jsonb;
  review_group jsonb; review_source_ids jsonb; review_account text; frozen_time timestamptz;
begin
  if p_asof is null or not isfinite(p_asof) then perform finance.budget_fail('budget_invalid','as_of must be finite'); end if;
  for a in select value from jsonb_array_elements(coalesce(p_coverage->'accounts','[]'::jsonb)) order by value->>'account_id' loop
    if a->>'status' <> 'included' then continue; end if;
    cutoff := nullif(a->>'activity_through','')::timestamptz;
    observed_at := nullif(a->'snapshot_snapshot'->>'observed_at','')::timestamptz;
    if observed_at is not null then cutoff := least(cutoff,observed_at); end if;
    if cutoff is null then
      reasons := reasons || jsonb_build_array(jsonb_build_object('code','activity_through_missing','account_id',a->>'account_id'));
      known := false; arithmetic := false; continue;
    end if;
    included := coalesce(array(select jsonb_array_elements_text(a->'pending_included_ids')),'{}');
    baseline := a->'source_state_snapshot'->'sources';
    for t in select x.* from public.transactions x
      where x.household_id=p_household and x.account_id::text=a->>'account_id'
      order by x.id loop
      if t.id = any(skip_ids) then continue; end if;
      observed:=false;
      source_time := finance.budget_source_effective_at(t);
      if source_time is null then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_time_unknown','account_id',a->>'account_id','transaction_id',t.id));
        known := false; arithmetic := false; continue;
      end if;
      if source_time > p_asof then continue; end if;
      select value into base from jsonb_array_elements(coalesce(baseline,'[]'::jsonb)) where value->>'transaction_id'=t.id limit 1;
      -- An archived reviewed source is conservatively represented by its
      -- frozen journal; active reviewed rows still validate any identity group.
      if t.source_is_archived is true and exists(select 1 from finance.budget_allocation_sets x
        where x.household_id=p_household and x.transaction_id=t.id and x.status in ('current','needs_review')) then
        continue;
      end if;
      if t.source_is_pending is null or t.source_is_archived is null then
        reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_unverified','account_id',a->>'account_id','transaction_id',t.id));
        known:=false; arithmetic:=false; continue;
      end if;
      if t.source_is_archived is true then
        if base is not null then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_unverified','account_id',a->>'account_id','transaction_id',t.id));
          known := false; arithmetic := false;
        end if;
        continue;
      end if;
      begin s := finance.budget_source_snapshot(p_household,t.id); exception when others then s := null; end;
      if s is null or not coalesce((s->>'complete')::boolean,false) or s->>'amount_cents' is null then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_unverified','account_id',a->>'account_id','transaction_id',t.id));
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_activity_unreconciled','account_id',a->>'account_id','transaction_id',t.id));
        known := false; arithmetic := false; continue;
      end if;
      cents := (s->>'amount_cents')::bigint;
      -- A changed provider row is only a lifecycle transition where the frozen
      -- amount and identity facts still prove it.  Provider dates never prove
      -- inclusion on their own.
      prior_unreflected := false;
      if t.source_is_pending is false and observed_at is not null then
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
        ) into prior_unreflected;
      end if;
      if prior_unreflected then
        observed := false;
      elsif base is not null and coalesce((base->>'pending')::boolean,false) and t.source_is_pending is false then
        if base->>'account_id' is distinct from t.account_id::text
           or base->>'amount_cents' is distinct from cents::text
           or (base ? 'source_system' and base->>'source_system' is distinct from t.source_system)
           or (base ? 'source_transaction_id' and base->>'source_transaction_id' is distinct from coalesce(t.source_transaction_id,t.id)) then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_unverified','account_id',a->>'account_id','transaction_id',t.id));
          known := false; arithmetic := false; continue;
        end if;
        observed := t.id = any(included);
      elsif t.source_is_pending is true then
        observed := t.id = any(included);
      elsif base is null and source_time <= cutoff and baseline is not null and not exists(
        select 1 from finance.financial_event_legs gl join finance.financial_events ge
          on ge.household_id=gl.household_id and ge.id=gl.event_id
        where gl.household_id=p_household and gl.transaction_id=t.id and gl.status='active'
          and ge.status='confirmed' and ge.event_type='purchase') then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_balance_inclusion_unknown','account_id',a->>'account_id','transaction_id',t.id));
        known := false; arithmetic := false; continue;
      else
        observed := source_time <= cutoff;
      end if;

      -- Confirmed purchase identity is a closed group: exactly one active
      -- economic recognition and every other active leg is mirror/staging on
      -- this account with the same normalized negative amount.
      group_ok := false; group_rep := null; group_ids := null;
      select l.event_id into group_event from finance.financial_event_legs l join finance.financial_events e
        on e.household_id=l.household_id and e.id=l.event_id
      where l.household_id=p_household and l.transaction_id=t.id and l.status='active'
        and e.status='confirmed' and e.event_type='purchase' order by l.event_id limit 1;
      if group_event is not null then
        select count(*) filter(where l.leg_role='economic_recognition'),
          max(l.transaction_id) filter(where l.leg_role='economic_recognition'),
          array_agg(l.transaction_id order by l.transaction_id), bool_or(q.source_is_pending)
          into group_count, group_rep, group_ids, group_has_pending
        from finance.financial_event_legs l join public.transactions q on q.household_id=l.household_id and q.id=l.transaction_id
        where l.household_id=p_household and l.event_id=group_event and l.status='active';
      else group_count:=0; group_has_pending:=false; end if;
      if group_event is not null and exists(select 1 from finance.financial_event_legs l where l.household_id=p_household and l.transaction_id=t.id
        and l.status='active' and l.event_id<>group_event) then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_identity_ambiguous','account_id',a->>'account_id','transaction_id',t.id));
        known := false; arithmetic := false; continue;
      end if;
      if group_event is not null then
        select bool_and(cents < 0 and q.account_id=t.account_id and q.source_is_archived is false
          and finance.budget_source_effective_at(q) is not null and finance.budget_source_effective_at(q)<=p_asof
          and coalesce((ss->>'complete')::boolean,false) and ss->>'amount_cents'=cents::text
          and ((l.leg_role='economic_recognition' and q.source_is_pending is false)
            or (l.leg_role in ('mirror','staging') and q.source_is_pending is true)))
          into group_ok
        from finance.financial_event_legs l join finance.financial_events e on e.household_id=l.household_id and e.id=l.event_id
        join public.transactions q on q.household_id=l.household_id and q.id=l.transaction_id
        cross join lateral (select finance.budget_source_snapshot(p_household,q.id) ss) z
        where l.household_id=p_household and l.event_id=group_event
          and l.status='active' and e.status='confirmed' and e.event_type='purchase';
        if group_count <> 1 or not group_ok or group_rep is null then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_identity_ambiguous','account_id',a->>'account_id','transaction_id',t.id));
          known := false; arithmetic := false; continue;
        end if;
        source_ids := to_jsonb(group_ids);
        select exists(select 1 from unnest(group_ids) id where id=any(included)) into group_pending_included;
        if base is null and source_time<=cutoff and baseline is not null and not group_pending_included then
          reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_balance_inclusion_unknown','account_id',a->>'account_id','transaction_id',group_rep));
          known:=false; arithmetic:=false; continue;
        end if;
        observed := coalesce(observed,false) or group_pending_included;
        review_groups:=jsonb_set(review_groups,array[group_rep],jsonb_build_object(
          'source_ids',source_ids,'reflected',observed,'identity_basis','confirmed_purchase_event'),true);
        if t.id <> group_rep then continue; end if;
        skip_ids := skip_ids || group_ids;
      else
        source_ids := jsonb_build_array(t.id);
      end if;
      if exists(select 1 from finance.budget_allocation_sets x where x.household_id=p_household
        and x.transaction_id=t.id and x.status in ('current','needs_review')) then
        review_groups:=jsonb_set(review_groups,array[t.id],jsonb_build_object(
          'source_ids',source_ids,'reflected',coalesce(observed,false),
          'identity_basis',case when group_rep is null then 'same_provider_id' else 'confirmed_purchase_event' end),true);
        continue;
      end if;
      if t.source_is_pending is true then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','pending_activity_provisional','account_id',a->>'account_id','transaction_id',t.id));
      end if;
      -- Unlinked same-account amount/date matches are deliberately not identity.
      if t.source_is_pending and not (t.id=any(included)) and exists (
        select 1 from public.transactions q cross join lateral (select finance.budget_source_snapshot(p_household,q.id) ss) z
        where q.household_id=p_household and q.account_id=t.account_id and q.id<>t.id and q.source_is_pending is false
          and q.source_is_archived is distinct from true and ss->>'amount_cents'=cents::text
          and q.occurred_on is not null and t.occurred_on is not null and abs(q.occurred_on-t.occurred_on)<=7
          and finance.budget_source_effective_at(q)<=p_asof) then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','pending_identity_ambiguous','account_id',a->>'account_id','transaction_id',t.id));
        known := false; arithmetic := false;
      end if;
      fdelta := '{}'::jsonb;
      if t.source_is_pending and cents < 0 and (s->'event'->>'id' is null or
        (s->'event'->>'type'='purchase' and s->'event'->>'status'='confirmed' and s->'event'->>'leg_role'='economic_recognition')) then
        select c.category_id, case tr.nature when 'consumption' then 'consumption' when 'contribution' then 'contribution'
          when 'required_debt_payment' then 'debt_commitment' when 'extra_debt_payment' then 'debt_commitment' end
          into category,line_kind from finance.transaction_classifications c join finance.transaction_treatments tr
          on tr.household_id=c.household_id and tr.transaction_id=c.transaction_id and tr.status='confirmed'
          where c.household_id=p_household and c.transaction_id=t.id and c.status='confirmed'
            and tr.is_transfer=false and tr.exclude_from_spend=false
            and tr.nature in ('consumption','contribution','required_debt_payment','extra_debt_payment');
        if category is not null then
          select count(*),(array_agg(l.fund_id order by l.fund_id))[1] into matches,fund from finance.budget_lines l
          where l.household_id=p_household and l.version_id=nullif(finance.budget_plan_versions(p_household,finance.budget_cycle_start((source_time at time zone 'Africa/Johannesburg')::date),p_asof)->>'current_version_id','')::uuid
            and l.match_category_id=category and l.kind=line_kind;
          if matches=1 and not exists(select 1 from finance.funds f where f.household_id=p_household and f.id=fund and f.status<>'active')
             and not exists(select 1 from finance.fund_earmarks fe where fe.household_id=p_household and fe.fund_id=fund) then
            fdelta:=jsonb_build_object(fund::text,(-abs(cents::numeric))::text);
            funds:=jsonb_set(funds,array[fund::text],to_jsonb((coalesce((funds->>fund::text)::numeric,0)-abs(cents::numeric))::text),true);
          elsif matches=1 then
            reasons:=reasons||jsonb_build_array(jsonb_build_object('code','fund_location_unknown','transaction_id',t.id,'fund_id',fund::text)); known:=false; arithmetic:=false;
          end if;
        end if;
      elsif cents < 0 and (finance.budget_opening_cutover(p_household) is null or t.occurred_on is null
        or t.occurred_on>=finance.budget_opening_cutover(p_household) or t.source_is_pending)
        and not exists(select 1 from finance.budget_allocation_sets x where x.household_id=p_household and x.transaction_id=t.id and x.status in ('current','needs_review')) then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','purpose_exposure_unresolved','account_id',a->>'account_id','transaction_id',t.id));
      elsif cents > 0 and not observed then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','income_after_observation_unreconciled','account_id',a->>'account_id','transaction_id',t.id)); known:=false; arithmetic:=false;
      end if;
      if cents<0 and not observed then delta:=delta+cents; end if;
      if not observed or t.source_is_pending then
        adjustments:=adjustments||jsonb_build_array(jsonb_build_object('transaction_id',coalesce(group_rep,t.id),'account_id',a->>'account_id','set_id',null,'source_ids',source_ids,
          'kind',case when t.source_is_pending then 'pending' else 'posted_after_observation' end,'amount_cents',abs(cents::numeric)::text,
          'resource_delta_cents',case when cents<0 and not observed then cents::text else '0' end,'fund_deltas',fdelta,'reflected_in_balance',observed,
          'identity_basis',case when group_rep is null then 'same_provider_id' else 'confirmed_purchase_event' end,'reasons','[]'::jsonb));
      end if;
    end loop;
  end loop;
  -- Frozen reviewed journal: changes can add a debit, never release one.
  for setrow in select s.* from finance.budget_allocation_sets s where s.household_id=p_household and s.status in ('current','needs_review') order by s.id loop
    frozen:=setrow.source_amount_cents; live:=null;
    select * into review_tx from public.transactions where household_id=p_household and id=setrow.transaction_id;
    review_account:=coalesce(setrow.source_snapshot->>'account_id',review_tx.account_id::text);
    frozen_time:=coalesce(nullif(setrow.source_snapshot->>'effective_at','')::timestamptz,
      nullif(setrow.source_snapshot->>'posted_at','')::timestamptz,
      case when setrow.source_snapshot->>'occurred_on' is null then null
        else ((setrow.source_snapshot->>'occurred_on')::date::timestamp at time zone 'Africa/Johannesburg') end,
      nullif(setrow.source_snapshot->>'date','')::timestamptz);
    source_time:=case when review_tx.source_is_archived is true then nullif(setrow.source_snapshot->>'effective_at','')::timestamptz else finance.budget_source_effective_at(review_tx) end;
    if source_time is null and review_tx.source_is_archived is true and setrow.source_snapshot->>'occurred_on' is not null then
      source_time:=((setrow.source_snapshot->>'occurred_on')::date::timestamp at time zone 'Africa/Johannesburg');
    end if;
    if frozen_time is not null and frozen_time>p_asof then continue; end if;
    if review_tx.source_is_archived is not true and (review_tx.account_id::text is distinct from review_account
      or (frozen_time is not null and finance.budget_source_effective_at(review_tx) is distinct from frozen_time)) then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_allocation_stale','transaction_id',setrow.transaction_id));
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_unverified','transaction_id',setrow.transaction_id)); known:=false; arithmetic:=false; continue;
    end if;
    select least(nullif(x->>'activity_through','')::timestamptz,nullif(x->'snapshot_snapshot'->>'observed_at','')::timestamptz)
      into review_cutoff from jsonb_array_elements(coalesce(p_coverage->'accounts','[]'::jsonb)) x where x->>'account_id'=review_account limit 1;
    select src.value into review_base from jsonb_array_elements(coalesce(p_coverage->'accounts','[]'::jsonb)) ca
      cross join lateral jsonb_array_elements(coalesce(ca.value->'source_state_snapshot'->'sources','[]'::jsonb)) src
      where ca.value->>'account_id'=review_tx.account_id::text and src.value->>'transaction_id'=setrow.transaction_id limit 1;
    review_reflected := case when review_base is not null and coalesce((review_base->>'pending')::boolean,false)
      then exists(select 1 from jsonb_array_elements(coalesce(p_coverage->'accounts','[]'::jsonb)) ca
        cross join lateral jsonb_array_elements_text(coalesce(ca.value->'pending_included_ids','[]'::jsonb)) pi
        where ca.value->>'account_id'=review_tx.account_id::text and pi=setrow.transaction_id)
      else source_time is not null and review_cutoff is not null and source_time<=review_cutoff end;
    review_group:=review_groups->setrow.transaction_id;
    if review_group is not null then review_reflected:=coalesce((review_group->>'reflected')::boolean,false); end if;
    review_source_ids:=coalesce(review_group->'source_ids',jsonb_build_array(setrow.transaction_id));
    begin
      if review_tx.source_is_archived is distinct from true then
        review_snap:=finance.budget_source_snapshot(p_household,setrow.transaction_id);
        live:=(review_snap->>'amount_cents')::bigint;
      end if;
    exception when others then review_snap:=null; live:=null; end;
    if live is null then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_allocation_stale','transaction_id',setrow.transaction_id));
      if frozen<0 and not review_reflected then
        delta:=delta+frozen;
        adjustments:=adjustments||jsonb_build_array(jsonb_build_object('transaction_id',setrow.transaction_id,'account_id',review_tx.account_id::text,'set_id',setrow.id::text,
          'source_ids',review_source_ids,'kind','source_drift','amount_cents',abs(frozen::numeric)::text,
          'resource_delta_cents',frozen::text,'fund_deltas','{}'::jsonb,'reflected_in_balance',false,'identity_basis',coalesce(review_group->>'identity_basis','same_provider_id'),
          'reasons',jsonb_build_array(jsonb_build_object('code','source_allocation_stale'))));
      end if;
    elsif live=frozen and review_snap->>'source_fingerprint'=setrow.source_fingerprint and not review_reflected and frozen<0 then
      delta:=delta+frozen;
      adjustments:=adjustments||jsonb_build_array(jsonb_build_object('transaction_id',setrow.transaction_id,'account_id',review_tx.account_id::text,'set_id',setrow.id::text,
        'source_ids',review_source_ids,'kind','source_drift','amount_cents',abs(frozen::numeric)::text,
        'resource_delta_cents',frozen::text,'fund_deltas','{}'::jsonb,'reflected_in_balance',false,'identity_basis',coalesce(review_group->>'identity_basis','same_provider_id'),'reasons','[]'::jsonb));
    elsif live is distinct from frozen or review_snap->>'source_fingerprint' is distinct from setrow.source_fingerprint then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','source_allocation_stale','transaction_id',setrow.transaction_id));
      extra:=greatest(frozen::numeric-live::numeric,0);
      if not review_reflected and frozen<0 then
        -- A shrink, reversal-looking value, or sign flip never releases the
        -- frozen reviewed outflow before a fresh reflected observation.
        delta:=delta-greatest(-frozen::numeric,coalesce(-live::numeric,0),0);
      elsif extra>0 then delta:=delta-extra; end if;
      drift_funds:='{}'::jsonb; review_fund_ok:=false; review_fund:=null;
      select count(*)>0 and count(distinct ba.fund_id)=1 and count(*) filter(where ba.fund_id is null)=0
          and bool_and(ba.amount_cents<0 and ba.effect_kind in ('consumption','contribution','required_debt_payment','extra_debt_payment')),
        (array_agg(ba.fund_id order by ba.fund_id))[1] into review_fund_ok,review_fund
      from finance.budget_allocations ba where ba.household_id=p_household and ba.set_id=setrow.id;
      if extra>0 and review_fund_ok and (finance.budget_opening_cutover(p_household) is null or review_tx.occurred_on>=finance.budget_opening_cutover(p_household)) then
        drift_funds:=jsonb_build_object(review_fund::text,(-extra)::text);
        funds:=jsonb_set(funds,array[review_fund::text],to_jsonb((coalesce((funds->>review_fund::text)::numeric,0)-extra)::text),true);
      end if;
      adjustments:=adjustments||jsonb_build_array(jsonb_build_object('transaction_id',setrow.transaction_id,'account_id',review_tx.account_id::text,'set_id',setrow.id::text,
        'source_ids',review_source_ids,'kind','source_drift','amount_cents',case when extra>0 then extra::numeric else abs(frozen::numeric) end::text,
        'resource_delta_cents',case when not review_reflected and frozen<0 then (-greatest(-frozen::numeric,coalesce(-live::numeric,0),0)) when extra>0 then -extra else 0 end::text,
        'fund_deltas',drift_funds,'reflected_in_balance',review_reflected,'identity_basis',coalesce(review_group->>'identity_basis','same_provider_id'),'reasons',jsonb_build_array(jsonb_build_object('code','source_allocation_stale'))));
    end if;
  end loop;
  if exists(select 1 from finance.budget_allocation_sets x where x.household_id=p_household and x.status='needs_review') then reasons:=reasons||jsonb_build_array(jsonb_build_object('code','allocation_needs_review')); end if;
  if exists(select 1 from finance.budget_allocations ba join finance.budget_allocation_sets bs
    on bs.household_id=ba.household_id and bs.id=ba.set_id
    where ba.household_id=p_household and bs.status in ('current','needs_review') and ba.effect_kind='unresolved') then
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','purpose_exposure_unresolved'));
  end if;
  for fund, fdelta in select key, value from jsonb_each(funds) loop
    checked_funds:=jsonb_set(checked_funds,array[fund::text],to_jsonb(finance.budget_checked_bigint((fdelta#>>'{}')::numeric)::text),true);
  end loop;
  select coalesce(jsonb_agg(value order by value->>'account_id',value->>'transaction_id',value->>'set_id'),'[]'::jsonb)
    into adjustments from jsonb_array_elements(adjustments);
  return jsonb_build_object('complete',jsonb_array_length(reasons)=0,'reasons',reasons,'adjustments',adjustments,
    'resource_delta_cents',case when arithmetic then finance.budget_checked_bigint(delta)::text else null end,
    'fund_deltas',checked_funds,'provisional_known',known and arithmetic);
end $$;

-- Revalidation validates the original client facts, then puts the server-only
-- baseline back for exposure.  Client validation never sees this field.
create or replace function finance.budget_reconciliation_state(p_household uuid, p_reconciliation uuid, p_checked_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare r finance.budget_reconciliations%rowtype; client jsonb; base jsonb; exposure jsonb; rs jsonb; drift jsonb:='[]'::jsonb;
  old_a jsonb; new_a jsonb; merged_accounts jsonb; n integer:=0; legacy_reasons jsonb:='[]'::jsonb; reason jsonb;
begin
  select * into r from finance.budget_reconciliations where household_id=p_household and id=p_reconciliation;
  if not found then perform finance.budget_fail('budget_not_found','reconciliation not found'); end if;
  if p_checked_at is null or not isfinite(p_checked_at) or p_checked_at<r.as_of then perform finance.budget_fail('budget_invalid','checked_at must be finite and no earlier than as_of'); end if;
  client:=jsonb_build_object('schema_version',r.coverage_snapshot->'schema_version','accounts',coalesce((select jsonb_agg(value-'settings_snapshot'-'snapshot_snapshot'-'pending_source_facts'-'normalized_cash_cents'-'normalized_debt_cents'-'source_state_snapshot') from jsonb_array_elements(r.coverage_snapshot->'accounts')),'[]'::jsonb),'utility_coverage',r.coverage_snapshot->'utility_coverage','evidence',r.coverage_snapshot->'evidence');
  base:=finance.budget_check_coverage_base(p_household,client,p_checked_at);
  -- The old checker only knew the blanket activity gate.  Keep every other
  -- validation guard, while lifecycle proof is allowed to discharge its old
  -- pending-source assertion; the frozen-baseline engine supplies the actual
  -- source confidence reasons below.
  for reason in select value from jsonb_array_elements(base->'reasons') loop
    if reason->>'code'='source_activity_unreconciled' then continue; end if;
    if reason->>'code'='pending_source_unverified' and exists(
      select 1 from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) oa
      where oa->>'account_id'=reason->>'account_id'
    ) and not exists(
      select 1 from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) oa
      where oa->>'account_id'=reason->>'account_id'
        and not finance.budget_pending_lifecycle_proved(p_household,coalesce(oa->'pending_source_facts','[]'::jsonb))
    ) then continue; end if;
    legacy_reasons:=legacy_reasons||jsonb_build_array(reason);
  end loop;
  base:=base||jsonb_build_object('reasons',legacy_reasons);
  select coalesce(jsonb_agg(n.value || jsonb_build_object(
    'source_state_snapshot',o.value->'source_state_snapshot') order by n.ord),'[]'::jsonb)
    into merged_accounts
  from jsonb_array_elements(base->'coverage_snapshot'->'accounts') with ordinality n(value,ord)
  join jsonb_array_elements(r.coverage_snapshot->'accounts') with ordinality o(value,ord) using(ord);
  base:=base||jsonb_build_object('coverage_snapshot',
    (base->'coverage_snapshot')||jsonb_build_object('accounts',merged_accounts));
  exposure:=finance.budget_source_exposure(p_household,base->'coverage_snapshot',p_checked_at);
  for old_a in select value from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) loop
    new_a:=(base->'coverage_snapshot'->'accounts')->n;
    if old_a->'pending_source_facts' is distinct from new_a->'pending_source_facts'
       and not finance.budget_pending_lifecycle_proved(p_household,coalesce(old_a->'pending_source_facts','[]'::jsonb)) then
      drift:=drift||jsonb_build_array(jsonb_build_object('code','pending_source_drift','account_id',old_a->>'account_id'));
    end if;
    n:=n+1;
  end loop;
  if r.coverage_snapshot->'inventory' is distinct from base->'coverage_snapshot'->'inventory' then
    drift:=drift||jsonb_build_array(jsonb_build_object('code','inventory_drift'));
  end if;
  rs:=base||jsonb_build_object('status',case when jsonb_array_length((base->'reasons')||(exposure->'reasons')||drift)=0 then 'complete' else 'incomplete' end,'reasons',(base->'reasons')||(exposure->'reasons')||drift,'source_exposure',exposure);
  if r.status='incomplete' then rs:=rs||jsonb_build_object('status','incomplete','reasons',(rs->'reasons')||jsonb_build_array(jsonb_build_object('code','historic_incomplete'))); end if;
  return jsonb_build_object('status',rs->>'status','reasons',rs->'reasons','reconciliation_fingerprint',finance.budget_hash(jsonb_build_object('id',r.id::text,'as_of',to_char(r.as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',r.opening_fund_cutover::text,'coverage_snapshot',r.coverage_snapshot)));
end $$;

revoke all on function finance.budget_source_state_snapshot(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function finance.budget_source_exposure(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_reconciliation_state(uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_source_effective_at(public.transactions) from public,anon,authenticated,service_role;
revoke all on function finance.budget_pending_lifecycle_proved(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function finance.budget_check_coverage_base(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_check_coverage(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_lock_source_household() from public,anon,authenticated,service_role;
revoke all on function public.budget_record_reconciliation_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.budget_record_reconciliation_v1(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
