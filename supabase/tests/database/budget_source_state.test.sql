begin;
select plan(16);

do $fixture$
declare
  h uuid := '00000000-0000-4000-8000-00000000d001';
  m uuid := '00000000-0000-4000-8000-00000000d002';
  a uuid := '00000000-0000-4000-8000-00000000d003';
  cov jsonb; exposure jsonb; checked jsonb; sf text; bf text; baseline jsonb;
  cutoff timestamptz := statement_timestamp() - interval '2 minutes';
begin
  insert into finance.households(id) values(h);
  insert into finance.household_members(id,household_id,email,auth_user_id,role)
    values(m,h,'source-state@test.invalid','00000000-0000-4000-8000-00000000d004','member');
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
    values(a,'source-state-account','Source state',h,'test','ZAR');
  insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at)
    values(a,current_date,1700000,'ZAR',h,'test',statement_timestamp()-interval '1 minute');
  insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,
    freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
    values(h,a,'shared',true,'liquid',24,'outflow_negative','statement',m);
  select finance.budget_settings_fingerprint(h,a), finance.budget_snapshot_fingerprint(h,a,current_date) into sf,bf;
  cov := jsonb_build_object('schema_version',1,'evidence','statement',
    'utility_coverage',jsonb_build_object('status','not_required','evidence','none'),
    'accounts',jsonb_build_array(jsonb_build_object('account_id',a::text,'status','included',
      'settings_fingerprint',sf,'snapshot_date',current_date::text,'snapshot_fingerprint',bf,
      'balance_convention','cash_signed','activity_through',to_char(cutoff at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'pending_included_ids','[]'::jsonb,'evidence','statement')));

  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,effective_at)
    values('source-state-pending',a,current_date,current_date,'{}',h,'test',true,false,-600,'ZAR','pending-1',statement_timestamp()-interval '1 minute');
  exposure := finance.budget_source_exposure(h,cov,statement_timestamp());
  raise notice '%', is(exposure->>'complete','false','pending source exposure blocks complete funding');
  raise notice '%', ok(exposure->'reasons' @> '[{"code":"pending_activity_provisional"}]'::jsonb,'pending has an explicit provisional reason');
  raise notice '%', is(exposure->>'resource_delta_cents','-60000','unreflected pending reserves its outflow once');
  raise notice '%', is(exposure->'adjustments'->0->>'reflected_in_balance','false','unlisted pending is not reflected in the observed balance');
  checked := finance.budget_check_coverage(h,cov,statement_timestamp());
  raise notice '%', ok(checked->'reasons' @> '[{"code":"pending_activity_provisional"}]'::jsonb,'coverage uses the source engine reason');
  raise notice '%', ok(not (checked->'reasons' @> '[{"code":"source_activity_unreconciled"}]'::jsonb),'typed pending does not retain the old blanket gate');

  cov := jsonb_set(cov,'{accounts,0,pending_included_ids}','["source-state-pending"]'::jsonb);
  exposure := finance.budget_source_exposure(h,cov,statement_timestamp());
  raise notice '%', is(exposure->>'resource_delta_cents','0','included pending does not debit an already observed balance twice');
  raise notice '%', is(exposure->'adjustments'->0->>'reflected_in_balance','true','included pending is marked reflected');

  -- Same-account amount matching is deliberately insufficient identity proof.
  -- An unlinked pending plus posted candidate remains ambiguous, not two spends.
  cov := jsonb_set(cov,'{accounts,0,pending_included_ids}','[]'::jsonb);
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,effective_at)
    values('source-state-posted',a,current_date,current_date,'{}',h,'test',false,false,-600,'ZAR','posted-1',statement_timestamp()-interval '30 seconds');
  exposure := finance.budget_source_exposure(h,cov,statement_timestamp());
  raise notice '%', ok(exposure->'reasons' @> '[{"code":"pending_identity_ambiguous"}]'::jsonb,'unlinked equal pending and posted rows are identity ambiguous');
  raise notice '%', is(exposure->>'provisional_known','false','ambiguous identity suppresses provisional arithmetic');
  raise notice '%', is(exposure->>'resource_delta_cents',null,'ambiguous identity returns no asserted resource total');

  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,effective_at)
    values('source-state-future',a,current_date+1,current_date+1,'{}',h,'test',false,false,-700,'ZAR','future-1',statement_timestamp()+interval '1 day');
  exposure := finance.budget_source_exposure(h,cov,statement_timestamp());
  raise notice '%', ok(not (exposure->'adjustments' @> '[{"transaction_id":"source-state-future"}]'::jsonb),'future source facts are excluded from monetary adjustments');

  -- The source-state snapshot, rather than an old provider effective date,
  -- decides whether a pending-to-posted row had already reduced the balance.
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,effective_at)
    values('baseline-old-pending',a,current_date,current_date,'{}',h,'test',true,false,-10,'ZAR','baseline-pending',statement_timestamp()-interval '5 minutes');
  baseline := jsonb_build_object('schema_version',1,'sources',jsonb_build_array(jsonb_build_object(
    'transaction_id','baseline-old-pending','account_id',a::text,'source_system','test',
    'source_transaction_id','baseline-old-pending','amount_cents','-1000',
    'effective_at',to_char((statement_timestamp()-interval '5 minutes') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'pending',true,'archived',false,'source_fingerprint','frozen-pending')));
  cov := jsonb_set(cov,'{accounts,0,source_state_snapshot}',baseline);
  update public.transactions set source_is_pending=false where household_id=h and id='baseline-old-pending';
  exposure := finance.budget_source_exposure(h,cov,statement_timestamp());
  raise notice '%', is(exposure->>'resource_delta_cents',null,'other unlinked ambiguity still keeps aggregate unknown');
  raise notice '%', ok(exposure->'adjustments' @> '[{"transaction_id":"baseline-old-pending","resource_delta_cents":"-1000","reflected_in_balance":false}]'::jsonb,'old unlisted pending becoming posted retains its resource debit');

  -- An old posted row which was absent from the frozen source list cannot be
  -- assumed to be inside the old balance merely because its provider date is.
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,effective_at)
    values('baseline-absent-posted',a,current_date,current_date,'{}',h,'test',false,false,-11,'ZAR','baseline-absent',statement_timestamp()-interval '5 minutes');
  exposure := finance.budget_source_exposure(h,cov,statement_timestamp());
  raise notice '%', ok(exposure->'reasons' @> '[{"code":"source_balance_inclusion_unknown","transaction_id":"baseline-absent-posted"}]'::jsonb,'old posted row absent from the frozen baseline has unknown balance inclusion');
  raise notice '%', is(exposure->>'provisional_known','false','unknown old posted inclusion suppresses provisional totals');
end $fixture$;

select * from finish();
rollback;
