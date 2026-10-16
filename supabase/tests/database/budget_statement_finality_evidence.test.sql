begin;
select plan(15);

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000fa01'),('00000000-0000-4000-8000-00000000fa02');
insert into finance.household_members(id,household_id,email,role,auth_user_id)
values ('00000000-0000-4000-8000-00000000fa11','00000000-0000-4000-8000-00000000fa01','statement@test.invalid','member','00000000-0000-4000-8000-00000000fa12');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
values ('00000000-0000-4000-8000-00000000fa21','statement-zero','Statement Bank Zero','00000000-0000-4000-8000-00000000fa01','bank_zero','ZAR');
insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
values ('00000000-0000-4000-8000-00000000fa01','00000000-0000-4000-8000-00000000fa21','shared',true,'liquid',48,'outflow_negative','fixture','00000000-0000-4000-8000-00000000fa11');
insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
values ('statement-null','00000000-0000-4000-8000-00000000fa21','2026-10-01','2026-10-01','{}','00000000-0000-4000-8000-00000000fa01','bank_zero',null,false,-100,'ZAR','statement-null'),
       ('statement-true','00000000-0000-4000-8000-00000000fa21','2026-10-01','2026-10-01','{}','00000000-0000-4000-8000-00000000fa01','bank_zero',true,false,-200,'ZAR','statement-true');

select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null')->'pending','null'::jsonb,'raw null remains unknown without evidence');
select ok(not has_table_privilege('authenticated','finance.budget_statement_finality_confirmations','insert'),'members cannot insert finality evidence directly');
select ok(not has_table_privilege('service_role','finance.budget_statement_finality_confirmations','insert'),'service role cannot insert finality evidence directly');
select set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000fa12','role','authenticated','email','statement@test.invalid','email_verified',true)::text,true);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000fa12',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((public.budget_confirm_statement_posted_v1('00000000-0000-4000-8000-00000000fa31',jsonb_build_object('transaction_id','statement-null','evidence','September statement','evidence_type','user_statement'))->>'pending'),'false','audited member command confirms a statement-backed transaction');
select is(public.budget_confirm_statement_posted_v1('00000000-0000-4000-8000-00000000fa31',jsonb_build_object('transaction_id','statement-null','evidence','September statement','evidence_type','user_statement'))->>'transaction_id','statement-null','same command replays its finality result');
reset role;
select is((select count(*) from finance.budget_commands where household_id='00000000-0000-4000-8000-00000000fa01' and kind='budget_confirm_statement_posted_v1'),1::bigint,'confirmation has one audited command receipt');
select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null')->>'pending','false','exact statement facts resolve null to posted');
select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null')->'raw_pending','null'::jsonb,'raw provider null is retained for audit only after confirmation');
create temporary table statement_finality_before as select finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null') snapshot;
update public.transactions set source_is_pending=false where id='statement-null';
select isnt(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null')->>'source_fingerprint',(select snapshot->>'source_fingerprint' from statement_finality_before),'provider raw null to false invalidates statement-backed source evidence');
update public.transactions set source_is_pending=null where id='statement-null';
update public.transactions set amount=-101 where id='statement-null';
select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null')->'pending','null'::jsonb,'amount drift invalidates statement finality');
update public.transactions set amount=-100,occurred_on='2026-10-02' where id='statement-null';
select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-null')->'pending','null'::jsonb,'date drift invalidates statement finality');
update public.transactions set occurred_on='2026-10-01' where id='statement-null';
select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa01','statement-true')->>'pending','true','explicit provider pending is never overridden');
select throws_ok($$select finance.budget_source_snapshot('00000000-0000-4000-8000-00000000fa02','statement-null')$$,'P0001','budget_forbidden: source transaction','cross-household source access is denied');
select ok(not exists (
  select 1 from jsonb_array_elements(finance.budget_source_exposure_stage3(
    '00000000-0000-4000-8000-00000000fa01',
    finance.budget_source_state_snapshot('00000000-0000-4000-8000-00000000fa01',jsonb_build_object('accounts',jsonb_build_array(jsonb_build_object('account_id','00000000-0000-4000-8000-00000000fa21','status','included','activity_through','2026-10-02T12:00:00Z','snapshot_snapshot',jsonb_build_object('observed_at','2026-10-02T12:00:00Z'),'pending_included_ids','[]'::jsonb)))),'2026-10-02T12:00:00Z'::timestamptz)->'reasons'
  ) reason where reason->>'code'='source_unverified' and reason->>'transaction_id'='statement-null'
),'statement-backed effective posted state passes source exposure verification');
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.budget_get_review_queue_v1(null,50)->'items') item where item->>'source_transaction_id'='statement-null'),'statement-backed posted outflow appears in the normal paged review queue');
reset role;
select * from finish();
rollback;
