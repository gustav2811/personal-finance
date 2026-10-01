begin;
select plan(24);

select is(finance.budget_checked_bigint(12.0)::text,'12','integral numeric is checked');
select throws_ok($q$select finance.budget_checked_bigint(1.5)$q$,
  'P0001','budget_invalid: numeric result is outside bigint','fraction rejects');
select throws_ok($q$select finance.budget_checked_bigint(9223372036854775808::numeric)$q$,
  'P0001','budget_invalid: numeric result is outside bigint','overflow rejects');
select is(finance.budget_cycle_start(date '2026-10-23'),date '2026-10-23','23rd starts cycle');
select is(finance.budget_cycle_start(date '2026-10-22'),date '2026-09-23','prior month starts cycle');

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000f101') on conflict do nothing;
insert into finance.household_members(id,household_id,email,auth_user_id,role)
values ('00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f101',
  'f@test.invalid','00000000-0000-4000-8000-00000000f103','member') on conflict do nothing;
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by)
values ('00000000-0000-4000-8000-00000000f104','00000000-0000-4000-8000-00000000f101',
  'F fund','shared','00000000-0000-4000-8000-00000000f102') on conflict do nothing;

select ok(not has_function_privilege('anon',
  'public.budget_get_overview_v1(date,timestamptz)'::regprocedure,'execute'),
  'anon cannot execute overview read');
select ok(not has_function_privilege('service_role',
  'public.budget_get_fund_v1(uuid,date,date,text,integer)'::regprocedure,'execute'),
  'service role cannot execute member fund read');
select ok(has_function_privilege('authenticated',
  'public.budget_get_overview_v1(date,timestamptz)'::regprocedure,'execute'),
  'authenticated can execute overview read');
select throws_ok($q$select public.budget_get_overview_v1(null,now())$q$,
  'P0001','budget_invalid: cycle_start must be day 23','null cycle is rejected');
select throws_ok($q$select public.budget_get_overview_v1('2026-10-23',null)$q$,
  'P0001','budget_invalid: as_of must be finite and not in the future','null as_of is rejected');

do $member$
declare r jsonb; denied boolean := false;
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000f103','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000f103',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-10-23',now());
  raise notice '%', is(r->>'calculation_version','household-budget-v1','overview version');
  raise notice '%', is(r->>'household_id','00000000-0000-4000-8000-00000000f101','overview household');
  raise notice '%', is((r->>'complete')::boolean,false,'missing resources/cutover is incomplete');
  r := public.budget_get_fund_v1('00000000-0000-4000-8000-00000000f104',
    date '2026-10-01',date '2026-11-01',null,50);
  raise notice '%', is(jsonb_array_length(r->'entries'),0,'empty fund has no entries');
  raise notice '%', is(r->>'next_cursor',null,'empty fund has no cursor');
  begin
    perform public.budget_get_fund_v1('00000000-0000-4000-8000-00000000f104',
      date '2026-10-01',date '2026-11-01','bad',50);
  exception when sqlstate 'P0001' then denied := sqlerrm = 'budget_invalid: invalid cursor';
  end;
  raise notice '%', ok(denied,'malformed cursor has exact invalid prefix');
  execute 'reset role';
end $member$;

select throws_ok($q$select public.budget_get_fund_v1(
  '00000000-0000-4000-8000-00000000f104','2026-10-01','2026-11-01',null,0)$q$,
  'P0001','budget_invalid: invalid fund date range or limit','invalid fund limit rejected');

-- Privileged journal fixture for movement/allocation fan-out, correction history,
-- retired funds, pre-cutover suppression, and stable pagination.
insert into finance.funds(id,household_id,name,beneficiary_scope,status,created_by) values
 ('00000000-0000-4000-8000-00000000f105','00000000-0000-4000-8000-00000000f101','Retired','shared','retired','00000000-0000-4000-8000-00000000f102'),
 ('00000000-0000-4000-8000-00000000f106','00000000-0000-4000-8000-00000000f101','Other','shared','active','00000000-0000-4000-8000-00000000f102');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
values ('00000000-0000-4000-8000-00000000f115','f-account','F account','00000000-0000-4000-8000-00000000f101','test','ZAR');
insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
  source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
values ('budget-f-entry','00000000-0000-4000-8000-00000000f115',now(),date '2026-10-02','{}',
  '00000000-0000-4000-8000-00000000f101','test',false,false,-1200,'ZAR','fixture');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values
 ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f107','fixture','{}','00000000-0000-4000-8000-00000000f102','{}'),
 ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f108','fixture','{}','00000000-0000-4000-8000-00000000f102','{}'),
 ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f109','fixture','{}','00000000-0000-4000-8000-00000000f102','{}');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values
 ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f118','fixture','{}','00000000-0000-4000-8000-00000000f102','{}');
insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason)
values
 ('00000000-0000-4000-8000-00000000f110','00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f104',100000,'opening',date '2026-09-23','00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f107','opening'),
 ('00000000-0000-4000-8000-00000000f111','00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f104',50000,'assign',date '2026-10-01','00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f108','assign'),
 ('00000000-0000-4000-8000-00000000f112','00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f105',25000,'assign',date '2026-09-01','00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f109','historical');
insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason)
values ('00000000-0000-4000-8000-00000000f119','00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f106',20000,'opening',date '2026-09-23','00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f118','opening');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values
 ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f120','fixture','{}','00000000-0000-4000-8000-00000000f102','{}');
insert into finance.fund_movements(id,household_id,from_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason)
values ('00000000-0000-4000-8000-00000000f121','00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f106',5000,'release',date '2026-10-01','00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f120','release');
insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id)
values ('00000000-0000-4000-8000-00000000f113','00000000-0000-4000-8000-00000000f101','budget-f-entry','{}','fixture',-120000,date '2026-10-01',1,'current','00000000-0000-4000-8000-00000000f102','00000000-0000-4000-8000-00000000f116');
insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,effect_kind)
values ('00000000-0000-4000-8000-00000000f114','00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f113',0,-120000,'00000000-0000-4000-8000-00000000f104','shared','consumption');
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
values ('00000000-0000-4000-8000-00000000f101','00000000-0000-4000-8000-00000000f116','fixture','{}','00000000-0000-4000-8000-00000000f102','{}');
insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
values ('00000000-0000-4000-8000-00000000f117','00000000-0000-4000-8000-00000000f101',now(),
  '00000000-0000-4000-8000-00000000f102','complete',jsonb_build_object(
    'schema_version',1,'accounts',jsonb_build_array(),'utility_coverage',
    jsonb_build_object('status','not_required','evidence','fixture'),'evidence','fixture'),
    date '2026-09-23','fixture');

do $journal$
declare r jsonb; r_release jsonb; first_cursor text; second_cursor text; h uuid := '00000000-0000-4000-8000-00000000f101';
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000f103','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000f103',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_fund_v1('00000000-0000-4000-8000-00000000f104',date '2026-09-01',date '2026-11-01',null,1);
  raise notice '%', is((r->'balances'->>'balance_cents'),'30000','movement and allocation deltas do not fan out');
  raise notice '%', is((r->'balances'->>'assigned_cents'),'150000','assigned movement aggregate is stable');
  raise notice '%', is((r->'balances'->>'outflow_cents'),'120000','outflow is positive reporting total');
  raise notice '%', ok((r->'fund'->>'status')='active','fund detail retains fund facts');
  r_release := public.budget_get_fund_v1('00000000-0000-4000-8000-00000000f106',date '2026-09-01',date '2026-11-01',null,50);
  raise notice '%', is((r_release->'balances'->>'assigned_cents'),'15000','release reduces net movement assignment');
  first_cursor := r->>'next_cursor';
  r := public.budget_get_fund_v1('00000000-0000-4000-8000-00000000f104',date '2026-09-01',date '2026-11-01',first_cursor,1);
  raise notice '%', is(jsonb_array_length(r->'entries'),1,'keyset page advances');
  second_cursor := r->>'next_cursor';
  r := public.budget_get_fund_v1('00000000-0000-4000-8000-00000000f104',date '2026-09-01',date '2026-11-01',second_cursor,1);
  raise notice '%', is(jsonb_array_length(r->'entries'),1,'third entry remains reachable');
  execute 'reset role';
end $journal$;

select * from finish();
rollback;
