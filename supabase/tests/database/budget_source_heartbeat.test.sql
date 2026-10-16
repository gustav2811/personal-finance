begin;
select plan(3);
insert into finance.households(id) values ('00000000-0000-4000-8000-00000000f101');
insert into finance.household_members(id,household_id,email,role)
values ('00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f101','heartbeat@test.invalid','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
values ('00000000-0000-4000-8000-00000000f103','heartbeat-cash','Cash','00000000-0000-4000-8000-00000000f101','test','ZAR');
insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
values ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f103','shared',true,'liquid',48,'outflow_negative','fixture','00000000-0000-4000-8000-00000000f102');
insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,source_last_seen_at)
values ('heartbeat-source','00000000-0000-4000-8000-00000000f103','2026-10-16','2026-10-16','{}','00000000-0000-4000-8000-00000000f101','test',false,false,-100,'ZAR','heartbeat-v1','2026-10-16T07:00:00Z');
create temporary table heartbeat_before as select finance.budget_source_snapshot('00000000-0000-4000-8000-00000000f101','heartbeat-source') snapshot;
update public.transactions set source_last_seen_at='2026-10-16T07:15:00Z' where id='heartbeat-source';
select is(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000f101','heartbeat-source')->>'source_fingerprint',(select snapshot->>'source_fingerprint' from heartbeat_before),'sync heartbeat does not invalidate reviewed economics');
select isnt(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000f101','heartbeat-source')->>'source_last_seen_at',(select snapshot->>'source_last_seen_at' from heartbeat_before),'snapshot retains latest observation for audit');
update public.transactions set amount=-101 where id='heartbeat-source';
select isnt(finance.budget_source_snapshot('00000000-0000-4000-8000-00000000f101','heartbeat-source')->>'source_fingerprint',(select snapshot->>'source_fingerprint' from heartbeat_before),'amount change still invalidates reviewed economics');
select * from finish();
rollback;
