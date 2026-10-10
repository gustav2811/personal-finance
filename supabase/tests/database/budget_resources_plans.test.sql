-- Acceptance coverage for the calculation/read packet.  This is deliberately a
-- synthetic transaction: private fixtures are installed before the member read
-- role is assumed, and every receipt FK is forced only after its receipt exists.
begin;
select plan(32);
set constraints all deferred;

do $fixture$
declare
  h uuid := '00000000-0000-4000-8000-00000000b701';
  member_id uuid := '00000000-0000-4000-8000-00000000b702';
  cash uuid := '00000000-0000-4000-8000-00000000b704';
  card uuid := '00000000-0000-4000-8000-00000000b705';
  f_claim uuid := '00000000-0000-4000-8000-00000000b706';
  f_other uuid := '00000000-0000-4000-8000-00000000b707';
  v_original uuid := '00000000-0000-4000-8000-00000000b708';
  v_current uuid := '00000000-0000-4000-8000-00000000b709';
  coverage jsonb;
  cash_settings text;
  card_settings text;
  cash_snapshot text;
  card_snapshot text;
  asof timestamptz := '2026-09-30 12:00:00+00';
begin
  insert into finance.households(id) values (h);
  insert into finance.household_members(id,household_id,email,auth_user_id,role) values
    (member_id,h,'resources@test.invalid','00000000-0000-4000-8000-00000000b703','member');
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values
    (cash,'resources-test-cash','Cash',h,'test','ZAR'),
    (card,'resources-test-card','Card',h,'test','ZAR');
  insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at) values
    (cash,date '2026-09-30',2000000,'ZAR',h,'test','2026-09-30 11:00+00'),
    (card,date '2026-09-30',300000,'ZAR',h,'test','2026-09-30 11:00+00');
  insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id) values
    (h,cash,'shared',true,'liquid',48,'outflow_negative','statement',member_id),
    (h,card,'shared',true,'card',48,'outflow_positive','statement',member_id);
  insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values
    (f_claim,h,'Claim','shared',member_id),(f_other,h,'Other','shared',member_id);
  -- Create lines while draft, then publish headers; the published-line guard is
  -- intentionally exercised instead of bypassed by a direct published insert.
  insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,reason,income_assumptions)
  values (v_original,h,date '2026-09-23',member_id,'draft','',
    '[{"member_id":"00000000-0000-4000-8000-00000000b702","expected_net_cents":"10000","expected_on":"2026-09-23","provenance":"fixture"},{"member_id":"00000000-0000-4000-8000-00000000b702","expected_net_cents":"15000","expected_on":"2026-09-24","provenance":"fixture"}]');
  insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy) values
    ('00000000-0000-4000-8000-00000000b711',h,v_original,'00000000-0000-4000-8000-00000000b721',f_claim,'Claim','shared','consumption',10000,'accumulating','cycle','carry'),
    ('00000000-0000-4000-8000-00000000b712',h,v_original,'00000000-0000-4000-8000-00000000b722',f_other,'Other','shared','consumption',20000,'accumulating','cycle','carry');
  update finance.budget_versions set state='published',version_number=1,published_at='2026-09-20 08:00+00',reason='original' where id=v_original;
  insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,reason,parent_version_id,income_assumptions)
  values (v_current,h,date '2026-09-23',member_id,'draft','',v_original,
    '[{"member_id":"00000000-0000-4000-8000-00000000b702","expected_net_cents":"10000","expected_on":"2026-09-23","provenance":"fixture"},{"member_id":"00000000-0000-4000-8000-00000000b702","expected_net_cents":"15000","expected_on":"2026-09-24","provenance":"fixture"}]');
  insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy) values
    ('00000000-0000-4000-8000-00000000b713',h,v_current,'00000000-0000-4000-8000-00000000b721',f_claim,'Claim revised','shared','consumption',20000,'accumulating','cycle','carry'),
    ('00000000-0000-4000-8000-00000000b714',h,v_current,'00000000-0000-4000-8000-00000000b722',f_other,'Other revised','shared','consumption',30000,'accumulating','cycle','carry');
  update finance.budget_versions set state='published',version_number=2,published_at='2026-09-25 08:00+00',reason='midcycle revision' where id=v_current;
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values
    (h,'00000000-0000-4000-8000-00000000b731','fixture','{}',member_id,'{}');
  insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,budget_version_id) values
    ('00000000-0000-4000-8000-00000000b732',h,f_claim,1500000,'opening',date '2026-09-23',member_id,'00000000-0000-4000-8000-00000000b731','opening',v_current);
  select finance.budget_settings_fingerprint(h,cash),finance.budget_settings_fingerprint(h,card),
    finance.budget_snapshot_fingerprint(h,cash,date '2026-09-30'),finance.budget_snapshot_fingerprint(h,card,date '2026-09-30')
  into cash_settings,card_settings,cash_snapshot,card_snapshot;
  coverage := jsonb_build_object('schema_version',1,'evidence','statement','utility_coverage',jsonb_build_object('status','not_required','evidence','none'),'accounts',jsonb_build_array(
    jsonb_build_object('account_id',cash::text,'status','included','settings_fingerprint',cash_settings,'snapshot_date','2026-09-30','snapshot_fingerprint',cash_snapshot,'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00.000000Z','pending_included_ids','[]'::jsonb,'evidence','statement'),
    jsonb_build_object('account_id',card::text,'status','included','settings_fingerprint',card_settings,'snapshot_date','2026-09-30','snapshot_fingerprint',card_snapshot,'balance_convention','debt_positive','activity_through','2026-09-30T12:00:00.000000Z','pending_included_ids','[]'::jsonb,'evidence','statement')));
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  values ('00000000-0000-4000-8000-00000000b733',h,asof,member_id,'complete',
    finance.budget_check_coverage(h,coverage,asof)->'coverage_snapshot',date '2026-09-23','fixture');
  set constraints all immediate;
end $fixture$;

do $read$
declare r jsonb; before_balance bigint; h uuid := '00000000-0000-4000-8000-00000000b701';
begin
  select balance_cents into before_balance from finance.budget_fund_balances(h,date '2026-09-30') where fund_id='00000000-0000-4000-8000-00000000b706';
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000b703','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b703',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'net_liquid_cents','1700000','liquid cash minus positive card debt is counted once');
  raise notice '%', is(r->>'net_claims_cents','1500000','single funded claim is exact despite two accounts');
  raise notice '%', is(r->>'unassigned_cents','200000','complete resources expose exact unassigned cash');
  raise notice '%', is((r->>'complete')::boolean,true,'explicit cash/card conventions yield complete public overview');
  raise notice '%', is(r->>'original_version_id','00000000-0000-4000-8000-00000000b708','pre-cycle version remains original');
  raise notice '%', is(r->>'current_version_id','00000000-0000-4000-8000-00000000b709','mid-cycle published version is current');
  raise notice '%', is(r->>'forecast_gap_cents','25000','two incomes and two lines aggregate once without fan-out');
  raise notice '%', ok(jsonb_typeof(r->'net_liquid_cents')='string' and jsonb_typeof(r->'current_plan'->'lines'->0->'contribution_cents')='string','money fields are bigint decimal JSON strings');
  execute 'reset role';
  update finance.budget_account_settings set freshness_hours=47 where household_id=h and account_id='00000000-0000-4000-8000-00000000b704';
  execute 'set local role authenticated'; r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is((r->>'complete')::boolean,false,'settings mutation makes public overview incomplete');
  raise notice '%', is(r->>'unassigned_cents',null,'settings drift suppresses unassigned resources');
  execute 'reset role';
  raise notice '%', is((select balance_cents from finance.budget_fund_balances(h,date '2026-09-30') where fund_id='00000000-0000-4000-8000-00000000b706'),before_balance,'frozen fund delta survives resource drift');
  update finance.budget_account_settings set freshness_hours=48 where household_id=h and account_id='00000000-0000-4000-8000-00000000b704';
  update public.snapshots set amount_cents=2000001 where account_id='00000000-0000-4000-8000-00000000b704' and date='2026-09-30';
  execute 'set local role authenticated'; r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is((r->>'complete')::boolean,false,'referenced snapshot observation mutation makes overview incomplete');
  raise notice '%', is(r->>'unassigned_cents',null,'snapshot drift suppresses resource availability');
  execute 'reset role';
end $read$;

-- Target suggestions are pure forecasts.  No table is written by these calls.
select is(finance.budget_target_suggestion('{"funding_behaviour":"target_by_date","target_cents":"600000","due_on":"2026-11-23"}'::jsonb,100000,date '2026-07-23')->>'suggested_contribution_cents','100000','five monthly 23rd dates split target shortfall');
select is(finance.budget_target_suggestion('{"funding_behaviour":"target_by_date","target_cents":"600000","due_on":"2026-11-23"}'::jsonb,100000,date '2026-11-24')->>'due_now','true','zero remaining target dates makes the whole shortfall due now');
select is(finance.budget_target_suggestion('{"funding_behaviour":"reserve_target","target_cents":"600000"}'::jsonb,100000,date '2026-09-30')->>'suggested_contribution_cents','500000','reserve target replenishes shortfall');

-- A separate signed fixture proves that deficit reports both a negative fund and
-- insufficient liquid resources.  The negative allocation has a real source,
-- confirmed decisions, and a receipt inserted last under deferred constraints.
do $signed$
declare h uuid:='00000000-0000-4000-8000-00000000b741'; m uuid:='00000000-0000-4000-8000-00000000b742'; a uuid:='00000000-0000-4000-8000-00000000b744'; fp text; cov jsonb; r jsonb;
begin
  set constraints all deferred;
  insert into finance.households(id) values(h); insert into finance.household_members(id,household_id,email,auth_user_id,role) values(m,h,'signed@test.invalid','00000000-0000-4000-8000-00000000b743','member');
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values(a,'resources-test-signed','Signed',h,'test','ZAR');
  insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at) values(a,date '2026-09-30',50000,'ZAR',h,'test','2026-09-30 11:00+00');
  insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id) values(h,a,'shared',true,'liquid',48,'outflow_negative','statement',m);
  insert into finance.categories(id,household_id,name,slug) values('00000000-0000-4000-8000-00000000b740',h,'Fixture','fixture');
  insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values('00000000-0000-4000-8000-00000000b745',h,'Positive','shared',m),('00000000-0000-4000-8000-00000000b746',h,'Deficit','shared',m);
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values('resources-test-negative',a,'2026-09-30',date '2026-09-30','{}',h,'test',false,false,-100,'ZAR','negative');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status) values('00000000-0000-4000-8000-00000000b747',h,'resources-test-negative','00000000-0000-4000-8000-00000000b740','user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,decision_source,status) values('00000000-0000-4000-8000-00000000b748',h,'resources-test-negative',false,false,'user','confirmed');
  select finance.budget_source_snapshot(h,'resources-test-negative')->>'source_fingerprint' into fp;
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id) values('00000000-0000-4000-8000-00000000b749',h,'resources-test-negative',finance.budget_source_snapshot(h,'resources-test-negative'),fp,-10000,date '2026-09-30',1,'current',m,'00000000-0000-4000-8000-00000000b750');
  insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,beneficiary_scope,effect_kind) values('00000000-0000-4000-8000-00000000b751',h,'00000000-0000-4000-8000-00000000b749',0,-10000,'00000000-0000-4000-8000-00000000b746','00000000-0000-4000-8000-00000000b740','shared','consumption');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values(h,'00000000-0000-4000-8000-00000000b750','fixture','{}',m,'{}');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values(h,'00000000-0000-4000-8000-00000000b752','fixture','{}',m,'{}');
  insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason) values('00000000-0000-4000-8000-00000000b753',h,'00000000-0000-4000-8000-00000000b745',60000,'opening',date '2026-09-23',m,'00000000-0000-4000-8000-00000000b752','opening');
  cov:=jsonb_build_object('schema_version',1,'evidence','statement','utility_coverage',jsonb_build_object('status','not_required','evidence','none'),'accounts',jsonb_build_array(jsonb_build_object('account_id',a::text,'status','included','settings_fingerprint',finance.budget_settings_fingerprint(h,a),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint(h,a,date '2026-09-30'),'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00.000000Z','pending_included_ids','[]'::jsonb,'evidence','statement')));
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes) values('00000000-0000-4000-8000-00000000b754',h,'2026-09-30 12:00+00',m,'complete',finance.budget_check_coverage(h,cov,'2026-09-30 12:00+00')->'coverage_snapshot',date '2026-09-23','fixture');
  -- Draft then line then publish: a minimal applicable plan for a complete overview.
  insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,reason) values('00000000-0000-4000-8000-00000000b755',h,date '2026-09-23',m,'draft','');
  insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values('00000000-0000-4000-8000-00000000b756',h,'00000000-0000-4000-8000-00000000b755','00000000-0000-4000-8000-00000000b757','00000000-0000-4000-8000-00000000b745','Positive','shared','consumption','accumulating','cycle','carry');
  update finance.budget_versions set state='published',version_number=1,published_at='2026-09-20 00:00+00',reason='fixture' where id='00000000-0000-4000-8000-00000000b755';
  set constraints all immediate;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000b743','role','authenticated')::text,true); perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b743',true); perform set_config('request.jwt.claim.role','authenticated',true); execute 'set local role authenticated';
  r:=public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'net_claims_cents','50000','signed funds net to fifty thousand');
  raise notice '%', is(r->>'positive_claims_cents','60000','positive claims do not hide negative fund');
  raise notice '%', is(r->>'deficit_cents','10000','deficit is negative-fund exposure when liquid equals net claims');
  raise notice '%', is(r->>'unassigned_cents','0','signed fixture has no unassigned resources');
  execute 'reset role';
end $signed$;

do $source_gates$
declare h uuid:='00000000-0000-4000-8000-00000000b741'; a uuid:='00000000-0000-4000-8000-00000000b744'; m uuid:='00000000-0000-4000-8000-00000000b742'; got jsonb; retained bigint; pre_cutover_balance bigint; pre_fp text;
begin
  -- A confirmed positive source needs no allocation.  A negative source with no
  -- confirmed decision remains explicit uncertainty; the read never guesses its sign.
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values
    ('resources-test-income',a,'2026-09-30',date '2026-09-30','{}',h,'test',false,false,500,'ZAR','income');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status) values('00000000-0000-4000-8000-00000000b761',h,'resources-test-income','00000000-0000-4000-8000-00000000b740','user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,decision_source,status) values('00000000-0000-4000-8000-00000000b762',h,'resources-test-income',false,false,'user','confirmed');
  got:=finance.budget_resources(h,'2026-09-30 12:00+00');
  raise notice '%', is((got->>'complete')::boolean,true,'confirmed positive income without allocation leaves fully reconciled resources complete');
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values
    ('resources-test-unreviewed',a,'2026-09-30',date '2026-09-30','{}',h,'test',false,false,-250,'ZAR','unreviewed');
  got:=finance.budget_resources(h,'2026-09-30 12:00+00');
  raise notice '%', ok((got->'reasons') @> '[{"code":"source_unverified"}]'::jsonb
    or (got->'reasons') @> '[{"code":"purpose_exposure_unresolved"}]'::jsonb,
    'negative unreviewed outflow is an explicit source or purpose-exposure gate');
  select balance_cents into retained from finance.budget_fund_balances(h,date '2026-09-30') where fund_id='00000000-0000-4000-8000-00000000b746';
  update finance.budget_allocation_sets set status='needs_review' where id='00000000-0000-4000-8000-00000000b749';
  got:=finance.budget_resources(h,'2026-09-30 12:00+00');
  raise notice '%', ok((got->'reasons') @> '[{"code":"allocation_needs_review"}]'::jsonb,'needs-review allocation makes resources incomplete');
  raise notice '%', is((select balance_cents from finance.budget_fund_balances(h,date '2026-09-30') where fund_id='00000000-0000-4000-8000-00000000b746'),retained,'needs-review allocation retains its frozen fund delta');
  update public.transactions set raw_payload_hash='negative-drift' where id='resources-test-negative';
  got:=finance.budget_resources(h,'2026-09-30 12:00+00');
  raise notice '%', ok((got->'reasons') @> '[{"code":"source_allocation_stale"}]'::jsonb,'source fingerprint drift is explicit while frozen allocation remains');
  -- Historic allocation rows remain auditable but do not alter balances before
  -- the opening cutover.  Archiving their source then makes availability unknown.
  select balance_cents into pre_cutover_balance from finance.budget_fund_balances(h,date '2026-09-30') where fund_id='00000000-0000-4000-8000-00000000b745';
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values('resources-test-precutoff',a,'2026-09-22',date '2026-09-22','{}',h,'test',false,false,-50,'ZAR','precutoff');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status) values('00000000-0000-4000-8000-00000000b764',h,'resources-test-precutoff','00000000-0000-4000-8000-00000000b740','user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,decision_source,status) values('00000000-0000-4000-8000-00000000b765',h,'resources-test-precutoff',false,false,'user','confirmed');
  select finance.budget_source_snapshot(h,'resources-test-precutoff')->>'source_fingerprint' into pre_fp;
  set constraints all deferred;
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id) values('00000000-0000-4000-8000-00000000b766',h,'resources-test-precutoff',finance.budget_source_snapshot(h,'resources-test-precutoff'),pre_fp,-5000,date '2026-09-22',1,'current',m,'00000000-0000-4000-8000-00000000b767');
  insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,beneficiary_scope,effect_kind) values('00000000-0000-4000-8000-00000000b768',h,'00000000-0000-4000-8000-00000000b766',0,-5000,'00000000-0000-4000-8000-00000000b745','00000000-0000-4000-8000-00000000b740','shared','consumption');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values(h,'00000000-0000-4000-8000-00000000b767','fixture','{}',m,'{}');
  set constraints all immediate;
  raise notice '%', is((select balance_cents from finance.budget_fund_balances(h,date '2026-09-30') where fund_id='00000000-0000-4000-8000-00000000b745'),pre_cutover_balance,'pre-cutoff allocation is reported history with zero balance effect');
  update public.transactions set source_is_archived=true where id='resources-test-precutoff';
  got:=finance.budget_resources(h,'2026-09-30 12:00+00');
  raise notice '%', ok((got->'reasons') @> '[{"code":"source_allocation_stale"}]'::jsonb,'archived pre-cutoff source retains frozen audit delta but makes availability unavailable');
end $source_gates$;

do $fallback_and_overflow$
declare h uuid:='00000000-0000-4000-8000-00000000b771'; m uuid:='00000000-0000-4000-8000-00000000b772'; versions jsonb; overflowed boolean:=false;
begin
  insert into finance.households(id) values(h); insert into finance.household_members(id,household_id,email,auth_user_id,role) values(m,h,'fallback@test.invalid','00000000-0000-4000-8000-00000000b773','member');
  insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,version_number,published_at,reason) values('00000000-0000-4000-8000-00000000b774',h,date '2026-09-23',m,'published',1,'2026-09-25 00:00+00','first midcycle');
  versions:=finance.budget_plan_versions(h,date '2026-09-23','2026-09-30 00:00+00');
  raise notice '%', is(versions->>'original_version_id','00000000-0000-4000-8000-00000000b774','no pre-cycle publication falls back to earliest applicable publication');
  -- Actual household aggregation, rather than the scalar helper, must reject
  -- two individually valid funds whose combined claims cannot fit bigint.
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values
    ('00000000-0000-4000-8000-00000000b741','00000000-0000-4000-8000-00000000b781','fixture','{}','00000000-0000-4000-8000-00000000b742','{}');
  insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason) values
    ('00000000-0000-4000-8000-00000000b782','00000000-0000-4000-8000-00000000b741','00000000-0000-4000-8000-00000000b745',9223372036854775807,'assign',date '2026-09-30','00000000-0000-4000-8000-00000000b742','00000000-0000-4000-8000-00000000b781','overflow one'),
    ('00000000-0000-4000-8000-00000000b783','00000000-0000-4000-8000-00000000b741','00000000-0000-4000-8000-00000000b746',9223372036854775807,'assign',date '2026-09-30','00000000-0000-4000-8000-00000000b742','00000000-0000-4000-8000-00000000b781','overflow two');
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000b743','role','authenticated')::text,true); perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000b743',true); perform set_config('request.jwt.claim.role','authenticated',true); execute 'set local role authenticated';
  begin perform public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00'); exception when sqlstate 'P0001' then overflowed:=sqlerrm like 'budget_invalid:%'; end;
  raise notice '%', ok(overflowed,'two valid fund balances overflowing the household aggregate raise budget_invalid');
  execute 'reset role';
end $fallback_and_overflow$;

-- The newest reconciliation is authoritative even when incomplete; record times
-- and IDs are distinct so this does not rely on unspecified tie ordering.
do $newest$
declare r jsonb; h uuid:='00000000-0000-4000-8000-00000000b701'; frozen_coverage jsonb; old_recorded timestamptz;
begin
  select coverage_snapshot,recorded_at into frozen_coverage,old_recorded from finance.budget_reconciliations
    where id='00000000-0000-4000-8000-00000000b733';
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes,recorded_at)
  values('00000000-0000-4000-8000-00000000b760',h,'2026-09-30 12:00+00','00000000-0000-4000-8000-00000000b702','incomplete',frozen_coverage,date '2026-09-23','newer incomplete',old_recorded + interval '1 second');
  r:=finance.budget_resources(h,'2026-09-30 12:00+00');
  raise notice '%', is(r->>'reconciliation_id','00000000-0000-4000-8000-00000000b760','newest incomplete reconciliation never falls back to old complete');
  raise notice '%', is((r->>'complete')::boolean,false,'newest incomplete record remains incomplete');
end $newest$;

select throws_ok($q$select finance.budget_checked_bigint(9223372036854775808::numeric)$q$,'P0001','budget_invalid: numeric result is outside bigint','overflowing aggregate guard uses budget_invalid');

set constraints all immediate;
select * from finish();
rollback;
