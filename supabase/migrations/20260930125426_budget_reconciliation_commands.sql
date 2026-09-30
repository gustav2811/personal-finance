-- Reconciliation evidence is deliberately fail-closed.  This migration never
-- turns absent source facts into a zero balance or a complete reconciliation.

create or replace function finance.budget_validate_coverage(p_coverage jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_account jsonb;
  v_utility jsonb;
  v_accounts jsonb := '[]'::jsonb;
  v_pending jsonb;
  v_id text;
  v_seen_accounts text[] := '{}';
  v_seen_pending text[];
  v_status text;
  v_snapshot_date date;
  v_activity timestamptz;
  v_eligible bigint;
begin
  perform finance.budget_validate_object(p_coverage,
    array['schema_version','accounts','utility_coverage','evidence'], array[]::text[]);
  if finance.budget_integer(p_coverage, 'schema_version', 1, 1) <> 1
     or jsonb_typeof(p_coverage->'accounts') <> 'array' then
    perform finance.budget_fail('budget_invalid', 'coverage schema_version or accounts is invalid');
  end if;
  perform finance.budget_text(p_coverage, 'evidence');
  v_utility := p_coverage->'utility_coverage';
  perform finance.budget_validate_object(v_utility, array['status','evidence'], array[]::text[]);
  if finance.budget_text(v_utility, 'status') not in ('not_required','verified','unknown') then
    perform finance.budget_fail('budget_invalid', 'utility coverage status is invalid');
  end if;
  perform finance.budget_text(v_utility, 'evidence');

  for v_account in select value from jsonb_array_elements(p_coverage->'accounts') loop
    perform finance.budget_validate_object(v_account,
      array['account_id','status','balance_convention','pending_included_ids','evidence'],
      array['settings_fingerprint','snapshot_date','snapshot_fingerprint','activity_through','eligible_restricted_cents','restricted_evidence']);
    v_id := finance.budget_uuid(v_account, 'account_id')::text;
    if v_id = any(v_seen_accounts) then
      perform finance.budget_fail('budget_invalid', 'duplicate coverage account');
    end if;
    v_seen_accounts := array_append(v_seen_accounts, v_id);
    v_status := finance.budget_text(v_account, 'status');
    if v_status not in ('included','excluded','missing') then
      perform finance.budget_fail('budget_invalid', 'coverage account status is invalid');
    end if;
    if v_status = 'missing' then
      perform finance.budget_text(v_account, 'settings_fingerprint', true);
    elsif finance.budget_text(v_account, 'settings_fingerprint', true) is null then
      perform finance.budget_fail('budget_invalid', 'settings_fingerprint is required unless status is missing');
    end if;
    if finance.budget_text(v_account, 'balance_convention') not in ('cash_signed','debt_positive','debt_negative','unknown') then
      perform finance.budget_fail('budget_invalid', 'balance convention is invalid');
    end if;
    perform finance.budget_text(v_account, 'evidence');
    v_snapshot_date := finance.budget_date(v_account, 'snapshot_date', true);
    if (v_snapshot_date is null) is distinct from (finance.budget_text(v_account, 'snapshot_fingerprint', true) is null) then
      perform finance.budget_fail('budget_invalid', 'snapshot date and fingerprint must be supplied together');
    end if;
    v_activity := finance.budget_timestamp(v_account, 'activity_through', true);
    v_eligible := finance.budget_cents(v_account, 'eligible_restricted_cents', true);
    if (v_eligible is null) is distinct from (finance.budget_text(v_account, 'restricted_evidence', true) is null) then
      perform finance.budget_fail('budget_invalid', 'restricted eligibility and evidence must be supplied together');
    end if;
    if v_eligible is not null and v_eligible < 0 then
      perform finance.budget_fail('budget_invalid', 'eligible restricted cents must be nonnegative');
    end if;
    if jsonb_typeof(v_account->'pending_included_ids') <> 'array' then
      perform finance.budget_fail('budget_invalid', 'pending_included_ids must be an array');
    end if;
    v_seen_pending := '{}';
    for v_pending in select value from jsonb_array_elements(v_account->'pending_included_ids') loop
      if jsonb_typeof(v_pending) <> 'string' or btrim(v_pending #>> '{}') = '' then
        perform finance.budget_fail('budget_invalid', 'pending transaction id is invalid');
      end if;
      v_id := btrim(v_pending #>> '{}');
      if v_id = any(v_seen_pending) then perform finance.budget_fail('budget_invalid', 'duplicate pending transaction id'); end if;
      v_seen_pending := array_append(v_seen_pending, v_id);
    end loop;
    v_accounts := v_accounts || jsonb_build_array(jsonb_build_object(
      'account_id', finance.budget_uuid(v_account,'account_id')::text,
      'status', v_status,
      'settings_fingerprint', finance.budget_text(v_account,'settings_fingerprint',true),
      'snapshot_date', case when v_snapshot_date is null then null else v_snapshot_date::text end,
      'snapshot_fingerprint', finance.budget_text(v_account,'snapshot_fingerprint',true),
      'balance_convention', finance.budget_text(v_account,'balance_convention'),
      'activity_through', case when v_activity is null then null else to_char(v_activity at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
      'pending_included_ids', to_jsonb(v_seen_pending),
      'eligible_restricted_cents', case when v_eligible is null then null else v_eligible::text end,
      'restricted_evidence', finance.budget_text(v_account,'restricted_evidence',true),
      'evidence', finance.budget_text(v_account,'evidence')));
  end loop;
  return jsonb_build_object('schema_version',1,'accounts',v_accounts,
    'utility_coverage',jsonb_build_object('status',finance.budget_text(v_utility,'status'),'evidence',finance.budget_text(v_utility,'evidence')),
    'evidence',finance.budget_text(p_coverage,'evidence'));
end $$;

create or replace function finance.budget_check_coverage(p_household uuid, p_coverage jsonb, p_as_of timestamptz)
returns jsonb
language plpgsql
stable
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_entry jsonb; v_settings jsonb; v_snapshot jsonb; v_pending jsonb;
  v_inventory jsonb := '[]'::jsonb; v_accounts jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb; v_current_ids text[] := '{}'; v_covered_ids text[] := '{}';
  v_id uuid; v_observed timestamptz;
  v_freshness integer; v_class text; v_included boolean;
  v_normalized_cash text; v_normalized_debt text;
begin
  if p_as_of is null or not isfinite(p_as_of) or p_as_of > statement_timestamp() then
    perform finance.budget_fail('budget_invalid', 'as_of must be finite and not in the future');
  end if;
  -- The canonical shape is accepted from the public wrapper and rechecked here
  -- because private callers must not be able to bypass structural validation.
  p_coverage := finance.budget_validate_coverage(p_coverage);
  for v_id in select account_id from public.accounts where household_id=p_household and archived_at is null and lifecycle_status <> 'archived' order by account_id loop
    v_current_ids := array_append(v_current_ids,v_id::text); v_inventory := v_inventory || jsonb_build_array(v_id::text);
  end loop;
  for v_entry in select value from jsonb_array_elements(p_coverage->'accounts') loop
    v_id := (v_entry->>'account_id')::uuid; v_covered_ids := array_append(v_covered_ids,v_id::text); v_settings := null; v_snapshot := null; v_normalized_cash := null; v_normalized_debt := null;
    if exists (select 1 from public.accounts where account_id=v_id and household_id <> p_household) then
      perform finance.budget_fail('budget_forbidden', 'coverage account belongs to another household');
    end if;
    if not exists (select 1 from public.accounts where account_id=v_id and household_id=p_household) then
      perform finance.budget_fail('budget_forbidden', 'coverage account is unknown');
    end if;
    -- Pending ownership is a security boundary and must be checked before an
    -- archived account takes the inventory-incomplete branch below.
    if exists (select 1 from public.transactions t where t.id in (select jsonb_array_elements_text(v_entry->'pending_included_ids')) and t.household_id <> p_household) then
      perform finance.budget_fail('budget_forbidden', 'pending transaction belongs to another household');
    end if;
    if exists (select 1 from public.transactions t where t.household_id=p_household and t.id in (select jsonb_array_elements_text(v_entry->'pending_included_ids')) and t.account_id is distinct from v_id) then
      perform finance.budget_fail('budget_forbidden', 'pending transaction belongs to another account');
    end if;
    if not (v_id::text = any(v_current_ids)) then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','inventory_account_missing_or_foreign','account_id',v_id::text));
      -- Preserve an owned archived/otherwise non-current assertion in the
      -- immutable evidence.  Dropping it would let later inventory changes
      -- erase the original incomplete evidence during revalidation.
      v_accounts := v_accounts || jsonb_build_array(v_entry || jsonb_build_object('settings_snapshot',null,'snapshot_snapshot',null,'pending_source_facts','[]'::jsonb,'normalized_cash_cents',null,'normalized_debt_cents',null));
      continue;
    end if;
    select finance.budget_settings_snapshot(p_household,v_id) into v_settings;
    if v_settings is null then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','settings_missing','account_id',v_id::text)); end if;
    if v_settings is not null and (v_entry->>'settings_fingerprint' is distinct from finance.budget_settings_fingerprint(p_household,v_id)) then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','settings_fingerprint_stale','account_id',v_id::text));
    end if;
    v_included := coalesce((v_settings->>'included')::boolean,false); v_class := v_settings->>'resource_class'; v_freshness := nullif(v_settings->>'freshness_hours','')::integer;
    if v_entry->>'status' = 'excluded' then
      if v_settings is null or v_included or nullif(btrim(v_settings->>'exclusion_reason'),'') is null then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','excluded_account_not_configured','account_id',v_id::text));
      end if;
    elsif v_entry->>'status' <> 'included' or not v_included then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','account_not_included','account_id',v_id::text));
    else
      if v_entry->>'snapshot_date' is null then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','snapshot_missing','account_id',v_id::text));
      else
        select finance.budget_snapshot_snapshot(p_household,v_id,(v_entry->>'snapshot_date')::date) into v_snapshot;
        if v_snapshot is null or v_entry->>'snapshot_fingerprint' is distinct from finance.budget_snapshot_fingerprint(p_household,v_id,(v_entry->>'snapshot_date')::date) then
          v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','snapshot_fingerprint_stale','account_id',v_id::text));
        else
          v_observed := nullif(v_snapshot->>'observed_at','')::timestamptz;
          if v_snapshot->>'currency_code' is distinct from 'ZAR' or v_snapshot->>'account_currency_code' is distinct from 'ZAR'
             or (case when coalesce(v_snapshot->>'amount_cents','') ~ '^-?[0-9]+$' then (v_snapshot->>'amount_cents')::numeric between -9223372036854775808 and 9223372036854775807 else false end) is not true
             or v_observed is null or v_observed > p_as_of or v_freshness is null
             or extract(epoch from (p_as_of - v_observed)) / 3600 > v_freshness then
            v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','snapshot_unverified_or_stale','account_id',v_id::text));
          elsif v_entry->>'balance_convention' = 'unknown' or v_settings->>'transaction_sign_convention' = 'unknown' then
            v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','sign_convention_unknown','account_id',v_id::text));
          elsif (v_class='liquid' and v_entry->>'balance_convention' <> 'cash_signed') or (v_class='card' and v_entry->>'balance_convention' not in ('debt_positive','debt_negative')) then
            v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','balance_convention_invalid','account_id',v_id::text));
          elsif (v_class='card' and v_entry->>'balance_convention'='debt_positive' and (v_snapshot->>'amount_cents')::bigint < 0)
             or (v_class='card' and v_entry->>'balance_convention'='debt_negative' and (v_snapshot->>'amount_cents')::bigint > 0) then
            v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','card_debt_sign_contradiction','account_id',v_id::text));
          elsif v_class='restricted' or v_class='mortgage' then
            v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','restricted_resources_unverified','account_id',v_id::text));
          else
            -- Only freeze normalized values after the current server setting,
            -- fingerprint, source currency, observation time and convention
            -- have all passed.  Stage-gate uncertainty may still make the
            -- overall reconciliation incomplete, without invalidating a sound
            -- observation itself.
            if v_settings is not null
               and v_entry->>'settings_fingerprint' is not distinct from finance.budget_settings_fingerprint(p_household,v_id)
               and v_class='liquid' then
              v_normalized_cash := v_snapshot->>'amount_cents';
            elsif v_settings is not null
               and v_entry->>'settings_fingerprint' is not distinct from finance.budget_settings_fingerprint(p_household,v_id)
               and v_class='card' and v_entry->>'balance_convention'='debt_positive' then
              v_normalized_debt := v_snapshot->>'amount_cents';
            elsif v_settings is not null
               and v_entry->>'settings_fingerprint' is not distinct from finance.budget_settings_fingerprint(p_household,v_id)
               and v_class='card' and v_entry->>'balance_convention'='debt_negative' then
              v_normalized_debt := (-(v_snapshot->>'amount_cents')::numeric)::text;
            end if;
          end if;
          if v_class='restricted' and v_entry->>'eligible_restricted_cents' is not null
             and (case when coalesce(v_snapshot->>'amount_cents','') ~ '^-?[0-9]+$'
                        and (v_snapshot->>'amount_cents')::numeric between -9223372036854775808 and 9223372036854775807
                       then (v_entry->>'eligible_restricted_cents')::bigint > greatest((v_snapshot->>'amount_cents')::bigint,0)
                       else false end) then
            v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','restricted_eligibility_exceeds_balance','account_id',v_id::text));
          end if;
        end if;
      end if;
      if v_entry->>'activity_through' is null then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','activity_through_missing','account_id',v_id::text));
      elsif (v_entry->>'activity_through')::timestamptz > p_as_of then
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','activity_through_after_as_of','account_id',v_id::text));
      elsif exists (
        select 1 from public.transactions t
        where t.household_id=p_household and t.account_id=v_id
          and t.source_is_archived is distinct from true
          and (t.source_is_pending is true
               or coalesce(t.effective_at,t.posted_at,t.occurred_on::timestamp at time zone 'UTC',t.date) is null
               or coalesce(t.effective_at,t.posted_at,t.occurred_on::timestamp at time zone 'UTC',t.date) > (v_entry->>'activity_through')::timestamptz)
      ) then
        -- PR1 has no conservative transaction/purpose adjustment engine.  A
        -- post-observation source row (including declared pending) is evidence
        -- of uncertainty, never a zero adjustment.
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','source_activity_unreconciled','account_id',v_id::text));
      end if;
    end if;
    v_pending := coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'account_id',t.account_id::text,'pending',t.source_is_pending,'archived',t.source_is_archived,'occurred_on',t.occurred_on::text,'amount',t.amount::text) order by t.id)
      from public.transactions t where t.household_id=p_household and t.id in (select jsonb_array_elements_text(v_entry->'pending_included_ids'))),'[]'::jsonb);
    if jsonb_array_length(v_pending) <> jsonb_array_length(v_entry->'pending_included_ids') or exists (select 1 from jsonb_array_elements(v_pending) x where x->>'account_id' is distinct from v_id::text or coalesce((x->>'pending')::boolean,false) is not true or coalesce((x->>'archived')::boolean,false)) then
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','pending_source_unverified','account_id',v_id::text));
    end if;
    v_accounts := v_accounts || jsonb_build_array(v_entry || jsonb_build_object('settings_snapshot',v_settings,'snapshot_snapshot',v_snapshot,'pending_source_facts',v_pending,
      'normalized_cash_cents',v_normalized_cash,
      'normalized_debt_cents',v_normalized_debt));
  end loop;
  if cardinality(v_current_ids) <> cardinality(v_covered_ids)
     or exists (select 1 from unnest(v_current_ids) x where not (x = any(v_covered_ids))) then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','inventory_incomplete'));
  end if;
  if cardinality(v_current_ids) = 0 then
    v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','inventory_empty'));
  end if;
  if p_coverage->'utility_coverage'->>'status' <> 'not_required' then v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','utilities_unverified')); end if;
  return jsonb_build_object('status',case when jsonb_array_length(v_reasons)=0 then 'complete' else 'incomplete' end,'reasons',v_reasons,
    'coverage_snapshot',jsonb_build_object('schema_version',1,'accounts',v_accounts,'utility_coverage',p_coverage->'utility_coverage','evidence',p_coverage->'evidence','inventory',v_inventory));
end $$;

create or replace function finance.budget_reconciliation_state(p_household uuid, p_reconciliation uuid, p_checked_at timestamptz)
returns jsonb
language plpgsql
stable
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_row finance.budget_reconciliations%rowtype;
  v_check jsonb;
  v_old_account jsonb;
  v_new_account jsonb;
  v_drift jsonb := '[]'::jsonb;
  v_index integer := 0;
begin
  select * into v_row from finance.budget_reconciliations where household_id=p_household and id=p_reconciliation;
  if not found then perform finance.budget_fail('budget_not_found', 'reconciliation not found'); end if;
  if p_checked_at is null or not isfinite(p_checked_at) or p_checked_at < v_row.as_of then
    perform finance.budget_fail('budget_invalid', 'checked_at must be finite and no earlier than as_of');
  end if;
  -- Reuse the frozen client evidence and evaluate it at the requested present.
  v_check := finance.budget_check_coverage(p_household,
    jsonb_build_object('schema_version',v_row.coverage_snapshot->'schema_version','accounts',
      coalesce((select jsonb_agg(value - 'settings_snapshot' - 'snapshot_snapshot' - 'pending_source_facts' - 'normalized_cash_cents' - 'normalized_debt_cents') from jsonb_array_elements(v_row.coverage_snapshot->'accounts')),'[]'::jsonb),
      'utility_coverage',v_row.coverage_snapshot->'utility_coverage','evidence',v_row.coverage_snapshot->'evidence'), p_checked_at);
  for v_old_account in select value from jsonb_array_elements(v_row.coverage_snapshot->'accounts') loop
    v_new_account := (v_check->'coverage_snapshot'->'accounts')->v_index;
    if v_old_account->'pending_source_facts' is distinct from v_new_account->'pending_source_facts' then
      v_drift := v_drift || jsonb_build_array(jsonb_build_object('code','pending_source_drift','account_id',v_old_account->>'account_id'));
    end if;
    v_index := v_index + 1;
  end loop;
  if v_row.coverage_snapshot->'inventory' is distinct from v_check->'coverage_snapshot'->'inventory' then
    v_drift := v_drift || jsonb_build_array(jsonb_build_object('code','inventory_drift'));
  end if;
  if v_row.status = 'incomplete' then
    v_drift := v_drift || jsonb_build_array(jsonb_build_object('code','historic_incomplete'));
  end if;
  if jsonb_array_length(v_drift) > 0 then
    v_check := v_check || jsonb_build_object('status','incomplete','reasons',(v_check->'reasons') || v_drift);
  end if;
  return jsonb_build_object('status',v_check->>'status','reasons',v_check->'reasons',
    'reconciliation_fingerprint',finance.budget_hash(jsonb_build_object('id',v_row.id::text,'as_of',to_char(v_row.as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',v_row.opening_fund_cutover::text,'coverage_snapshot',v_row.coverage_snapshot)));
end $$;

create or replace function public.budget_record_reconciliation_v1(p_command_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  v_as_of timestamptz;
  v_cutover date;
  v_notes text;
  v_coverage jsonb;
  v_canonical jsonb;
  v_replay jsonb;
  v_check jsonb;
  v_household uuid;
  v_actor uuid;
  v_existing_cutover date;
  v_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  perform finance.budget_validate_object(p_payload, array['as_of','coverage_snapshot','notes'], array['opening_fund_cutover']);
  v_as_of := finance.budget_timestamp(p_payload,'as_of');
  if v_as_of > statement_timestamp() then perform finance.budget_fail('budget_invalid','as_of must not be in the future'); end if;
  v_cutover := finance.budget_date(p_payload,'opening_fund_cutover',true);
  v_coverage := finance.budget_validate_coverage(p_payload->'coverage_snapshot');
  v_notes := finance.budget_text(p_payload,'notes');
  v_canonical := jsonb_build_object('as_of',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'opening_fund_cutover',case when v_cutover is null then null else v_cutover::text end,'coverage_snapshot',v_coverage,'notes',v_notes);
  v_replay := finance.budget_begin_command(p_command_id,'budget_record_reconciliation_v1',v_canonical);
  if v_replay is not null then return v_replay; end if;
  -- begin_command resolves and locks the trusted caller household.  The actor is
  -- inferred, never accepted in the command payload.
  v_household := finance.resolve_caller_household();
  v_actor := finance.budget_actor_member(v_household);
  v_check := finance.budget_check_coverage(v_household,v_coverage,v_as_of);
  if v_cutover is not null and v_cutover > (v_as_of at time zone 'Africa/Johannesburg')::date then
    perform finance.budget_fail('budget_invalid','opening fund cutover must not be after as_of');
  end if;
  if v_cutover is not null and v_check->>'status' <> 'complete' then
    perform finance.budget_fail('budget_incomplete','opening fund cutover requires complete coverage');
  end if;
  select opening_fund_cutover into v_existing_cutover from finance.budget_reconciliations
  where household_id=v_household and status='complete' and opening_fund_cutover is not null order by recorded_at, id limit 1;
  if v_cutover is not null and v_existing_cutover is not null and v_cutover <> v_existing_cutover then
    perform finance.budget_fail('budget_conflict','opening fund cutover is already established');
  end if;
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  values(v_id,v_household,v_as_of,v_actor,v_check->>'status',v_check->'coverage_snapshot',v_cutover,v_notes);
  v_result := jsonb_build_object('reconciliation_id',v_id::text,'status',v_check->>'status','reasons',v_check->'reasons',
    'reconciliation_fingerprint',finance.budget_hash(jsonb_build_object('id',v_id::text,'as_of',to_char(v_as_of at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',v_cutover::text,'coverage_snapshot',v_check->'coverage_snapshot')));
  set constraints all immediate;
  return finance.budget_finish_command(p_command_id,'budget_record_reconciliation_v1',v_canonical,v_result);
end $$;

revoke all on function finance.budget_validate_coverage(jsonb) from public, anon, authenticated, service_role;
revoke all on function finance.budget_check_coverage(uuid,jsonb,timestamptz) from public, anon, authenticated, service_role;
revoke all on function finance.budget_reconciliation_state(uuid,uuid,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.budget_record_reconciliation_v1(uuid,jsonb) from public, anon, service_role;
grant execute on function public.budget_record_reconciliation_v1(uuid,jsonb) to authenticated;
