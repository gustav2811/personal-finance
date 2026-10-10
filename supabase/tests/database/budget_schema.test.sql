begin;
select no_plan();

-- This file owns domain rules. RLS and grants are covered by the security suite.
insert into finance.households(id) values
 ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002') on conflict do nothing;
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','a@test.invalid','00000000-0000-4000-8000-000000000021','member'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000002','b@test.invalid','00000000-0000-4000-8000-000000000022','member');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','Main','shared','00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000001','Second','shared','00000000-0000-4000-8000-000000000011'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000002','Other','shared','00000000-0000-4000-8000-000000000012');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system) values
 ('00000000-0000-4000-8000-000000000041','budget-a','A','00000000-0000-4000-8000-000000000001','test'),
 ('00000000-0000-4000-8000-000000000042','budget-b','B','00000000-0000-4000-8000-000000000002','test');
insert into consumption.devices(id,source,external_id,kind,name,utility_type,household_id) values
 ('00000000-0000-4000-8000-000000000099','test','budget-device','meter','Budget device','electricity','00000000-0000-4000-8000-000000000001');
insert into public.transactions(id,account_id,date,details,household_id,source_system) values
 ('budget-domain-tx-a','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-tx-b','00000000-0000-4000-8000-000000000042',now(),'{}','00000000-0000-4000-8000-000000000002','test'),
 ('budget-domain-checks','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-zero','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-empty','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-refund','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-refund-bad','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-sum-mismatch','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test'),
 ('budget-domain-overflow','00000000-0000-4000-8000-000000000041',now(),'{}','00000000-0000-4000-8000-000000000001','test');
insert into finance.categories(id,household_id,name,slug) values
 ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000001','Food','food'),
 ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000002','Other','other');
insert into finance.financial_events(id,household_id,event_type) values
 ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000001','purchase'),
 ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000002','purchase');
insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status)
 values ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000001','budget-domain-tx-a','00000000-0000-4000-8000-000000000051','user','confirmed');
insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,decision_source,status)
 values ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000001','budget-domain-tx-a',false,false,'user','confirmed');

select throws_ok($q$insert into finance.funds(household_id,name,beneficiary_scope,created_by) values ('00000000-0000-4000-8000-000000000001','x','shared','00000000-0000-4000-8000-000000000012')$q$,'23503',NULL,'cross-household fund actor');
select throws_ok($q$insert into finance.budget_versions(household_id,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000001',date '2026-09-23','00000000-0000-4000-8000-000000000012','x')$q$,'23503',NULL,'cross-household version actor');
select throws_ok($q$insert into finance.budget_versions(household_id,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000001',date '2026-09-22','00000000-0000-4000-8000-000000000011','x')$q$,'23514',NULL,'cycle must start on day 23');
insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000001',date '2026-09-23','00000000-0000-4000-8000-000000000011','draft');
select throws_ok($q$insert into finance.budget_versions(household_id,state,version_number,published_at,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000001','draft',1,now(),date '2026-09-23','00000000-0000-4000-8000-000000000011','x')$q$,'23514',NULL,'draft publication fields are null');
select throws_ok($q$insert into finance.budget_versions(household_id,state,version_number,published_at,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000001','published',0,now(),date '2026-09-23','00000000-0000-4000-8000-000000000011','x')$q$,'23514',NULL,'published number positive');
select throws_ok($q$insert into finance.budget_versions(id,household_id,parent_version_id,state,version_number,published_at,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','published',1,now(),date '2026-09-23','00000000-0000-4000-8000-000000000011','x')$q$,'P0001',NULL,'draft parent is forbidden');
select throws_ok($q$insert into finance.budget_versions(id,household_id,parent_version_id,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000102',date '2026-09-23','00000000-0000-4000-8000-000000000011','self')$q$,'P0001',NULL,'self parent is forbidden');
insert into finance.budget_versions(id,household_id,state,version_number,published_at,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000001','published',1,now(),date '2026-09-23','00000000-0000-4000-8000-000000000011','published');
select throws_ok($q$insert into finance.budget_versions(id,household_id,parent_version_id,state,version_number,published_at,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000104','published',1,now(),date '2026-09-23','00000000-0000-4000-8000-000000000011','x')$q$,'P0001',NULL,'parent number must be lower');

select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy,target_cents) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000031','x','shared','consumption','target_by_date','cycle','carry',NULL)$q$,'23514',NULL,'target date requires target and due date');
select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000112','00000000-0000-4000-8000-000000000031','x','shared','consumption','reserve_target','cycle','carry')$q$,'23514',NULL,'reserve target requires target');
select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy,category_id) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000031','x','shared','consumption','cycle_allowance','cycle','carry','00000000-0000-4000-8000-000000000052')$q$,'23503',NULL,'line category household');
select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy,expected_payment_account_id) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000113','00000000-0000-4000-8000-000000000031','x','shared','consumption','cycle_allowance','cycle','carry','00000000-0000-4000-8000-000000000042')$q$,'23503',NULL,'line account household');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values ('00000000-0000-4000-8000-000000000114','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000115','00000000-0000-4000-8000-000000000031','line','shared','consumption','cycle_allowance','cycle','carry');
update finance.budget_versions set state='published',version_number=2,published_at=now() where id='00000000-0000-4000-8000-000000000101';
select throws_ok($q$update finance.budget_lines set name='changed' where id='00000000-0000-4000-8000-000000000114'$q$,'P0001',NULL,'published line update');
select throws_ok($q$delete from finance.budget_lines where id='00000000-0000-4000-8000-000000000114'$q$,'P0001',NULL,'published line delete');
select throws_ok($q$update finance.budget_versions set reason='changed' where id='00000000-0000-4000-8000-000000000101'$q$,'P0001',NULL,'published header update');
select throws_ok($q$delete from finance.budget_versions where id='00000000-0000-4000-8000-000000000101'$q$,'P0001',NULL,'published header delete');
select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000116','00000000-0000-4000-8000-000000000033','late','shared','consumption','cycle_allowance','cycle','carry')$q$,'P0001',NULL,'published line insert');
insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,reason) values ('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000001',date '2026-10-23','00000000-0000-4000-8000-000000000011','new draft');
select throws_ok($q$update finance.budget_lines set version_id='00000000-0000-4000-8000-000000000106' where id='00000000-0000-4000-8000-000000000114'$q$,'P0001',NULL,'line cannot be reparented from published version');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values ('00000000-0000-4000-8000-000000000117','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000118','00000000-0000-4000-8000-000000000031','draft line','shared','consumption','cycle_allowance','cycle','carry');
select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000118','00000000-0000-4000-8000-000000000033','same stable','shared','consumption','cycle_allowance','cycle','carry')$q$,'23505',NULL,'draft stable line is unique');
select throws_ok($q$insert into finance.budget_lines(household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,funding_behaviour,recurrence,rollover_policy) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000119','00000000-0000-4000-8000-000000000031','same fund','shared','consumption','cycle_allowance','cycle','carry')$q$,'23505',NULL,'draft fund is unique');

-- Receipt is deliberately inserted last. This also exercises source, decision,
-- fund, category and payment-account references on a valid allocation.
insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id,classification_id,treatment_id) values ('00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000001','budget-domain-tx-a','{}','source',-100,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000131','00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000081');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,beneficiary_scope,payment_account_id,effect_kind) values ('00000000-0000-4000-8000-000000000141','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000121',0,-100,'00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000051','shared','00000000-0000-4000-8000-000000000041','consumption');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000131','review','{}','00000000-0000-4000-8000-000000000011','{}');
select lives_ok($q$set constraints all immediate$q$,'valid split commits');
set constraints all deferred;
select throws_ok($q$insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,beneficiary_scope,effect_kind) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000121',1,0,'shared','unresolved')$q$,'P0001',NULL,'completed set rejects component');
select throws_ok($q$update finance.budget_allocations set amount_cents=-99 where id='00000000-0000-4000-8000-000000000141'$q$,'P0001',NULL,'components immutable');
select throws_ok($q$delete from finance.budget_allocations where id='00000000-0000-4000-8000-000000000141'$q$,'P0001',NULL,'components append-only');
select throws_ok($q$update finance.budget_allocation_sets set source_fingerprint='changed' where id='00000000-0000-4000-8000-000000000121'$q$,'P0001',NULL,'allocation set metadata immutable');
select throws_ok($q$delete from finance.budget_allocation_sets where id='00000000-0000-4000-8000-000000000121'$q$,'P0001',NULL,'allocation set append-only');
insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id) values ('00000000-0000-4000-8000-000000000181','00000000-0000-4000-8000-000000000001','budget-domain-checks','{}','checks',-1,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000191');
select throws_ok($q$insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,beneficiary_scope,effect_kind) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000181',0,1,'shared','consumption')$q$,'23514',NULL,'purpose sign and fund required');
select throws_ok($q$insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind,original_refund_allocation_id) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000181',0,1,'00000000-0000-4000-8000-000000000032','shared','refund','00000000-0000-4000-8000-000000000141')$q$,'P0001',NULL,'refund original household and fund');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,beneficiary_scope,effect_kind) values ('00000000-0000-4000-8000-000000000182','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000181',0,-1,'shared','unresolved');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000191','review','{}','00000000-0000-4000-8000-000000000011','{}');
select lives_ok($q$set constraints all immediate$q$,'negative sign checks set closes');
set constraints all deferred;
select lives_ok($q$do $$declare s uuid := '00000000-0000-4000-8000-000000000151'; begin insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id) values(s,'00000000-0000-4000-8000-000000000001','budget-domain-zero','{}','zero',0,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000152'); insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,beneficiary_scope,effect_kind) values('00000000-0000-4000-8000-000000000001',s,0,0,'shared','unresolved'); insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000152','review','{}','00000000-0000-4000-8000-000000000011','{}'); end$$; set constraints all immediate; set constraints all deferred$q$,'zero net source accepts zero effect component');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000153','review','{}','00000000-0000-4000-8000-000000000011','{}');
select throws_ok($q$do $$begin insert into finance.budget_allocation_sets(household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id) values('00000000-0000-4000-8000-000000000001','budget-domain-empty','{}','empty',0,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000153'); set constraints all immediate; end$$$q$,'P0001','budget_incomplete: allocation split requires at least one component','zero source still requires component');
select throws_ok($q$insert into finance.budget_allocation_sets(household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id,classification_id) values('00000000-0000-4000-8000-000000000001','budget-domain-tx-a','{}','bad-decision',-1,current_date,2,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000161','00000000-0000-4000-8000-000000000052')$q$,'P0001',NULL,'classification source mismatch');
select throws_ok($q$insert into finance.budget_allocation_sets(household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id) values('00000000-0000-4000-8000-000000000001','budget-domain-tx-a','{}','duplicate',-1,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000161')$q$,'23505',NULL,'live source uniqueness');
select throws_ok($q$insert into finance.budget_allocation_sets(household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id) values('00000000-0000-4000-8000-000000000001','budget-domain-tx-a','{}','unlinked-revision',-100,current_date,2,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000161')$q$,'23514',NULL,'later revision requires supersession link');
update finance.budget_allocation_sets set status='superseded' where id='00000000-0000-4000-8000-000000000121';
insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id,supersedes_id) values ('00000000-0000-4000-8000-000000000122','00000000-0000-4000-8000-000000000001','budget-domain-tx-a','{}','source-revision-2',-100,current_date,2,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000162','00000000-0000-4000-8000-000000000121');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind) values ('00000000-0000-4000-8000-000000000142','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000122',0,-100,'00000000-0000-4000-8000-000000000031','shared','consumption');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000162','review','{}','00000000-0000-4000-8000-000000000011','{}');
select lives_ok($q$set constraints all immediate$q$,'valid supersession closes');
set constraints all deferred;
select throws_ok($q$update finance.budget_allocation_sets set status='current' where id='00000000-0000-4000-8000-000000000121'$q$,'P0001',NULL,'superseded set is terminal');

insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id) values ('00000000-0000-4000-8000-000000000123','00000000-0000-4000-8000-000000000001','budget-domain-refund','{}','refund',100,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000133');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind,original_refund_allocation_id) values ('00000000-0000-4000-8000-000000000143','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000123',0,100,'00000000-0000-4000-8000-000000000031','shared','refund','00000000-0000-4000-8000-000000000141');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000133','review','{}','00000000-0000-4000-8000-000000000011','{}');
select lives_ok($q$set constraints all immediate$q$,'same-fund linked refund closes');
set constraints all deferred;
select throws_ok($q$do $$begin
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id)
  values ('00000000-0000-4000-8000-000000000124','00000000-0000-4000-8000-000000000001','budget-domain-refund-bad','{}','refund-bad',100,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000134');
  insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind,original_refund_allocation_id)
  values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000124',0,100,'00000000-0000-4000-8000-000000000033','shared','refund','00000000-0000-4000-8000-000000000141');
end$$$q$,'P0001','budget_invalid: refund must link same fund negative purpose outflow','refund requires same fund');

select throws_ok($q$do $$begin
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id)
  values ('00000000-0000-4000-8000-000000000125','00000000-0000-4000-8000-000000000001','budget-domain-sum-mismatch','{}','sum-mismatch',-100,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000135');
  insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind)
  values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000125',0,-99,'00000000-0000-4000-8000-000000000031','shared','consumption');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
  values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000135','review','{}','00000000-0000-4000-8000-000000000011','{}');
  set constraints all immediate;
end$$$q$,'P0001','budget_invalid: allocation split does not equal source amount','sum mismatch rejects at commit');

select lives_ok($q$do $$begin
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,actor_id,command_id)
  values ('00000000-0000-4000-8000-000000000126','00000000-0000-4000-8000-000000000001','budget-domain-overflow','{}','overflow',1,current_date,1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000136');
  insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,beneficiary_scope,effect_kind) values
    ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000126',0,9223372036854775807,'shared','unresolved'),
    ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000126',1,9223372036854775807,'shared','unresolved'),
    ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000126',2,-9223372036854775807,'shared','unresolved'),
    ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000126',3,-9223372036854775806,'shared','unresolved');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
  values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000136','review','{}','00000000-0000-4000-8000-000000000011','{}');
end$$; set constraints all immediate; set constraints all deferred$q$,'numeric split sum avoids bigint overflow');

insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000171','move','{}','00000000-0000-4000-8000-000000000011','{}');
insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,funding_occurrence_key) values ('00000000-0000-4000-8000-000000000172','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000171','assign','occ');
select throws_ok($q$insert into finance.fund_movements(household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',1,'release',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000171','bad endpoint')$q$,'23514',NULL,'movement endpoints');
select throws_ok($q$insert into finance.fund_movements(household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,funding_occurrence_key) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',1,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000171','duplicate','occ')$q$,'23505',NULL,'duplicate movement occurrence');
select throws_ok($q$insert into finance.fund_movements(household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_role) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',1,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000171','role without link','reversal')$q$,'P0001',NULL,'correction link and role are paired');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000173','correct','{}','00000000-0000-4000-8000-000000000011','{}');
insert into finance.fund_movements(id,household_id,from_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role) values ('00000000-0000-4000-8000-000000000174','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'release',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000173','reverse','00000000-0000-4000-8000-000000000172','reversal');
select throws_ok($q$insert into finance.fund_movements(household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',9,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000173','wrong','00000000-0000-4000-8000-000000000172','reversal')$q$,'P0001',NULL,'reversal preserves amount and endpoints');
select throws_ok($q$insert into finance.fund_movements(household_id,from_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'release',current_date + 1,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000173','wrong date','00000000-0000-4000-8000-000000000172','reversal')$q$,'P0001','budget_invalid: reversal must exactly oppose its original movement','reversal preserves effective date');
select throws_ok($q$do $$begin
  insert into finance.fund_movements(household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role)
  values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000171','replacement wrong command','00000000-0000-4000-8000-000000000172','replacement');
  set constraints all immediate;
end$$$q$,'P0001','budget_incomplete: replacement requires a reversal in the same command','replacement requires same-command reversal');
insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role) values ('00000000-0000-4000-8000-000000000175','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000173','replacement','00000000-0000-4000-8000-000000000172','replacement');
select lives_ok($q$set constraints all immediate$q$,'replacement shares its reversal command');
set constraints all deferred;
select throws_ok($q$insert into finance.fund_movements(household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'assign',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000173','duplicate replacement','00000000-0000-4000-8000-000000000172','replacement')$q$,'23505',NULL,'only one replacement per original');
select throws_ok($q$do $$begin
  insert into finance.fund_movements(household_id,from_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason,correction_of,correction_role)
  values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031',10,'release',current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000173','reversal correction','00000000-0000-4000-8000-000000000174','reversal');
end$$$q$,'P0001','budget_invalid: correction must reference an original movement','correction cannot target a reversal');
select throws_ok($q$update finance.fund_movements set reason='x' where id='00000000-0000-4000-8000-000000000172'$q$,'P0001',NULL,'movement immutable');
select lives_ok($q$insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,actor_id,utility_device_id) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000041','shared',true,'liquid',24,'unknown','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000099')$q$,'owned utility device association is allowed');
select lives_ok($q$insert into finance.fund_earmarks(household_id,fund_id,restricted_account_id,amount_cents,effective_on,actor_id,command_id,reason,fund_movement_id) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000041',1,current_date,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000171','stage4 earmark','00000000-0000-4000-8000-000000000172')$q$,'stage4 earmark claim is writable');

insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,notes) values ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001',now(),'00000000-0000-4000-8000-000000000011','incomplete','{}','seed');
select throws_ok($q$update finance.budget_commands set kind='changed' where command_id='00000000-0000-4000-8000-000000000171'$q$,'P0001',NULL,'receipts immutable on update');
select throws_ok($q$delete from finance.budget_commands where command_id='00000000-0000-4000-8000-000000000171'$q$,'P0001',NULL,'receipts immutable on delete');
select throws_ok($q$update finance.budget_reconciliations set notes='changed' where id='00000000-0000-4000-8000-000000000201'$q$,'P0001',NULL,'reconciliations immutable on update');
select throws_ok($q$delete from finance.budget_reconciliations where id='00000000-0000-4000-8000-000000000201'$q$,'P0001',NULL,'reconciliations immutable on delete');

set constraints all immediate;
select * from finish();
rollback;
