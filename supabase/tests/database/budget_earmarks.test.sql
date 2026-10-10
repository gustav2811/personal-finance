-- Stage 4 restricted-claim acceptance tests.
--
-- This suite deliberately uses private synthetic rows for the source state and
-- invokes every money-changing operation through the member-facing RPCs.
begin;
select plan(28);
set constraints all deferred;

do $fixture$
declare
  h uuid := '00000000-0000-4000-8000-00000000e401';
  outsider_h uuid := '00000000-0000-4000-8000-00000000e411';
  m uuid := '00000000-0000-4000-8000-00000000e402';
  outsider uuid := '00000000-0000-4000-8000-00000000e412';
  a_liquid uuid := '00000000-0000-4000-8000-00000000e403';
  a_restricted uuid := '00000000-0000-4000-8000-00000000e404';
  a_mortgage uuid := '00000000-0000-4000-8000-00000000e405';
  f_emergency uuid := '00000000-0000-4000-8000-00000000e406';
  f_car uuid := '00000000-0000-4000-8000-00000000e407';
  f_home uuid := '00000000-0000-4000-8000-00000000e408';
  f_negative uuid := '00000000-0000-4000-8000-00000000e409';
  f_mortgage_debt uuid := '00000000-0000-4000-8000-00000000e42a';
  v uuid := '00000000-0000-4000-8000-00000000e40a';
  r_incomplete uuid := '00000000-0000-4000-8000-00000000e40b';
  r_complete uuid := '00000000-0000-4000-8000-00000000e40c';
  c_open uuid := '00000000-0000-4000-8000-00000000e40d';
  c_alloc uuid := '00000000-0000-4000-8000-00000000e420';
  mortgage_set uuid := '00000000-0000-4000-8000-00000000e421';
  mortgage_alloc uuid := '00000000-0000-4000-8000-00000000e422';
  mortgage_category uuid := '00000000-0000-4000-8000-00000000e423';
  mortgage_fp text;
  checked_coverage jsonb;
  fp text;
  coverage jsonb;
begin
  insert into finance.households(id) values(h),(outsider_h);
  insert into finance.household_members(id,household_id,email,auth_user_id,role) values
    (m,h,'earmarks-member@test.invalid','00000000-0000-4000-8000-00000000e413','member'),
    (outsider,outsider_h,'earmarks-outsider@test.invalid','00000000-0000-4000-8000-00000000e414','member');
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values
    (a_liquid,'earmarks-liquid','Liquid',h,'test','ZAR'),
    (a_restricted,'earmarks-restricted','Notice reserve',h,'test','ZAR'),
    (a_mortgage,'earmarks-mortgage','Mortgage redraw',h,'test','ZAR');
  insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at) values
    (a_liquid,date '2026-10-01',10000000,'ZAR',h,'test','2026-10-01 10:00+00'),
    (a_restricted,date '2026-10-01',2000000,'ZAR',h,'test','2026-10-01 10:00+00'),
    (a_mortgage,date '2026-10-01',0,'ZAR',h,'test','2026-10-01 10:00+00');
  insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id) values
    (h,a_liquid,'shared',true,'liquid',720,'outflow_negative','fixture statement',m),
    (h,a_restricted,'shared',true,'restricted',720,'outflow_negative','verified notice statement',m),
    (h,a_mortgage,'shared',true,'mortgage',720,'outflow_negative','verified redraw letter',m);
  insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values
    (f_emergency,h,'Emergency','shared',m),(f_car,h,'Car reserve','shared',m),
    (f_home,h,'Home','shared',m),(f_negative,h,'Negative','shared',m),
    (f_mortgage_debt,h,'Mortgage debt recognition','shared',m);
  insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,version_number,published_at,reason)
    values(v,h,date '2026-09-23',m,'published',1,'2026-09-20 08:00+00','fixture');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
    values(h,c_open,'fixture','{}',m,'{}');
  insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,budget_version_id,reason)
    values('00000000-0000-4000-8000-00000000e40e',h,f_emergency,500000,'opening',date '2026-09-23',m,c_open,v,'fixture'),
      ('00000000-0000-4000-8000-00000000e40f',h,f_car,700000,'opening',date '2026-09-23',m,c_open,v,'fixture'),
      ('00000000-0000-4000-8000-00000000e410',h,f_home,700000,'opening',date '2026-09-23',m,c_open,v,'fixture'),
      ('00000000-0000-4000-8000-00000000e42b',h,f_mortgage_debt,650000,'opening',date '2026-09-23',m,c_open,v,'fixture');
  -- Immutable source fixture for the mortgage example: one R650,000
  -- extra-debt allocation, with the remaining R1,000,000 represented by
  -- restricted claims on existing funds (never by a second contribution).
  insert into finance.categories(id,household_id,name,slug)
    values(mortgage_category,h,'Mortgage extra debt','mortgage-extra-debt');
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
    values('earmark-mortgage-transfer',a_liquid,date '2026-10-01',date '2026-10-01','{}',h,'test',false,false,-16500,'ZAR','earmark-mortgage-transfer');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status)
    values('00000000-0000-4000-8000-00000000e424',h,'earmark-mortgage-transfer',mortgage_category,'user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,decision_source,status)
    values('00000000-0000-4000-8000-00000000e425',h,'earmark-mortgage-transfer',false,false,'user','confirmed');
  select finance.budget_source_snapshot(h,'earmark-mortgage-transfer')->>'source_fingerprint' into mortgage_fp;
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id)
    values(mortgage_set,h,'earmark-mortgage-transfer',finance.budget_source_snapshot(h,'earmark-mortgage-transfer'),mortgage_fp,-1650000,date '2026-10-01',1,'current',m,c_alloc);
  insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,beneficiary_scope,effect_kind)
    values(mortgage_alloc,h,mortgage_set,0,-650000,f_mortgage_debt,mortgage_category,'shared','extra_debt_payment'),
      ('00000000-0000-4000-8000-00000000e429',h,mortgage_set,1,-1000000,null,null,'shared','movement');
  -- The receipt is deliberately inserted last: allocation components must be
  -- appended before the command marks the allocation set complete.
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
    values(h,c_alloc,'fixture','{}',m,'{}');
  coverage := jsonb_build_object('schema_version',1,'evidence','verified fixture',
    'utility_coverage',jsonb_build_object('status','not_required','evidence','not in this suite'),
    'accounts',jsonb_build_array(
      jsonb_build_object('account_id',a_liquid::text,'status','included','settings_fingerprint',finance.budget_settings_fingerprint(h,a_liquid),'snapshot_date','2026-10-01','snapshot_fingerprint',finance.budget_snapshot_fingerprint(h,a_liquid,date '2026-10-01'),'balance_convention','cash_signed','activity_through','2026-10-01T10:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'),
      jsonb_build_object('account_id',a_restricted::text,'status','included','settings_fingerprint',finance.budget_settings_fingerprint(h,a_restricted),'snapshot_date','2026-10-01','snapshot_fingerprint',finance.budget_snapshot_fingerprint(h,a_restricted,date '2026-10-01'),'balance_convention','cash_signed','eligible_restricted_cents','2000000','restricted_evidence','verified notice statement','activity_through','2026-10-01T10:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'),
      jsonb_build_object('account_id',a_mortgage::text,'status','included','settings_fingerprint',finance.budget_settings_fingerprint(h,a_mortgage),'snapshot_date','2026-10-01','snapshot_fingerprint',finance.budget_snapshot_fingerprint(h,a_mortgage,date '2026-10-01'),'balance_convention','cash_signed','eligible_restricted_cents','1500000','restricted_evidence','verified redraw letter','activity_through','2026-10-01T10:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture')));
  checked_coverage := finance.budget_check_coverage(h,coverage,'2026-10-01 10:00+00')->'coverage_snapshot';
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
    values(r_incomplete,h,'2026-10-01 10:00+00',m,'incomplete',jsonb_set(coverage,'{accounts,1,eligible_restricted_cents}', 'null'::jsonb),date '2026-09-23','unverified fixture'),
      (r_complete,h,'2026-10-01 10:00+00',m,'complete',checked_coverage,date '2026-09-23','verified fixture');
  select (finance.budget_reconciliation_state(h,r_complete,'2026-10-01 10:00+00')->>'reconciliation_fingerprint') into fp;
  raise notice '%', ok(fp is not null,'fixture has a complete reconciliation fingerprint');
end $fixture$;

-- Privileges are part of the contract, not an implementation detail.
select ok(not has_function_privilege('anon','public.budget_change_earmark_v1(uuid,jsonb)'::regprocedure,'execute'),'anonymous cannot execute earmark RPC');
select ok(not has_function_privilege('service_role','public.budget_change_earmark_v1(uuid,jsonb)'::regprocedure,'execute'),'service role cannot execute earmark RPC');
select ok(not has_function_privilege('service_role','public.budget_move_funds_v1(uuid,jsonb)'::regprocedure,'execute'),'service role cannot execute movement RPC');
select ok(not has_function_privilege('service_role','public.budget_review_allocation_v1(uuid,jsonb)'::regprocedure,'execute'),'service role cannot execute allocation RPC');

do $acceptance$
declare
  h uuid := '00000000-0000-4000-8000-00000000e401';
  m_auth uuid := '00000000-0000-4000-8000-00000000e413';
  outsider_auth uuid := '00000000-0000-4000-8000-00000000e414';
  r uuid := '00000000-0000-4000-8000-00000000e40c';
  rid uuid := '00000000-0000-4000-8000-00000000e40b';
  fp text := finance.budget_reconciliation_state(h,r,'2026-10-01 10:00+00')->>'reconciliation_fingerprint';
  e jsonb;
  e2 jsonb;
  e3 jsonb;
  e4 jsonb;
  p jsonb;
  failed boolean;
  before_count bigint;
  after_count bigint;
  before_earmarks bigint;
  before_commands bigint;
  movement jsonb;
  movement_id uuid;
  restricted bigint;
  liquid bigint;
begin
  -- Positive claims are blocked until a complete reconciliation verifies the
  -- account, and per-account capacity is enforced independently of fund size.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',m_auth::text,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',m_auth::text,true); perform set_config('request.jwt.claim.role','authenticated',true); execute 'set local role authenticated';
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e415',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e404','amount_cents','100000','effective_on','2026-10-01','reason','blocked','expected_reconciliation_id',rid::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',rid::text)));
  exception when others then failed := sqlerrm like 'budget_%'; end;
  raise notice '%', ok(failed,'positive claim is blocked when reconciliation is incomplete');

  e := public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e416',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e404','amount_cents','100000','effective_on','2026-10-01','reason','emergency earmark','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',r::text)));
  raise notice '%', ok((e->>'earmark_id') is not null,'verified restricted claim succeeds');

  e3 := public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e426',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','333333','effective_on','2026-10-01','reason','mortgage recognition emergency claim','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('allocation_id','00000000-0000-4000-8000-00000000e422')));
  e4 := public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e427',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e407','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','333333','effective_on','2026-10-01','reason','mortgage recognition car claim','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('allocation_id','00000000-0000-4000-8000-00000000e422')));
  e2 := public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e428',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e408','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','333334','effective_on','2026-10-01','reason','mortgage recognition home claim','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('allocation_id','00000000-0000-4000-8000-00000000e422')));
  raise notice '%', ok((select abs(amount_cents) from finance.budget_allocations where id='00000000-0000-4000-8000-00000000e422')
    + (select coalesce(sum(abs(amount_cents)),0) from finance.fund_earmarks where household_id=h and allocation_id='00000000-0000-4000-8000-00000000e422') = 1650000
    and (select count(*) from finance.budget_allocations where household_id=h and effect_kind='contribution') = 0,
    'mortgage R1,650,000 is R650,000 extra debt plus R1,000,000 existing-fund claims with no second contribution');
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e417',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e404','amount_cents','2000001','effective_on','2026-10-01','reason','capacity breach','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',r::text)));
  exception when others then failed := sqlerrm like 'budget_%'; end;
  raise notice '%', ok(failed,'per-account verified eligibility is a hard ceiling');

  -- A mortgage transfer is represented by one extra-debt allocation and claims
  -- against existing funds; no contribution row is created.
  e2 := public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e418',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e407','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','349400','effective_on','2026-10-01','reason','car reserve purchase','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',r::text)));
  raise notice '%', ok((e2->>'earmark_id') is not null,'claim on verified mortgage account succeeds');
  execute 'reset role';
  select restricted_cents into restricted from finance.budget_fund_balances(h,date '2026-10-01') where fund_id='00000000-0000-4000-8000-00000000e407';
  raise notice '%', is(restricted,682733::bigint,'car fund reports mortgage reserve plus the separate R349400 car claim');
  select restricted_cents into restricted from finance.budget_fund_balances(h,date '2026-10-01') where fund_id='00000000-0000-4000-8000-00000000e406';
  raise notice '%', is(restricted,433333::bigint,'emergency fund reports its ordinary and mortgage restricted claims');
  select balance_cents-restricted_cents into liquid from finance.budget_fund_balances(h,date '2026-10-01') where fund_id='00000000-0000-4000-8000-00000000e406';
  raise notice '%', is(liquid,66667::bigint,'fund balance exposes liquid portion after ordinary and mortgage claims');
  execute 'set local role authenticated';

  -- Claims cannot exceed a fund's nonnegative balance, and negative funds do
  -- not become a source of restricted capacity.
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e419',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e409','restricted_account_id','00000000-0000-4000-8000-00000000e404','amount_cents','1','effective_on','2026-10-01','reason','negative fund','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',r::text)));
  exception when others then failed := sqlerrm like 'budget_%'; end;
  raise notice '%', ok(failed,'negative fund cannot carry a claim');

  -- Release is a liquidity reclassification. It changes neither income nor
  -- fund assignment; the same purchase is consumed exactly once.
  select count(*) into before_count from finance.fund_earmarks where household_id=h;
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e41a',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e407','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','-349400','effective_on','2026-10-01','reason','car reserve release','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',r::text)));
  exception when others then failed := true; end;
  raise notice '%', ok(not failed,'negative release of a claim is accepted as a liquidity release');
  select count(*) into after_count from finance.fund_earmarks where household_id=h;
  raise notice '%', is(after_count,before_count+1,'release appends one immutable claim row');
  raise notice '%', is((select count(*) from finance.budget_lines where household_id=h),0::bigint,'claim release does not create income or plan assignment');

  -- Movement earmarks are part of the same receipt. A rejected claim must not
  -- leave either the movement or its command receipt behind.
  select count(*) into before_count from finance.fund_movements where household_id=h;
  before_count := (select count(*) from finance.fund_movements where household_id=h);
  before_earmarks := (select count(*) from finance.fund_earmarks where household_id=h);
  before_commands := (select count(*) from finance.budget_commands where household_id=h);
  failed := false;
  begin
    movement := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000e41d',jsonb_build_object('kind','reallocate','from_fund_id','00000000-0000-4000-8000-00000000e406','to_fund_id','00000000-0000-4000-8000-00000000e408','amount_cents','10000','effective_on','2026-10-01','expected_version_id','00000000-0000-4000-8000-00000000e40a','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'reason','mortgage transfer','earmarks',jsonb_build_array(jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','10000','reason','mortgage reserve'))));
    movement_id := (movement->>'movement_id')::uuid;
  exception when others then failed := true; end;
  raise notice '%', ok(not failed,'movement creates a linked earmark atomically');
  raise notice '%', is((select count(*) from finance.fund_movements where household_id=h),before_count+1,'successful movement has one domain row');
  raise notice '%', ok(exists(select 1 from finance.fund_earmarks where household_id=h and fund_movement_id=movement_id),'successful movement has a linked claim');
  failed := false;
  before_count := (select count(*) from finance.fund_movements where household_id=h);
  before_earmarks := (select count(*) from finance.fund_earmarks where household_id=h);
  before_commands := (select count(*) from finance.budget_commands where household_id=h);
  begin
    perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000e41e',jsonb_build_object('kind','reallocate','from_fund_id','00000000-0000-4000-8000-00000000e406','to_fund_id','00000000-0000-4000-8000-00000000e408','amount_cents','10000','effective_on','2026-10-01','expected_version_id','00000000-0000-4000-8000-00000000e40a','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'reason','over-capacity','earmarks',jsonb_build_array(jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','999999999','reason','over capacity'))));
  exception when others then failed := true; end;
  raise notice '%', ok(failed and (select count(*) from finance.fund_movements where household_id=h)=before_count
    and (select count(*) from finance.fund_earmarks where household_id=h)=before_earmarks
    and (select count(*) from finance.budget_commands where household_id=h)=before_commands,
    'failed linked claim rolls back movement, earmark, and receipt');

  -- An earlier-effective claim is valid even when a later-effective claim is
  -- already known; capacity is evaluated at the claim's effective date.
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e42c',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e408','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','200000','effective_on','2026-09-30','reason','earlier effective reserve','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('reconciliation_id',r::text)));
  exception when others then failed := true; end;
  raise notice '%', ok(not failed,'earlier effective claim is not blocked by later claim capacity');

  -- Correction reverses the original linked claim and appends replacement
  -- claim lineage in the same command.
  before_earmarks := (select count(*) from finance.fund_earmarks where household_id=h);
  failed := false;
  begin
    perform public.budget_correct_movement_v1('00000000-0000-4000-8000-00000000e42d',jsonb_build_object('movement_id',movement_id::text,'expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'reason','correct earmarked movement','replacement',jsonb_build_object('kind','reallocate','from_fund_id','00000000-0000-4000-8000-00000000e406','to_fund_id','00000000-0000-4000-8000-00000000e408','amount_cents','9000','effective_on','2026-10-01','budget_version_id','00000000-0000-4000-8000-00000000e40a','earmarks',jsonb_build_array(jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e405','amount_cents','9000','reason','replacement mortgage reserve')))));
  exception when others then failed := true; end;
  raise notice '%', ok(not failed,'earmarked movement correction succeeds atomically');
  raise notice '%', ok((select count(*) from finance.fund_earmarks where household_id=h) = before_earmarks + 2
    and exists(select 1 from finance.fund_earmarks where household_id=h and correction_of is not null and amount_cents < 0)
    and exists(select 1 from finance.fund_earmarks where household_id=h and correction_of is not null and amount_cents > 0),
    'movement correction reverses and replaces linked claims exactly once');

  -- Cross-household links, outsider calls, anonymous calls and direct writes
  -- are all rejected.
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e41b',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000e406','restricted_account_id','00000000-0000-4000-8000-00000000e404','amount_cents','1','effective_on','2026-10-01','reason','cross household','expected_reconciliation_id',r::text,'expected_reconciliation_fingerprint',fp,'link',jsonb_build_object('fund_movement_id','00000000-0000-4000-8000-00000000e999')));
  exception when others then failed := sqlerrm like 'budget_%'; end;
  raise notice '%', ok(failed,'cross-household or unknown link fails');
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',outsider_auth::text,'role','authenticated')::text,true); perform set_config('request.jwt.claim.sub',outsider_auth::text,true); perform set_config('request.jwt.claim.role','authenticated',true); execute 'set local role authenticated';
  failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e41c',jsonb_build_object(
      'fund_id','00000000-0000-4000-8000-00000000e406',
      'restricted_account_id','00000000-0000-4000-8000-00000000e404',
      'amount_cents','1','effective_on','2026-10-01','reason','outsider target',
      'expected_reconciliation_id',r::text,
      'expected_reconciliation_fingerprint',fp,
      'link',jsonb_build_object('reconciliation_id',r::text)));
  exception when others then failed := sqlerrm like 'budget_%'; end;
  raise notice '%', ok(failed,'cross-household member earmark command is rejected');
  execute 'reset role'; execute 'set local role anon'; failed := false;
  begin
    perform public.budget_change_earmark_v1('00000000-0000-4000-8000-00000000e41f','{}'::jsonb);
  exception when others then failed := true; end;
  raise notice '%', ok(failed,'anonymous cannot call member earmark RPC');
  execute 'reset role'; execute 'set local role authenticated'; failed := false;
  begin
    insert into finance.fund_earmarks(household_id,fund_id,restricted_account_id,amount_cents,effective_on,actor_id,command_id,reason,reconciliation_id)
      values(h,'00000000-0000-4000-8000-00000000e406','00000000-0000-4000-8000-00000000e404',1,date '2026-10-01',m,'00000000-0000-4000-8000-00000000e999','direct write',r);
  exception when others then failed := true; end;
  raise notice '%', ok(failed,'authenticated direct claim write is denied');
end $acceptance$;

select * from finish();
rollback;
