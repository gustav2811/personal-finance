begin;
select plan(53);

insert into finance.households(id) values
 ('00000000-0000-4000-8000-00000000c001'), ('00000000-0000-4000-8000-00000000c002');
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
 ('00000000-0000-4000-8000-00000000c011','00000000-0000-4000-8000-00000000c001','command-a@test.invalid','00000000-0000-4000-8000-00000000c021','member'),
 ('00000000-0000-4000-8000-00000000c012','00000000-0000-4000-8000-00000000c002','command-b@test.invalid','00000000-0000-4000-8000-00000000c022','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values
 ('00000000-0000-4000-8000-00000000c031','command-a','A account','00000000-0000-4000-8000-00000000c001','test','ZAR'),
 ('00000000-0000-4000-8000-00000000c032','command-b','B account','00000000-0000-4000-8000-00000000c002','test','ZAR');
insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at) values
 ('00000000-0000-4000-8000-00000000c031',date '2026-01-02',100.00,'EUR','00000000-0000-4000-8000-00000000c001','test','2026-01-02T01:02:03Z');

select ok(not has_function_privilege('anon','public.budget_create_fund_v1(uuid,jsonb)'::regprocedure,'execute'),'anon cannot execute fund command');
select ok(not has_function_privilege('service_role','public.budget_create_fund_v1(uuid,jsonb)'::regprocedure,'execute'),'service role cannot execute fund command');
select ok(not has_function_privilege('authenticated','finance.budget_begin_command(uuid,text,jsonb)'::regprocedure,'execute'),'authenticated cannot execute private receipt helper');

do $grant_matrix$
declare f regprocedure;
begin
  foreach f in array array[
    'public.budget_create_fund_v1(uuid,jsonb)'::regprocedure,
    'public.budget_update_fund_v1(uuid,jsonb)'::regprocedure,
    'public.budget_save_draft_v1(uuid,jsonb)'::regprocedure,
    'public.budget_publish_v1(uuid,jsonb)'::regprocedure,
    'public.budget_configure_account_v1(uuid,jsonb)'::regprocedure,
    'public.budget_record_reconciliation_v1(uuid,jsonb)'::regprocedure
  ] loop
    raise notice '%', ok(not has_function_privilege('anon',f,'execute'),f::text||' denies anon');
    raise notice '%', ok(not has_function_privilege('service_role',f,'execute'),f::text||' denies service role');
    raise notice '%', ok(has_function_privilege('authenticated',f,'execute'),f::text||' grants authenticated');
  end loop;
end
$grant_matrix$;

do $test$
declare r jsonb; replay jsonb; conflict boolean:=false; stale boolean:=false; denied boolean:=false; fp text; settings jsonb; original_settings jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000c021','role','authenticated','email','command-a@test.invalid','email_verified',true,'app_metadata',jsonb_build_object('provider','google'))::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c021',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  select public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c101',jsonb_build_object('name','  Holiday  ','beneficiary_scope','shared')) into r;
  select public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c101',jsonb_build_object('beneficiary_scope','shared','name','Holiday','beneficiary_member_id',null)) into replay;
  raise notice '%', is(r,replay,'omitted and null optional fund fields replay canonically');
  raise notice '%', is((select count(*) from finance.funds where household_id='00000000-0000-4000-8000-00000000c001'),1::bigint,'fund command writes once');
  conflict:=false;
  begin perform public.budget_update_fund_v1('00000000-0000-4000-8000-00000000c101',jsonb_build_object('fund_id',r->>'fund_id','expected_name','Holiday','expected_status','active','name','Holiday','status','active')); exception when sqlstate 'P0001' then conflict:=sqlstate='P0001' and sqlerrm like 'budget_conflict:%'; end;
  raise notice '%', ok(conflict,'same command id with another kind conflicts');
  conflict:=false;
  begin perform public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c101',jsonb_build_object('name','Different','beneficiary_scope','shared')); exception when sqlstate 'P0001' then conflict:=sqlstate='P0001' and sqlerrm like 'budget_conflict:%'; end;
  raise notice '%', ok(conflict,'same command id with changed payload conflicts');
  select public.budget_update_fund_v1('00000000-0000-4000-8000-00000000c102',jsonb_build_object('fund_id',r->>'fund_id','expected_name','Holiday','expected_status','active','name','Trip','status','active')) into replay;
  raise notice '%', is(replay->>'name','Trip','fund update returns changed name');
  stale:=false;
  begin perform public.budget_update_fund_v1('00000000-0000-4000-8000-00000000c103',jsonb_build_object('fund_id',r->>'fund_id','expected_name','Holiday','expected_status','active','name','Nope','status','active')); exception when sqlstate 'P0001' then stale:=sqlstate='P0001' and sqlerrm like 'budget_stale:%'; end;
  raise notice '%', ok(stale,'stale fund update rejects after replay lookup');
  select public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c104',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c031','owner_scope','shared','included',true,'resource_class','liquid','freshness_hours',24,'transaction_sign_convention','unknown')) into settings;
  original_settings:=settings;
  fp:=settings->>'settings_fingerprint';
  raise notice '%', ok(fp is not null,'account settings returns operational fingerprint');
  raise notice '%', is(settings->'before','null'::jsonb,'new account configuration records null before fact');
  raise notice '%', is(settings->>'account_id','00000000-0000-4000-8000-00000000c031','settings result identifies configured account');
  stale:=false;
  begin perform public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c105',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c031','expected_settings_fingerprint','wrong','owner_scope','shared','included',true,'resource_class','liquid','freshness_hours',24,'transaction_sign_convention','unknown')); exception when sqlstate 'P0001' then stale:=sqlstate='P0001' and sqlerrm like 'budget_stale:%'; end;
  raise notice '%', ok(stale,'stale settings fingerprint rejects');
  denied:=false;
  begin perform public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c106',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c032','owner_scope','shared','included',true,'resource_class','liquid','freshness_hours',24,'transaction_sign_convention','unknown')); exception when sqlstate 'P0001' then denied:=sqlstate='P0001' and sqlerrm like 'budget_not_found:%'; end;
  raise notice '%', ok(denied,'cross-household account is not configurable');
  denied:=false;
  begin perform public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c107',jsonb_build_object('name','Bad','beneficiary_scope','shared','extra',true)); exception when sqlstate 'P0001' then denied:=sqlstate='P0001' and sqlerrm like 'budget_invalid:%'; end;
  raise notice '%', ok(denied,'unknown payload key is invalid');
  denied:=false;
  begin perform public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c108',jsonb_build_object('name','Bad money','beneficiary_scope','shared','beneficiary_member_id',5)); exception when sqlstate 'P0001' then denied:=sqlstate='P0001' and sqlerrm like 'budget_invalid:%'; end;
  raise notice '%', ok(denied,'scalar helper rejects wrong JSON type');
  select public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c110',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c031','expected_settings_fingerprint',fp,'owner_scope','shared','included',true,'resource_class','liquid','freshness_hours',48,'transaction_sign_convention','unknown')) into settings;
  raise notice '%', is(settings->'before',original_settings->'after','settings edit records previous operational facts');
  raise notice '%', is(settings->'after'->>'freshness_hours','48','settings edit records next operational facts');
  select public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c104',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c031','owner_scope','shared','included',true,'resource_class','liquid','freshness_hours',24,'transaction_sign_convention','unknown')) into replay;
  raise notice '%', is(replay,original_settings,'config replay returns original receipt after later edit');
  denied:=false;
  begin perform public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c111',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c031','expected_settings_fingerprint',settings->>'settings_fingerprint','owner_scope','member','owner_member_id','00000000-0000-4000-8000-00000000c012','included',true,'resource_class','liquid','freshness_hours',48,'transaction_sign_convention','unknown')); exception when sqlstate 'P0001' then denied:=sqlstate='P0001' and sqlerrm like 'budget_not_found:%'; end;
  raise notice '%', ok(denied,'foreign owner member is rejected');
  denied:=false;
  begin perform public.budget_configure_account_v1('00000000-0000-4000-8000-00000000c112',jsonb_build_object('account_id','00000000-0000-4000-8000-00000000c031','expected_settings_fingerprint',settings->>'settings_fingerprint','owner_scope','shared','settlement_account_id','00000000-0000-4000-8000-00000000c032','included',true,'resource_class','liquid','freshness_hours',48,'transaction_sign_convention','unknown')); exception when sqlstate 'P0001' then denied:=sqlstate='P0001' and sqlerrm like 'budget_not_found:%'; end;
  raise notice '%', ok(denied,'foreign settlement account is rejected');
  execute 'reset role';
  raise notice '%', is(finance.budget_cents(jsonb_build_object('amount','-00012'),'amount')::text,'-12','cent strings normalize through bigint');
  raise notice '%', is(finance.budget_integer(jsonb_build_object('revision',9007199254740991),'revision',0,9007199254740991)::text,'9007199254740991','safe JSON integer token accepted');
end
$test$;

select is(finance.budget_boolean(jsonb_build_object('value',false),'value'),false,'JSON false remains a boolean');
select is(finance.budget_date(jsonb_build_object('value','2026-02-28'),'value'),date '2026-02-28','strict valid date is accepted');
select is(finance.budget_timestamp(jsonb_build_object('value','2026-01-02T01:02:03+02:00'),'value'),timestamptz '2026-01-01 23:02:03+00','offset timestamp normalizes to UTC');
select is(finance.budget_snapshot_snapshot('00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000c031',date '2026-01-02')->>'amount_cents','100','integral numeric source cents normalize');
select is(finance.budget_snapshot_snapshot('00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000c031',date '2026-01-02')->>'currency_code','EUR','snapshot freezes source currency');
select is(finance.budget_snapshot_snapshot('00000000-0000-4000-8000-00000000c001','00000000-0000-4000-8000-00000000c031',date '2026-01-02')->>'account_currency_code','ZAR','snapshot retains account currency separately');

do $anonymous$
declare denied boolean:=false;
begin
  execute 'set local role anon';
  begin perform public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c109',jsonb_build_object('name','No','beneficiary_scope','shared')); exception when insufficient_privilege then denied:=true; end;
  execute 'reset role';
  raise notice '%', ok(denied,'anon invocation is denied by execute grant');
end
$anonymous$;

do $direct_private$
declare denied boolean := false;
begin
  execute 'set local role authenticated';
  begin
    perform finance.budget_begin_command('00000000-0000-4000-8000-00000000c120','private','{}'::jsonb);
  exception when insufficient_privilege then
    denied := sqlstate = '42501';
  end;
  execute 'reset role';
  raise notice '%', ok(denied,'direct private helper invocation raises 42501');
end
$direct_private$;

do $outsider_and_role$
declare denied boolean := false;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000c099','role','authenticated','email','unbound@test.invalid','email_verified',true,'app_metadata',jsonb_build_object('provider','google'))::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000c099',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  begin
    perform public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c121',jsonb_build_object('name','Outsider','beneficiary_scope','shared'));
  exception when sqlstate 'P0001' then
    denied := sqlstate='P0001' and sqlerrm like 'budget_forbidden:%';
  end;
  raise notice '%', ok(denied,'unbound authenticated caller is forbidden');
  execute 'reset role';
  raise notice '%', is((select count(*) from finance.funds where household_id='00000000-0000-4000-8000-00000000c001'),1::bigint,'outsider cannot write a fund');
  raise notice '%', is((select count(*) from finance.budget_commands where household_id='00000000-0000-4000-8000-00000000c001'),4::bigint,'outsider cannot create a receipt');
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000c021','role','service_role','email','command-a@test.invalid','email_verified',true,'app_metadata',jsonb_build_object('provider','google'))::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin
    perform public.budget_create_fund_v1('00000000-0000-4000-8000-00000000c122',jsonb_build_object('name','Forged role','beneficiary_scope','shared'));
  exception when sqlstate 'P0001' then
    denied:=sqlstate='P0001' and sqlerrm like 'budget_forbidden:%';
  end;
  execute 'reset role';
  raise notice '%', ok(denied,'service role JWT is forbidden even under authenticated SQL role');
end
$outsider_and_role$;

select * from finish();
rollback;
