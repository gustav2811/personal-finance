-- Statement evidence is deliberately separate from provider facts.  In
-- particular, FinWise's absent pending flag remains absent in transactions.
create table finance.budget_statement_finality_confirmations (
  household_id uuid not null references finance.households(id) on delete cascade,
  transaction_id text not null references public.transactions(id) on delete cascade,
  account_id uuid not null references public.accounts(account_id),
  amount numeric not null,
  currency_code text not null,
  occurred_on date not null,
  evidence_type text not null check (evidence_type in ('user_statement','bank_zero_statement','user_posted_confirmation')),
  evidence text not null check (length(btrim(evidence)) between 1 and 500),
  actor_id uuid not null references finance.household_members(id),
  confirmed_at timestamptz not null default statement_timestamp(),
  primary key (household_id, transaction_id),
  check (currency_code = 'ZAR')
);

create index budget_statement_finality_confirmations_transaction_idx
  on finance.budget_statement_finality_confirmations (transaction_id);

alter table finance.budget_statement_finality_confirmations enable row level security;
create policy budget_statement_finality_member_select
  on finance.budget_statement_finality_confirmations for select to authenticated
  using (household_id = finance.resolve_caller_household());

-- This is private state: consumers use the audited command, not table grants.
revoke all on finance.budget_statement_finality_confirmations from public, anon, authenticated, service_role;

create or replace function finance.budget_effective_source_pending(
  p_household uuid, p_transaction public.transactions
)
returns boolean
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC'
as $$
begin
  -- An explicit provider pending state is authoritative and can never be
  -- relaxed by statement evidence.
  if p_transaction.source_is_pending is not null then return p_transaction.source_is_pending; end if;
  if exists (
    select 1
    from finance.budget_statement_finality_confirmations c
    where c.household_id = p_household
      and c.transaction_id = p_transaction.id
      and c.account_id = p_transaction.account_id
      and c.amount = p_transaction.amount
      and c.currency_code = p_transaction.currency_code
      and c.occurred_on = p_transaction.occurred_on
      and c.evidence_type in ('user_statement', 'bank_zero_statement', 'user_posted_confirmation')
  ) then return false; end if;
  return null;
end $$;

-- Keep the normalizer named separately so read paths can be explicit about
-- using effective state rather than the provider's raw nullable field.
create or replace function finance.budget_source_pending_state(
  p_household uuid, p_transaction public.transactions
)
returns boolean
language plpgsql stable security definer
set search_path = pg_temp set timezone = 'UTC'
as $$
begin
  return finance.budget_effective_source_pending(p_household,p_transaction);
end $$;

create or replace function public.budget_confirm_statement_posted_v1(
  p_command_id uuid, p_payload jsonb
)
returns jsonb
language plpgsql volatile security definer
set search_path = pg_temp set timezone = 'UTC'
as $$
declare h uuid; actor uuid; replay jsonb; tx public.transactions%rowtype; canonical jsonb;
  evidence text; evidence_type text;
begin
  perform finance.budget_validate_object(p_payload, array['transaction_id','evidence'], array['evidence_type']);
  evidence := finance.budget_text(p_payload,'evidence');
  evidence_type := coalesce(finance.budget_text(p_payload,'evidence_type',true),'user_statement');
  if evidence_type not in ('user_statement','bank_zero_statement','user_posted_confirmation') then perform finance.budget_fail('budget_invalid','evidence_type'); end if;
  canonical := jsonb_build_object('transaction_id',finance.budget_text(p_payload,'transaction_id'),'evidence',evidence,'evidence_type',evidence_type);
  replay := finance.budget_begin_command(p_command_id,'budget_confirm_statement_posted_v1',canonical);
  if replay is not null then return replay; end if;
  h := finance.resolve_caller_household(); actor := finance.budget_actor_member(h);
  select * into tx from public.transactions where household_id=h and id=canonical->>'transaction_id' for update;
  if not found then perform finance.budget_fail('budget_forbidden','source transaction'); end if;
  perform 1 from public.accounts where household_id=h and account_id=tx.account_id for update;
  if not found then perform finance.budget_fail('budget_forbidden','source account'); end if;
  if tx.source_is_pending is not null then perform finance.budget_fail('budget_conflict','provider pending is explicit'); end if;
  if tx.source_is_archived is not false or tx.amount is null or tx.currency_code is distinct from 'ZAR' or tx.occurred_on is null then
    perform finance.budget_fail('budget_incomplete','source facts');
  end if;
  insert into finance.budget_statement_finality_confirmations(
    household_id,transaction_id,account_id,amount,currency_code,occurred_on,evidence_type,evidence,actor_id
  ) values (h,tx.id,tx.account_id,tx.amount,tx.currency_code,tx.occurred_on,evidence_type,evidence,actor)
  on conflict (household_id,transaction_id) do update set
    account_id=excluded.account_id, amount=excluded.amount, currency_code=excluded.currency_code,
    occurred_on=excluded.occurred_on, evidence_type=excluded.evidence_type, evidence=excluded.evidence,
    actor_id=excluded.actor_id, confirmed_at=statement_timestamp();
  return finance.budget_finish_command(p_command_id,'budget_confirm_statement_posted_v1',canonical,
    jsonb_build_object('transaction_id',tx.id,'pending',false,'raw_pending',null,'evidence_type',evidence_type));
end $$;

-- Add effective state to the immutable source projection.  Existing rows with
-- raw null and no confirmation keep their previous fingerprint.
create or replace function finance.budget_source_snapshot(p_household_id uuid, p_transaction_id text)
returns jsonb language plpgsql stable security definer
set search_path=pg_temp set timezone='UTC' as $$
declare t public.transactions%rowtype; a public.accounts%rowtype; s finance.budget_account_settings%rowtype;
  c finance.transaction_classifications%rowtype; tr finance.transaction_treatments%rowtype; e record; o uuid;
  cents numeric; amount text; reasons jsonb:='[]'::jsonb; body jsonb; pending boolean; confirmation_id text; confirmation_matches boolean;
begin
  select * into t from public.transactions where id=p_transaction_id and household_id=p_household_id;
  if not found then perform finance.budget_fail('budget_forbidden','source transaction'); end if;
  select * into a from public.accounts where account_id=t.account_id and household_id=p_household_id;
  if not found then perform finance.budget_fail('budget_forbidden','source account'); end if;
  select * into s from finance.budget_account_settings where household_id=p_household_id and account_id=t.account_id;
  if not found then reasons:=reasons||jsonb_build_array('settings_missing'); end if;
  if a.currency_code is distinct from 'ZAR' then reasons:=reasons||jsonb_build_array('account_currency_invalid'); end if;
  if t.currency_code is distinct from 'ZAR' then reasons:=reasons||jsonb_build_array('currency_invalid'); end if;
  if t.amount is null or t.amount::text in ('NaN','Infinity','-Infinity') or t.amount*100<>trunc(t.amount*100) then reasons:=reasons||jsonb_build_array('amount_invalid'); cents:=null;
  else cents:=t.amount*100; if s.transaction_sign_convention='outflow_positive' then cents:=-cents; end if; if cents < -9223372036854775808::numeric or cents>9223372036854775807::numeric then reasons:=reasons||jsonb_build_array('amount_invalid'); cents:=null; end if; end if;
  if t.occurred_on is null then reasons:=reasons||jsonb_build_array('occurred_on_missing'); end if;
  if s.transaction_sign_convention is null or s.transaction_sign_convention='unknown' or nullif(btrim(s.sign_evidence),'') is null then reasons:=reasons||jsonb_build_array('sign_evidence_missing'); end if;
  if a.currency_code is distinct from 'ZAR' or t.currency_code is distinct from 'ZAR' or s.transaction_sign_convention is null or s.transaction_sign_convention='unknown' or nullif(btrim(s.sign_evidence),'') is null then cents:=null; end if;
  select * into c from finance.transaction_classifications where household_id=p_household_id and transaction_id=t.id and status='confirmed';
  select * into tr from finance.transaction_treatments where household_id=p_household_id and transaction_id=t.id and status='confirmed';
  select o2.id into o from finance.transaction_source_observations o2 where o2.household_id=p_household_id and o2.transaction_id=t.id and o2.raw_payload_hash is not distinct from t.raw_payload_hash order by o2.observed_at desc,o2.id desc limit 1;
  select ev.id event_id,ev.event_type,ev.status event_status,l.id leg_id,l.leg_role,l.status leg_status into e from finance.financial_event_legs l join finance.financial_events ev on ev.id=l.event_id and ev.household_id=p_household_id where l.household_id=p_household_id and l.transaction_id=t.id and l.status='active' and ev.status='confirmed' limit 1;
  if (tr.event_id is not null and tr.event_id is distinct from e.event_id) or (tr.leg_role is not null and tr.leg_role is distinct from e.leg_role) then reasons:=reasons||jsonb_build_array('event_decision_mismatch'); end if;
  pending:=finance.budget_source_pending_state(p_household_id,t);
  select sf.transaction_id, (sf.account_id=t.account_id and sf.amount=t.amount and sf.currency_code=t.currency_code and sf.occurred_on=t.occurred_on) into confirmation_id,confirmation_matches from finance.budget_statement_finality_confirmations sf where sf.household_id=p_household_id and sf.transaction_id=t.id;
  amount:=case when cents is null then null else cents::bigint::text end;
  body:=jsonb_build_object('transaction_id',t.id,'account_id',a.account_id::text,'household_id',p_household_id::text,'amount_cents',amount,'occurred_on',t.occurred_on::text,'original_amount',t.amount::text,'source_system',t.source_system,'currency_code',t.currency_code,'account_currency_code',a.currency_code,'sign_convention',s.transaction_sign_convention,'settings_fingerprint',finance.budget_settings_fingerprint(p_household_id,a.account_id),'owner_scope',s.owner_scope,'owner_member_id',s.owner_member_id::text,'source_updated_at',t.source_updated_at,'source_first_seen_at',t.source_first_seen_at,'source_last_seen_at',t.source_last_seen_at,'effective_at',t.effective_at,'posted_at',t.posted_at,'date',t.date,'raw_payload_hash',t.raw_payload_hash,'source_observation_id',o::text,'pending',pending,'archived',t.source_is_archived,'classification_id',c.id::text,'treatment_id',tr.id::text,'classification',jsonb_build_object('id',c.id::text,'category_id',c.category_id::text,'status',c.status,'decision_source',c.decision_source),'treatment',jsonb_build_object('id',tr.id::text,'is_transfer',tr.is_transfer,'exclude_from_spend',tr.exclude_from_spend,'nature',tr.nature,'event_id',tr.event_id::text,'leg_role',tr.leg_role,'status',tr.status),'event',jsonb_build_object('id',e.event_id::text,'type',e.event_type,'status',e.event_status,'leg_id',e.leg_id::text,'leg_role',e.leg_role,'leg_status',e.leg_status),'complete',jsonb_array_length(reasons)=0,'reasons',reasons);
  if confirmation_id is not null then body:=body||jsonb_build_object('raw_pending',t.source_is_pending,'statement_finality_confirmation_id',confirmation_id,'statement_finality_facts_match',confirmation_matches); end if;
  return body||jsonb_build_object('source_fingerprint',finance.budget_hash(body-'source_last_seen_at'));
end $$;

-- Preserve the existing source-state, lifecycle, pagination and exposure contracts.
CREATE OR REPLACE FUNCTION finance.budget_check_coverage_base_stage3(p_household uuid, p_coverage jsonb, p_as_of timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
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
          and (finance.budget_effective_source_pending(p_household,t) is true
               or coalesce(t.effective_at,t.posted_at,t.occurred_on::timestamp at time zone 'UTC',t.date) is null
               or coalesce(t.effective_at,t.posted_at,t.occurred_on::timestamp at time zone 'UTC',t.date) > (v_entry->>'activity_through')::timestamptz)
      ) then
        -- PR1 has no conservative transaction/purpose adjustment engine.  A
        -- post-observation source row (including declared pending) is evidence
        -- of uncertainty, never a zero adjustment.
        v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('code','source_activity_unreconciled','account_id',v_id::text));
      end if;
    end if;
    v_pending := coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'account_id',t.account_id::text,'pending',finance.budget_effective_source_pending(p_household,t),'archived',t.source_is_archived,'occurred_on',t.occurred_on::text,'amount',t.amount::text) order by t.id)
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
end $function$
;

CREATE OR REPLACE FUNCTION finance.budget_get_review_queue_v1_stage5(p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
declare h uuid; c jsonb; rows jsonb:='[]'; r record; n int:=0; next_cursor text; last_key text; resources jsonb; queue_present boolean:=false;
begin
 h:=finance.budget_reader_household(); if p_limit is null or p_limit not between 1 and 200 then perform finance.budget_fail('budget_invalid','invalid limit'); end if; resources:=finance.budget_resources(h,statement_timestamp());
 if p_cursor is not null then begin c:=finance.budget_cursor_validate(p_cursor,'review',h,array['review_key']); last_key:=c->>'review_key'; if last_key is null then perform finance.budget_fail('budget_invalid','invalid cursor'); end if; exception when others then perform finance.budget_fail('budget_invalid','invalid cursor'); end; end if;
 for r in with items as (
   select s.id set_id,a.id allocation_id,s.id::text||':'||a.id::text review_key,'allocation' kind,'high' severity,s.occurred_on,a.fund_id,a.amount_cents,s.transaction_id,s.utility_entry_id,null::uuid account_id,jsonb_build_array(jsonb_build_object('code','allocation_needs_review')) reasons,jsonb_build_object('set_id',s.id,'allocation_id',a.id,'status',s.status) provenance from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.status='needs_review'
   union all select null,null,'transaction:'||t.id,'unallocated_outflow','high',t.occurred_on,null,(snap->>'amount_cents')::numeric,t.id,null,t.account_id,jsonb_build_array(jsonb_build_object('code','unallocated_outflow')),jsonb_build_object('source_system',t.source_system,'source_snapshot',snap) from public.transactions t cross join lateral finance.budget_source_snapshot(h,t.id) snap where t.household_id=h and (snap->>'amount_cents')::numeric<0 and finance.budget_effective_source_pending(h,t) is false and t.source_is_archived is false and (finance.budget_opening_cutover(h) is null or t.occurred_on>=finance.budget_opening_cutover(h)) and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.transaction_id=t.id and s.status in ('current','needs_review'))
   union all select s.id,a.id,'drift:'||s.id::text||':'||a.id::text,'source_drift','high',s.occurred_on,a.fund_id,a.amount_cents,s.transaction_id,s.utility_entry_id,null,jsonb_build_array(jsonb_build_object('code','source_fingerprint_drift')),jsonb_build_object('set_id',s.id,'allocation_id',a.id,'frozen_fingerprint',s.source_fingerprint,'current_fingerprint',finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint') from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.status in ('current','needs_review') and s.transaction_id is not null and s.source_fingerprint is distinct from finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint'
   union all select s.id,a.id,'utility-drift:'||s.id::text||':'||a.id::text,'source_drift','high',s.occurred_on,a.fund_id,a.amount_cents,null,s.utility_entry_id,null,jsonb_build_array(jsonb_build_object('code','source_fingerprint_drift')),jsonb_build_object('set_id',s.id,'allocation_id',a.id,'frozen_fingerprint',s.source_fingerprint,'current_fingerprint',finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint') from finance.budget_allocation_sets s join finance.budget_allocations a on a.household_id=s.household_id and a.set_id=s.id where s.household_id=h and s.status in ('current','needs_review') and s.utility_entry_id is not null and s.source_fingerprint is distinct from finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint'
   union all select null,null,'utility:'||l.id::text,'utility_unlinked','medium',coalesce(l.occurred_at,l.posted_at)::date,null,case when l.direction='debit' then -(l.amount*100) else l.amount*100 end,l.metadata->>'transaction_id',l.id,null,jsonb_build_array(jsonb_build_object('code','utility_unlinked')),jsonb_build_object('source',l.source,'source_record_id',l.source_record_id) from consumption.ledger_entries l where l.household_id=h and l.entry_type in ('usage_charge','fee','correction') and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.utility_entry_id=l.id and s.status in ('current','needs_review'))
   union all select null,null,'resource:'||coalesce(x.value->>'code','unknown')||':'||h::text,'resource_reason','high',null,null,null,null,null,null,jsonb_build_array(x.value),jsonb_build_object('resource_state',resources) from jsonb_array_elements(coalesce(resources->'reasons','[]'::jsonb)) x(value)
 ) select * from items where (last_key is null or review_key<last_key) order by review_key desc limit p_limit+1 loop
   n:=n+1; if n>p_limit then next_cursor:=finance.budget_cursor_encode(jsonb_build_object('v',1,'kind','review','household_id',h::text,'review_key',last_key)); exit; end if; last_key:=r.review_key; rows:=rows||jsonb_build_array(jsonb_build_object('review_key',r.review_key,'kind',r.kind,'severity',r.severity,'occurred_on',r.occurred_on,'source_transaction_id',r.transaction_id,'utility_entry_id',r.utility_entry_id,'account_id',r.account_id,'fund_id',r.fund_id,'amount_cents',case when r.amount_cents is null then null else r.amount_cents::numeric::bigint::text end,'impact_cents',case when r.amount_cents is null then null else r.amount_cents::numeric::bigint::text end,'reasons',r.reasons,'provenance',r.provenance)); end loop;
 queue_present:=jsonb_array_length(coalesce(resources->'reasons','[]'::jsonb))>0
   or exists(select 1 from finance.budget_allocation_sets where household_id=h and status='needs_review')
   or exists(select 1 from public.transactions t cross join lateral finance.budget_source_snapshot(h,t.id) snap where t.household_id=h and (snap->>'amount_cents')::numeric<0 and finance.budget_effective_source_pending(h,t) is false and t.source_is_archived is false and (finance.budget_opening_cutover(h) is null or t.occurred_on>=finance.budget_opening_cutover(h)) and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.transaction_id=t.id and s.status in ('current','needs_review')))
   or exists(select 1 from consumption.ledger_entries l where l.household_id=h and l.entry_type in ('usage_charge','fee','correction') and not exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.utility_entry_id=l.id and s.status in ('current','needs_review')))
   or exists(select 1 from finance.budget_allocation_sets s where s.household_id=h and s.status in ('current','needs_review') and ((s.transaction_id is not null and s.source_fingerprint is distinct from finance.budget_source_snapshot(h,s.transaction_id)->>'source_fingerprint') or (s.utility_entry_id is not null and s.source_fingerprint is distinct from finance.budget_utility_snapshot(h,s.utility_entry_id)->>'source_fingerprint')));
 return jsonb_build_object('calculation_version','household-budget-v1','household_id',h::text,'as_of',statement_timestamp(),'complete',coalesce((resources->>'complete')::boolean,false) and not queue_present,'reasons',coalesce(resources->'reasons','[]'::jsonb)||(case when queue_present then jsonb_build_array(jsonb_build_object('code','review_items_present')) else '[]'::jsonb end),'entries',rows,'items',rows,'next_cursor',next_cursor);
end $function$
;

CREATE OR REPLACE FUNCTION finance.budget_pending_lifecycle_proved(p_household uuid, p_old jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
declare v_fact jsonb; v_tx public.transactions%rowtype; v_snap jsonb;
begin
  if jsonb_typeof(p_old) <> 'array' then return false; end if;
  for v_fact in select value from jsonb_array_elements(p_old) loop
    select * into v_tx from public.transactions t
      where t.household_id=p_household and t.id=v_fact->>'id';
    if not found or v_tx.account_id::text is distinct from v_fact->>'account_id'
       or v_tx.source_is_archived is not false or finance.budget_effective_source_pending(p_household,v_tx) is null then return false; end if;
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
end $function$
;

CREATE OR REPLACE FUNCTION finance.budget_source_exposure_stage3(p_household uuid, p_coverage jsonb, p_asof timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
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
      if finance.budget_effective_source_pending(p_household,t) is null or t.source_is_archived is null then
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
      if finance.budget_effective_source_pending(p_household,t) is false and observed_at is not null then
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
      elsif base is not null and coalesce((base->>'pending')::boolean,false) and finance.budget_effective_source_pending(p_household,t) is false then
        if base->>'account_id' is distinct from t.account_id::text
           or base->>'amount_cents' is distinct from cents::text
           or (base ? 'source_system' and base->>'source_system' is distinct from t.source_system)
           or (base ? 'source_transaction_id' and base->>'source_transaction_id' is distinct from coalesce(t.source_transaction_id,t.id)) then
          reasons := reasons || jsonb_build_array(jsonb_build_object('code','source_unverified','account_id',a->>'account_id','transaction_id',t.id));
          known := false; arithmetic := false; continue;
        end if;
        observed := t.id = any(included);
      elsif finance.budget_effective_source_pending(p_household,t) is true then
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
          array_agg(l.transaction_id order by l.transaction_id), bool_or(finance.budget_effective_source_pending(p_household,q))
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
          and ((l.leg_role='economic_recognition' and finance.budget_effective_source_pending(p_household,q) is false)
            or (l.leg_role in ('mirror','staging') and finance.budget_effective_source_pending(p_household,q) is true)))
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
      if finance.budget_effective_source_pending(p_household,t) is true then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','pending_activity_provisional','account_id',a->>'account_id','transaction_id',t.id));
      end if;
      -- Unlinked same-account amount/date matches are deliberately not identity.
      if finance.budget_effective_source_pending(p_household,t) and not (t.id=any(included)) and exists (
        select 1 from public.transactions q cross join lateral (select finance.budget_source_snapshot(p_household,q.id) ss) z
        where q.household_id=p_household and q.account_id=t.account_id and q.id<>t.id and finance.budget_effective_source_pending(p_household,q) is false
          and q.source_is_archived is distinct from true and ss->>'amount_cents'=cents::text
          and q.occurred_on is not null and t.occurred_on is not null and abs(q.occurred_on-t.occurred_on)<=7
          and finance.budget_source_effective_at(q)<=p_asof) then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','pending_identity_ambiguous','account_id',a->>'account_id','transaction_id',t.id));
        known := false; arithmetic := false;
      end if;
      fdelta := '{}'::jsonb;
      if finance.budget_effective_source_pending(p_household,t) and cents < 0 and (s->'event'->>'id' is null or
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
        or t.occurred_on>=finance.budget_opening_cutover(p_household) or finance.budget_effective_source_pending(p_household,t))
        and not exists(select 1 from finance.budget_allocation_sets x where x.household_id=p_household and x.transaction_id=t.id and x.status in ('current','needs_review')) then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','purpose_exposure_unresolved','account_id',a->>'account_id','transaction_id',t.id));
      elsif cents > 0 and not observed then
        reasons := reasons || jsonb_build_array(jsonb_build_object('code','income_after_observation_unreconciled','account_id',a->>'account_id','transaction_id',t.id)); known:=false; arithmetic:=false;
      end if;
      if cents<0 and not observed then delta:=delta+cents; end if;
      if not observed or finance.budget_effective_source_pending(p_household,t) then
        adjustments:=adjustments||jsonb_build_array(jsonb_build_object('transaction_id',coalesce(group_rep,t.id),'account_id',a->>'account_id','set_id',null,'source_ids',source_ids,
          'kind',case when finance.budget_effective_source_pending(p_household,t) then 'pending' else 'posted_after_observation' end,'amount_cents',abs(cents::numeric)::text,
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
end $function$
;

CREATE OR REPLACE FUNCTION finance.budget_source_state_snapshot(p_household uuid, p_coverage jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
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
      'pending', finance.budget_effective_source_pending(p_household,t), 'archived', t.source_is_archived,
      'source_fingerprint', s->>'source_fingerprint') order by t.id), '[]'::jsonb)
    into v_sources
    from public.transactions t
    cross join lateral (select finance.budget_source_snapshot(p_household,t.id) as s) z
    where t.household_id=p_household and t.account_id::text=v_account->>'account_id';
    v_out := v_out || jsonb_build_array(v_account || jsonb_build_object(
      'source_state_snapshot',jsonb_build_object('schema_version',1,'sources',v_sources)));
  end loop;
  return p_coverage || jsonb_build_object('accounts',v_out);
end $function$
;

revoke all on function finance.budget_effective_source_pending(uuid,public.transactions),finance.budget_source_pending_state(uuid,public.transactions) from public,anon,authenticated,service_role;
revoke all on function finance.budget_pending_lifecycle_proved(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.budget_confirm_statement_posted_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.budget_confirm_statement_posted_v1(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
