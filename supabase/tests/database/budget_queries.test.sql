begin;
select plan(32);

select ok(has_function_privilege('authenticated','public.budget_list_versions_v1(text,integer)'::regprocedure,'execute'),'member can list versions');
select ok(not has_function_privilege('anon','public.budget_list_versions_v1(text,integer)'::regprocedure,'execute'),'anon cannot list versions');
select ok(not has_function_privilege('service_role','public.budget_get_liquidity_v1(timestamptz,integer)'::regprocedure,'execute'),'service role cannot read liquidity');
select ok(has_function_privilege('authenticated','public.budget_get_actuals_v1(jsonb,text,integer)'::regprocedure,'execute'),'member can read actuals');

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000e501');
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
 ('00000000-0000-4000-8000-00000000e502','00000000-0000-4000-8000-00000000e501','query@test.invalid','00000000-0000-4000-8000-00000000e503','member');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values
 ('00000000-0000-4000-8000-00000000e504','00000000-0000-4000-8000-00000000e501','Queries','shared','00000000-0000-4000-8000-00000000e502');
insert into finance.budget_versions(id,household_id,state,starts_on_cycle,actor_id,reason,income_assumptions,source_references) values
 ('00000000-0000-4000-8000-00000000e505','00000000-0000-4000-8000-00000000e501','draft','2026-10-23','00000000-0000-4000-8000-00000000e502','draft', '[{"expected_net_cents":"100000"}]','[{"source":"fixture"}]');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,category_name_snapshot,group_name_snapshot,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy,expected_payment_on) values
 ('00000000-0000-4000-8000-00000000e506','00000000-0000-4000-8000-00000000e501','00000000-0000-4000-8000-00000000e505','00000000-0000-4000-8000-00000000e507','00000000-0000-4000-8000-00000000e504','Queries','Food','consumption','shared','consumption',1200,'cycle_allowance','cycle','carry','2026-10-30');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values
 ('00000000-0000-4000-8000-00000000e508','query-source','Query source','00000000-0000-4000-8000-00000000e501','test','ZAR');
insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values
 ('query-stage5-source','00000000-0000-4000-8000-00000000e508',statement_timestamp(),date '2026-10-05','{}','00000000-0000-4000-8000-00000000e501','test',false,false,-1000,'ZAR','query-stage5');
insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id)
 values ('00000000-0000-4000-8000-00000000e50a','00000000-0000-4000-8000-00000000e501','query-stage5-source','{}','query-drift',-1000,date '2026-10-05',1,'current','00000000-0000-4000-8000-00000000e502','00000000-0000-4000-8000-00000000e509');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,paid_by_member_id,effect_kind)
 values ('00000000-0000-4000-8000-00000000e50b','00000000-0000-4000-8000-00000000e501','00000000-0000-4000-8000-00000000e50a',0,-1000,'00000000-0000-4000-8000-00000000e504','shared','00000000-0000-4000-8000-00000000e502','consumption');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind)
 values ('00000000-0000-4000-8000-00000000e50c','00000000-0000-4000-8000-00000000e501','00000000-0000-4000-8000-00000000e50a',1,0,null,'shared','unresolved');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values
 ('00000000-0000-4000-8000-00000000e501','00000000-0000-4000-8000-00000000e509','fixture','{}','00000000-0000-4000-8000-00000000e502','{}');
update finance.budget_allocation_sets set status='needs_review' where id='00000000-0000-4000-8000-00000000e50a';
update public.transactions set raw_payload_hash='query-stage5-drift' where id='query-stage5-source';

do $member$
declare r jsonb; c text; e text;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000e503','role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e503',true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 r:=public.budget_list_versions_v1(null,50);
 raise notice '%',is(r->>'household_id','00000000-0000-4000-8000-00000000e501','versions resolve member household');
 raise notice '%',is(jsonb_array_length(r->'versions'),1,'draft version is visible');
 raise notice '%',is((r->'versions'->0->>'version_number'),null,'draft has nullable version number');
 r:=public.budget_get_version_v1('00000000-0000-4000-8000-00000000e505');
 raise notice '%',is(r->'version'->'lines'->0->>'contribution_cents','1200','version line money is decimal string');
 raise notice '%',is(r->'version'->'lines'->0->>'group_name_snapshot','consumption','line snapshots preserve labels');
 r:=public.budget_get_actuals_v1(jsonb_build_object('from','2026-10-23','to','2026-11-23'),null,50);
 raise notice '%',is(r->>'calculation_version','household-budget-v1','actuals calculation version');
 raise notice '%',is(r->>'complete','false','actuals availability reflects missing resources');
 raise notice '%',is(jsonb_typeof(r->'household_totals'),'object','actuals household totals are separate');
 r:=public.budget_get_actuals_v1(jsonb_build_object('from','2026-10-01','to','2026-10-20','paid_by_member_id','00000000-0000-4000-8000-00000000e502'),null,50);
 raise notice '%',ok((r->'filtered_totals'->'by_actual_payer' ? '00000000-0000-4000-8000-00000000e502') and (r->'household_totals'->'by_actual_payer' ? '00000000-0000-4000-8000-00000000e502'),'payer filter and household payer axes are explicit');
 r:=public.budget_get_actuals_v1(jsonb_build_object('from','2026-10-01','to','2026-10-20'),null,1); c:=r->>'next_cursor';
 raise notice '%',ok(c is not null,'actuals first page emits keyset cursor');
 r:=public.budget_get_actuals_v1(jsonb_build_object('from','2026-10-01','to','2026-10-20'),c,1);
 raise notice '%',ok(jsonb_array_length(r->'entries')=1,'actuals second page accepts exact cursor');
 r:=public.budget_get_actuals_v1(jsonb_build_object('from','2026-10-01','to','2026-10-20'),null,50);
 raise notice '%',ok((r->>'complete')='false' and exists(select 1 from jsonb_array_elements(r->'reasons') reason where reason->>'code'='source_fingerprint_drift'),'live source drift is surfaced independently of page');
 r:=public.budget_get_review_queue_v1(null,50);
 raise notice '%',is(jsonb_typeof(r->'entries'),'array','review queue entries array');
 raise notice '%',ok(exists(select 1 from jsonb_array_elements(r->'entries') entry where entry->>'kind'='allocation' and entry->>'source_transaction_id'='query-stage5-source'),'needs-review queue returns source identity');
 r:=public.budget_get_liquidity_v1(statement_timestamp()-interval '1 minute',45);
 raise notice '%',is(r->>'horizon_days','45','liquidity horizon is bounded');
 raise notice '%',is((r->'forecast'->>'horizon_days')::integer,45,'liquidity forecast is bounded object');
 begin perform public.budget_get_actuals_v1(jsonb_build_object('from','2026-10-23','to','2026-11-23','unknown',1),null,50); exception when sqlstate 'P0001' then e:=sqlerrm; end;
 raise notice '%',ok(e='budget_invalid: invalid actuals filters','unknown filters are rejected');
 begin perform public.budget_list_versions_v1(null,0); exception when sqlstate 'P0001' then e:=sqlerrm; end;
 raise notice '%',ok(e='budget_invalid: invalid limit','list limits are bounded');
 begin perform public.budget_get_liquidity_v1(now()+interval '1 minute',45); exception when sqlstate 'P0001' then e:=sqlerrm; end;
 raise notice '%',ok(e='budget_invalid: invalid liquidity bounds','future liquidity is rejected');
 r:=public.budget_list_versions_v1(null,1); c:=r->>'next_cursor';
 if c is not null then begin perform public.budget_list_versions_v1(c,1); exception when sqlstate 'P0001' then e:=sqlerrm; end; end if;
 raise notice '%',ok(c is null or e is null,'cursor is opaque and stable');
 begin perform public.budget_list_versions_v1('bad',50); exception when sqlstate 'P0001' then e:=sqlerrm; end;
 raise notice '%',ok(e='budget_invalid: invalid cursor','malformed cursor is rejected');
 execute 'reset role';
end $member$;

select throws_ok($q$select public.budget_get_version_v1('00000000-0000-4000-8000-00000000e5ff')$q$,'P0001','budget_not_found: version','unknown version is not disclosed');
select ok(not has_function_privilege('anon','public.budget_get_version_v1(uuid)'::regprocedure,'execute'),'anon cannot get version');
select ok(not has_function_privilege('service_role','public.budget_get_actuals_v1(jsonb,text,integer)'::regprocedure,'execute'),'service role cannot get actuals');
select ok(has_function_privilege('authenticated','public.budget_get_review_queue_v1(text,integer)'::regprocedure,'execute'),'member can get review queue');
select ok(has_function_privilege('authenticated','public.budget_get_liquidity_v1(timestamptz,integer)'::regprocedure,'execute'),'member can get liquidity');
select ok(has_function_privilege('authenticated','public.budget_get_version_v1(uuid)'::regprocedure,'execute'),'member can get version');
select throws_ok($q$select finance.budget_checked_bigint(9223372036854775808::numeric)$q$,'P0001','budget_invalid: numeric result is outside bigint','overflow remains invalid');
select * from finish();
rollback;
