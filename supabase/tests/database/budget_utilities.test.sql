-- Stage 4 household-safe utility-recognition acceptance tests.
--
-- This suite deliberately uses synthetic source rows and real member/service
-- roles.  It is the executable acceptance contract for H; it must not be
-- weakened to accommodate an implementation which makes an unverified source
-- look owned or turns a utility charge into a bank transaction.

begin;
select * from no_plan();

select has_table('consumption', 'devices', 'consumption devices table exists');
select has_table('consumption', 'ledger_entries', 'consumption ledger entries table exists');
select has_table('finance', 'financial_event_legs', 'financial event legs table exists');
select has_function('public', 'provision_consumption_device_ownership_v1', 'uuid, uuid, text');
select has_function('public', 'ingest_consumption_batch', 'jsonb');
select has_function('public', 'budget_review_allocation_v1', 'uuid, jsonb');
select has_function('public', 'budget_change_earmark_v1', 'uuid, jsonb');

-- Household A is the owner; B is a deliberately foreign household.  The
-- auth identities are bound so every public read/RPC below exercises the same
-- caller-resolution path as the application.
insert into finance.households(id) values
  ('00000000-0000-4000-8000-00000000f401'),
  ('00000000-0000-4000-8000-00000000f402');
insert into finance.household_members(id, household_id, email, auth_user_id, role)
values
  ('00000000-0000-4000-8000-00000000f411','00000000-0000-4000-8000-00000000f401','utility-a@test.invalid','00000000-0000-4000-8000-00000000f421','member'),
  ('00000000-0000-4000-8000-00000000f412','00000000-0000-4000-8000-00000000f402','utility-b@test.invalid','00000000-0000-4000-8000-00000000f422','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
values
  ('00000000-0000-4000-8000-00000000f431','utility-wallet-a','Utility wallet A','00000000-0000-4000-8000-00000000f401','test','ZAR'),
  ('00000000-0000-4000-8000-00000000f432','utility-wallet-b','Utility wallet B','00000000-0000-4000-8000-00000000f402','test','ZAR');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by)
values
  ('00000000-0000-4000-8000-00000000f441','00000000-0000-4000-8000-00000000f401','Utilities','shared','00000000-0000-4000-8000-00000000f411'),
  ('00000000-0000-4000-8000-00000000f442','00000000-0000-4000-8000-00000000f402','Other utilities','shared','00000000-0000-4000-8000-00000000f412');
insert into finance.categories(id,household_id,name,slug)
values ('00000000-0000-4000-8000-00000000f451','00000000-0000-4000-8000-00000000f401','Utilities','utility-category');

-- A service caller cannot provision without evidence, cannot re-claim an
-- owned device, and cannot claim a device already owned by another household.
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select throws_ok($q$select public.provision_consumption_device_ownership_v1('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f461','   ')$q$,
  'P0001','budget_invalid: ownership evidence','blank ownership evidence is rejected');
insert into consumption.devices(id,source,external_id,kind,name,utility_type,location)
values
  ('00000000-0000-4000-8000-00000000f461','ismrt','meter-a','meter','Meter A','electricity','utility-room'),
  ('00000000-0000-4000-8000-00000000f462','ismrt','meter-b','meter','Meter B','electricity','utility-room'),
  ('00000000-0000-4000-8000-00000000f463','ismrt','wallet-a','wallet','Wallet A','wallet','utility-room'),
  ('00000000-0000-4000-8000-00000000f464','ismrt','wallet-unowned','wallet','Wallet unowned','wallet','utility-room');
-- A row written before ownership is provisioned remains unowned; provisioning
-- does not perform a historical ledger backfill.
insert into consumption.ledger_entries(id,source,source_record_id,device_id,utility_type,entry_type,direction,amount,currency)
values ('00000000-0000-4000-8000-00000000f471','ismrt','historic-a','00000000-0000-4000-8000-00000000f461','electricity','usage_charge','debit',10,'ZAR');
select public.provision_consumption_device_ownership_v1('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f461','verified fixture');
select public.provision_consumption_device_ownership_v1('00000000-0000-4000-8000-00000000f402','00000000-0000-4000-8000-00000000f462','verified fixture');
select throws_ok($q$select public.provision_consumption_device_ownership_v1('00000000-0000-4000-8000-00000000f402','00000000-0000-4000-8000-00000000f461','second claim')$q$,
  'P0001','budget_conflict: device is owned by another household','re-claiming a device is rejected');
select is((select household_id from consumption.devices where id='00000000-0000-4000-8000-00000000f461'),
  '00000000-0000-4000-8000-00000000f401'::uuid,'provisioning records the verified owner');

-- Historical rows are intentionally not backfilled by provisioning.
select is((select household_id from consumption.ledger_entries where id='00000000-0000-4000-8000-00000000f471'),
  null::uuid,'provisioning does not claim historical ledger rows');

-- Ingestion remains service-only, derives ownership for new rows, and keeps
-- unowned source rows unrecognized.  The payload deliberately includes both.
select public.ingest_consumption_batch(jsonb_build_object(
  'devices',jsonb_build_array(jsonb_build_object('source','ismrt','external_id','wallet-new','kind','wallet','name','Wallet new','utility_type','wallet','location','utility-room')),
  'ledger_entries',jsonb_build_array(
    jsonb_build_object('source','ismrt','source_record_id','owned-usage','utility_type','electricity','entry_type','usage_charge','direction','debit','amount',12.34,'currency','ZAR','device_source','ismrt','device_external_id','meter-a','occurred_at','2026-10-01T00:00:00Z','posted_at','2026-10-01T01:00:00Z'),
    jsonb_build_object('source','ismrt','source_record_id','unowned-usage','utility_type','wallet','entry_type','deposit','direction','credit','amount',9.99,'currency','ZAR','device_source','ismrt','device_external_id','wallet-new','occurred_at','2026-10-01T00:00:00Z','posted_at','2026-10-01T01:00:00Z'))
));
select is((select household_id from consumption.ledger_entries where source_record_id='owned-usage'),
  '00000000-0000-4000-8000-00000000f401'::uuid,'new ingestion derives owned device household');
select is((select household_id from consumption.ledger_entries where source_record_id='unowned-usage'),
  null::uuid,'unowned ingestion remains unrecognized');
select is((select count(*) from consumption.ledger_entries where household_id is null),2::bigint,
  'historical and unowned rows remain distinguishable without a backfill');
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000f421','role','authenticated')::text,true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000f421',true);
select set_config('request.jwt.claim.role','authenticated',true);
select is((select count(*) from consumption.devices),1::bigint,'member cannot see foreign/unowned devices');
select is((select count(*) from consumption.devices where id='00000000-0000-4000-8000-00000000f461'),1::bigint,
  'member can directly read its owned device');
select is((select count(*) from consumption.devices where id in ('00000000-0000-4000-8000-00000000f462','00000000-0000-4000-8000-00000000f463')),0::bigint,
  'member cannot directly read foreign or unowned devices');
select is((select count(*) from consumption.ledger_entries),1::bigint,'member sees only owned ledger rows');
select is((select count(*) from consumption.ledger_entries where source_record_id='owned-usage'),1::bigint,
  'member can directly read its owned ledger entry');
select is((select count(*) from consumption.ledger_entries where source_record_id in ('historic-a','unowned-usage')),0::bigint,
  'member cannot directly read historical or unowned ledger entries');
select throws_ok($q$select public.provision_consumption_device_ownership_v1('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f463','member attempt')$q$,
  '42501',NULL,'member cannot provision ownership');

-- Parent/device and ledger/device household consistency is enforced, while a
-- member may only configure an owned utility device in the same household.
reset role;
set local role service_role;
select throws_ok($q$insert into consumption.devices(id,source,external_id,kind,name,utility_type,location,parent_device_id,household_id)
  values ('00000000-0000-4000-8000-00000000f472','fixture','child-cross','meter','Cross child','electricity','utility-room','00000000-0000-4000-8000-00000000f462','00000000-0000-4000-8000-00000000f401')$q$,
  'P0001','budget_invalid: child device household must match owned parent','parent/device household mismatch rejects');
select throws_ok($q$update consumption.ledger_entries set household_id='00000000-0000-4000-8000-00000000f402' where source_record_id='owned-usage'$q$,
  'P0001','budget_invalid: ledger ownership must derive from device','ledger/device household mismatch rejects');
set local role authenticated;
select throws_ok($q$select public.budget_configure_account_v1('00000000-0000-4000-8000-00000000f499',jsonb_build_object(
  'account_id','00000000-0000-4000-8000-00000000f431','owner_scope','shared','included',true,
  'resource_class','restricted','freshness_hours',24,'transaction_sign_convention','unknown',
  'utility_device_id','00000000-0000-4000-8000-00000000f462'))$q$,
  'P0001','budget_forbidden: owned utility device','member cannot configure foreign utility device');
reset role;
set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select public.provision_consumption_device_ownership_v1('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f463','verified fixture');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select public.budget_configure_account_v1('00000000-0000-4000-8000-00000000f4a0',jsonb_build_object(
  'account_id','00000000-0000-4000-8000-00000000f431','owner_scope','shared','included',true,
  'resource_class','restricted','freshness_hours',24,'transaction_sign_convention','unknown',
  'utility_device_id','00000000-0000-4000-8000-00000000f463'));
select is((select utility_device_id from finance.budget_account_settings where account_id='00000000-0000-4000-8000-00000000f431'),
  '00000000-0000-4000-8000-00000000f463'::uuid,'member can configure verified same-household wallet');

-- Utility event legs are household-scoped and have exactly one active source.
reset role;
insert into consumption.ledger_entries(id,source,source_record_id,device_id,household_id,utility_type,entry_type,direction,amount,currency,occurred_at,posted_at,description)
values
 ('00000000-0000-4000-8000-00000000f480','ismrt','unowned-topup','00000000-0000-4000-8000-00000000f464',null,'wallet','deposit','credit',100,'ZAR','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','unowned wallet top-up'),
 ('00000000-0000-4000-8000-00000000f481','ismrt','wallet-topup','00000000-0000-4000-8000-00000000f463','00000000-0000-4000-8000-00000000f401','wallet','deposit','credit',100,'ZAR','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','wallet top-up'),
 ('00000000-0000-4000-8000-00000000f482','ismrt','usage-charge','00000000-0000-4000-8000-00000000f461','00000000-0000-4000-8000-00000000f401','electricity','usage_charge','debit',34.94,'ZAR','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','usage'),
 ('00000000-0000-4000-8000-00000000f483','ismrt','usage-fee','00000000-0000-4000-8000-00000000f463','00000000-0000-4000-8000-00000000f401','wallet','fee','debit',1.00,'ZAR','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','fee'),
 ('00000000-0000-4000-8000-00000000f484','ismrt','foreign-usage','00000000-0000-4000-8000-00000000f462','00000000-0000-4000-8000-00000000f402','electricity','usage_charge','debit',3.49,'ZAR','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','foreign usage'),
 ('00000000-0000-4000-8000-00000000f485','ismrt','bad-currency','00000000-0000-4000-8000-00000000f461','00000000-0000-4000-8000-00000000f401','electricity','usage_charge','debit',3.49,'USD','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','bad currency'),
 ('00000000-0000-4000-8000-00000000f486','ismrt','sub-cent','00000000-0000-4000-8000-00000000f461','00000000-0000-4000-8000-00000000f401','electricity','usage_charge','debit',3.491,'ZAR','2026-10-01T00:00:00Z','2026-10-01T01:00:00Z','sub-cent');
insert into finance.financial_events(id,household_id,event_type,status) values ('00000000-0000-4000-8000-00000000f491','00000000-0000-4000-8000-00000000f401','purchase','confirmed');
insert into finance.financial_event_legs(id,household_id,event_id,utility_entry_id,leg_role,status)
values ('00000000-0000-4000-8000-00000000f4a1','00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f491','00000000-0000-4000-8000-00000000f482','economic_recognition','active');
select throws_ok($q$insert into finance.financial_event_legs(household_id,event_id,utility_entry_id,transaction_id,leg_role,status) values ('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f491','00000000-0000-4000-8000-00000000f482','foreign-tx','mirror','active')$q$,
  '23514',NULL,'event leg cannot contain both sources');
select throws_ok($q$insert into finance.financial_event_legs(household_id,event_id,utility_entry_id,leg_role,status) values ('00000000-0000-4000-8000-00000000f402','00000000-0000-4000-8000-00000000f491','00000000-0000-4000-8000-00000000f482','economic_recognition','active')$q$,
  'P0001','budget_invalid: utility event leg household','cross-household utility leg rejects');

-- Utility review is strict: source ownership, canonical fingerprint, ZAR
-- integer cents, one source, evidence, and no bank-only decision fields.
reset role;
select set_config('test.utility_fp',finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f482')->>'source_fingerprint',true);
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000f421','role','authenticated')::text,true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000f421',true);
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok($q$select public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4b1',jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f480','expected_source_fingerprint','stale','components',jsonb_build_array(jsonb_build_object('amount_cents','0','beneficiary_scope','shared','effect_kind','movement')),'evidence',jsonb_build_object('utility_decision_reference','fixture')))$q$,
  'P0001','budget_forbidden: utility source','unowned utility allocation rejects');
select throws_ok($q$select public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4b5',jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f484','expected_source_fingerprint','stale','components',jsonb_build_array(jsonb_build_object('amount_cents','-349','beneficiary_scope','shared','effect_kind','consumption','fund_id','00000000-0000-4000-8000-00000000f441')),'evidence',jsonb_build_object('utility_decision_reference','fixture')))$q$,
  'P0001','budget_forbidden: utility source','cross-household utility allocation rejects');
select throws_ok($q$select public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4b2',jsonb_build_object('transaction_id','foreign-tx','utility_entry_id','00000000-0000-4000-8000-00000000f482','expected_source_fingerprint','x','components',jsonb_build_array(jsonb_build_object('amount_cents','-3494','beneficiary_scope','shared','effect_kind','consumption','fund_id','00000000-0000-4000-8000-00000000f441')),'evidence',jsonb_build_object('utility_decision_reference','fixture')))$q$,
  'P0001','budget_invalid: exactly one source','bank and utility source cannot be combined');
select throws_ok($q$select public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4b3',jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f482','expected_source_fingerprint','stale','components',jsonb_build_array(jsonb_build_object('amount_cents','-3494','beneficiary_scope','shared','effect_kind','consumption','fund_id','00000000-0000-4000-8000-00000000f441')),'evidence',jsonb_build_object('utility_decision_reference','fixture')))$q$,
  'P0001','budget_stale: source fingerprint','stale utility fingerprint rejects');
select throws_ok(format($q$select public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4b4',jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f482','expected_source_fingerprint',%L,'components',jsonb_build_array(jsonb_build_object('amount_cents','-3494','beneficiary_scope','shared','effect_kind','consumption','fund_id','00000000-0000-4000-8000-00000000f441')),'evidence',jsonb_build_object('utility_decision_reference',' ')))$q$,current_setting('test.utility_fp')),
  'P0001','budget_invalid: empty utility_decision_reference','utility review rejects empty decision reference');

-- Failed utility work is atomic: validation errors leave neither a set nor a
-- completed command receipt behind.
select is((select count(*) from finance.budget_allocation_sets where id in ('00000000-0000-4000-8000-00000000f4b1','00000000-0000-4000-8000-00000000f4b2','00000000-0000-4000-8000-00000000f4b3','00000000-0000-4000-8000-00000000f4b4','00000000-0000-4000-8000-00000000f4b5')),0::bigint,'rejected utility sources create no allocation set');
select is((select count(*) from finance.budget_commands where command_id in ('00000000-0000-4000-8000-00000000f4b1','00000000-0000-4000-8000-00000000f4b2','00000000-0000-4000-8000-00000000f4b3','00000000-0000-4000-8000-00000000f4b4','00000000-0000-4000-8000-00000000f4b5')),0::bigint,'rejected utility sources create no command receipt');

reset role;
do $utility_success$
declare p jsonb; r jsonb; replay jsonb; usage_set uuid; fee_set uuid; deposit_set uuid; fu text; ff text; fd text; before_earmarks bigint;
begin
  fu:=finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f482')->>'source_fingerprint';
  ff:=finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f483')->>'source_fingerprint';
  fd:=finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f481')->>'source_fingerprint';
  execute 'set local role authenticated';
  before_earmarks:=(select count(*) from finance.fund_earmarks where household_id='00000000-0000-4000-8000-00000000f401');
  perform set_config('finance.stage4_earmarks',jsonb_build_object(
    'kind','allocation',
    'canonical_payload',jsonb_build_object('transaction_id','stale-bank-source','earmarks',jsonb_build_array(jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000f441','restricted_account_id','00000000-0000-4000-8000-00000000f431','amount_cents','1'))),
    'earmarks',jsonb_build_array(jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000f441','restricted_account_id','00000000-0000-4000-8000-00000000f431','amount_cents','1'))
  )::text,true);
  p:=jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f482','expected_source_fingerprint',fu,'components',jsonb_build_array(jsonb_build_object('amount_cents','-3494','fund_id','00000000-0000-4000-8000-00000000f441','beneficiary_scope','shared','effect_kind','consumption')),'evidence',jsonb_build_object('utility_decision_reference','usage-fixture'));
  r:=public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4c1',p); usage_set:=(r->>'set_id')::uuid;
  raise notice '%', ok(usage_set is not null,'owned usage allocation succeeds');
  raise notice '%', is(r->>'source_fingerprint',fu,'utility receipt retains the fresh utility source fingerprint');
  raise notice '%', is((select count(*) from finance.fund_earmarks where household_id='00000000-0000-4000-8000-00000000f401'),before_earmarks,'stale bank earmark state cannot contaminate utility allocation');
  raise notice '%', is((select count(*) from finance.budget_allocations where set_id=usage_set and amount_cents=-3494),1::bigint,'usage creates one signed expense allocation');
  replay:=public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4c1',p);
  raise notice '%', is(replay,r,'usage replay returns the original receipt result');
  raise notice '%', is((select count(*) from finance.budget_allocation_sets where utility_entry_id='00000000-0000-4000-8000-00000000f482' and status in ('current','needs_review')),1::bigint,'usage replay creates no duplicate live set');
  raise notice '%', is((select count(*) from finance.budget_allocations a join finance.budget_allocation_sets s on s.id=a.set_id where s.utility_entry_id='00000000-0000-4000-8000-00000000f482' and a.amount_cents=-3494),1::bigint,'usage is recognized exactly once');
  p:=jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f483','expected_source_fingerprint',ff,'components',jsonb_build_array(jsonb_build_object('amount_cents','-100','fund_id','00000000-0000-4000-8000-00000000f441','beneficiary_scope','shared','effect_kind','consumption')),'evidence',jsonb_build_object('utility_decision_reference','fee-fixture'));
  r:=public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4c2',p); fee_set:=(r->>'set_id')::uuid;
  raise notice '%', ok(fee_set is not null,'owned fee allocation succeeds');
  raise notice '%', is((select count(*) from finance.budget_allocations where set_id=fee_set and amount_cents=-100),1::bigint,'fee creates one signed expense allocation');
  p:=jsonb_build_object('utility_entry_id','00000000-0000-4000-8000-00000000f481','expected_source_fingerprint',fd,'components',jsonb_build_array(jsonb_build_object('amount_cents','0','beneficiary_scope','shared','effect_kind','movement')),'evidence',jsonb_build_object('utility_decision_reference','deposit-fixture'));
  r:=public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000f4c3',p); deposit_set:=(r->>'set_id')::uuid;
  raise notice '%', ok(deposit_set is not null,'owned wallet deposit allocation succeeds');
  raise notice '%', is((select count(*) from finance.budget_allocations where set_id=deposit_set and amount_cents=0 and effect_kind='movement'),1::bigint,'wallet deposit is zero-fund movement');
  raise notice '%', is((select count(*) from finance.budget_allocations where set_id=deposit_set and effect_kind in ('consumption','contribution','required_debt_payment','extra_debt_payment')),0::bigint,'wallet deposit cannot become expense');
end $utility_success$;

reset role;
-- Canonical wallet top-up is a zero-fund movement; usage and fee are one
-- signed expense each.  The public surface retains the wallet restriction
-- separately and never manufactures a bank transaction or duplicate ledger.
select ok((finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f482')->>'complete')::boolean,
  'canonical utility snapshot exposes owned incurred usage');
select is(finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f481')->>'signed_amount_cents','0',
  'wallet top-up is a zero-fund resource movement');
select is(finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f482')->>'signed_amount_cents','-3494',
  'usage charge is one signed fund outflow at incurred date');
select is(finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f483')->>'signed_amount_cents','-100',
  'wallet fee is one signed fund outflow');
select ok(not (finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f485')->>'complete')::boolean,
  'non-ZAR utility source is incomplete');
select ok(not (finance.budget_utility_snapshot('00000000-0000-4000-8000-00000000f401','00000000-0000-4000-8000-00000000f486')->>'complete')::boolean,
  'sub-cent utility source is incomplete');
select ok(not exists(select 1 from public.transactions where id in ('ismrt:wallet-topup','ismrt:usage-charge','ismrt:usage-fee')),
  'utility recognition does not fabricate public transactions');
select ok(exists(select 1 from finance.financial_event_legs where utility_entry_id='00000000-0000-4000-8000-00000000f482' and status='active'),
  'utility usage remains linked to its event');
select ok((select count(*) from consumption.ledger_entries where source='ismrt' and source_record_id in ('wallet-topup','usage-charge','usage-fee'))=3,
  'top-up/usage/fee retain one canonical source row each');

-- Source corrections and supersession append lineage, rather than mutating or
-- duplicating the original claim.  The final public result remains incomplete
-- while wallet ownership/coverage is not verified.
select has_column('finance','budget_allocation_sets','supersedes_id','allocation sets retain supersession lineage');
select has_column('finance','budget_allocation_sets','utility_entry_id','allocation sets support utility sources');
select is((select count(*) from finance.budget_commands where command_id in ('00000000-0000-4000-8000-00000000f4c1','00000000-0000-4000-8000-00000000f4c2','00000000-0000-4000-8000-00000000f4c3')),3::bigint,
  'successful utility allocations retain exactly one receipt each');
select is((select count(*) from finance.budget_allocation_sets where utility_entry_id in ('00000000-0000-4000-8000-00000000f481','00000000-0000-4000-8000-00000000f482','00000000-0000-4000-8000-00000000f483') and status in ('current','needs_review')),3::bigint,
  'successful utility sources retain one live allocation lineage each');
select * from finish();
rollback;
