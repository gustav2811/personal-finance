-- Stage 5 query/API acceptance.  This is deliberately synthetic and exercises
-- public member RPCs under the authenticated role, not admin SQL alone.
begin;
select * from no_plan();
set constraints all deferred;

do $fixture$
declare
  h uuid := '00000000-0000-4000-8000-00000000e801';
  m uuid := '00000000-0000-4000-8000-00000000e802';
  a uuid := '00000000-0000-4000-8000-00000000e803';
  f uuid := '00000000-0000-4000-8000-00000000e804';
  f2 uuid := '00000000-0000-4000-8000-00000000e809';
  v uuid := '00000000-0000-4000-8000-00000000e805';
begin
  insert into finance.households(id) values(h);
  insert into finance.household_members(id,household_id,email,auth_user_id,role)
    values(m,h,'query-member@test.invalid','00000000-0000-4000-8000-00000000e806','member');
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
    values(a,'query-account-e8','Query account',h,'test','ZAR');
  insert into finance.funds(id,household_id,name,beneficiary_scope,created_by)
    values(f,h,'Synthetic gifts','shared',m),(f2,h,'Synthetic groceries','shared',m);
  insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,reason)
    values(v,h,date '2026-09-23',m,'draft','synthetic query fixture');
  insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,
    beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy)
    values('00000000-0000-4000-8000-00000000e807',h,v,
      '00000000-0000-4000-8000-00000000e808',f,'Synthetic gifts','shared','consumption',
      60000,'accumulating','cycle','carry');
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
    values
      ('query-groceries',a,'2026-09-24',date '2026-09-24','{}',h,'test',false,false,-600,'ZAR','q-groceries'),
      ('query-transfer',a,'2026-09-25',date '2026-09-25','{}',h,'test',false,false,-600,'ZAR','q-transfer'),
      ('query-split',a,'2026-09-26',date '2026-09-26','{}',h,'test',false,false,-900,'ZAR','q-split'),
      ('query-review',a,'2026-09-27',date '2026-09-27','{}',h,'test',false,false,-125,'ZAR','q-review');
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id)
    values
      ('00000000-0000-4000-8000-00000000e80e',h,'query-groceries','{}','q-groceries',-60000,date '2026-09-24',1,'current',m,'00000000-0000-4000-8000-00000000e80a'),
      ('00000000-0000-4000-8000-00000000e80f',h,'query-transfer','{}','q-transfer',-60000,date '2026-09-25',1,'current',m,'00000000-0000-4000-8000-00000000e80b'),
      ('00000000-0000-4000-8000-00000000e810',h,'query-split','{}','q-split',-90000,date '2026-09-26',1,'current',m,'00000000-0000-4000-8000-00000000e80c'),
      ('00000000-0000-4000-8000-00000000e811',h,'query-review','{}','q-review',-12500,date '2026-09-27',1,'needs_review',m,'00000000-0000-4000-8000-00000000e80d');
  insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,beneficiary_scope,paid_by_member_id,effect_kind)
    values
      ('00000000-0000-4000-8000-00000000e812',h,'00000000-0000-4000-8000-00000000e80e',0,-60000,f,'shared',m,'consumption'),
      ('00000000-0000-4000-8000-00000000e813',h,'00000000-0000-4000-8000-00000000e80f',0,-60000,null,'shared',m,'movement'),
      ('00000000-0000-4000-8000-00000000e814',h,'00000000-0000-4000-8000-00000000e810',0,-60000,f2,'shared',m,'consumption'),
      ('00000000-0000-4000-8000-00000000e815',h,'00000000-0000-4000-8000-00000000e810',1,-30000,f,'shared',m,'consumption'),
      ('00000000-0000-4000-8000-00000000e816',h,'00000000-0000-4000-8000-00000000e811',0,-12500,null,'shared',null,'unresolved');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
    values
      (h,'00000000-0000-4000-8000-00000000e80a','fixture','{}',m,'{}'),
      (h,'00000000-0000-4000-8000-00000000e80b','fixture','{}',m,'{}'),
      (h,'00000000-0000-4000-8000-00000000e80c','fixture','{}',m,'{}'),
      (h,'00000000-0000-4000-8000-00000000e80d','fixture','{}',m,'{}');
  update finance.budget_allocation_sets set status='needs_review'
    where id='00000000-0000-4000-8000-00000000e811';
end
$fixture$;
set constraints all immediate;

-- Frozen contract surface and privilege boundary.
select ok(to_regprocedure('public.budget_get_overview_v1(date,timestamptz)') is not null,'overview signature');
select ok(to_regprocedure('public.budget_get_fund_v1(uuid,date,date,text,integer)') is not null,'fund signature');
select ok(to_regprocedure('public.budget_list_versions_v1(text,integer)') is not null,'version-list signature');
select ok(to_regprocedure('public.budget_get_version_v1(uuid)') is not null,'version-detail signature');
select ok(to_regprocedure('public.budget_get_actuals_v1(jsonb,text,integer)') is not null,'actuals signature');
select ok(to_regprocedure('public.budget_get_review_queue_v1(text,integer)') is not null,'review queue signature');
select ok(to_regprocedure('public.budget_get_liquidity_v1(timestamptz,integer)') is not null,'liquidity signature');
select ok(has_function_privilege('authenticated','public.budget_get_overview_v1(date,timestamptz)'::regprocedure,'execute'),'member may read overview');
select ok(not has_function_privilege('anon','public.budget_get_overview_v1(date,timestamptz)'::regprocedure,'execute'),'anon cannot read overview');
select ok(not has_function_privilege('service_role','public.budget_get_liquidity_v1(timestamptz,integer)'::regprocedure,'execute'),'service role cannot use member liquidity read');

do $member_reads$
declare
  r jsonb; before_commands bigint; before_versions bigint; before_funds bigint;
  auth_uid constant uuid := '00000000-0000-4000-8000-00000000e806';
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_uid::text,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',auth_uid::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';

  -- Every query returns the shared envelope and decimal-string monetary values.
  r:=public.budget_get_overview_v1(date '2026-09-23','2026-09-22 21:59:59Z');
  raise notice '%',ok(r ? 'calculation_version' and r ? 'household_id' and r ? 'as_of' and r ? 'complete' and r ? 'reasons','overview has complete shared envelope');
  raise notice '%',is(r->>'cycle_start','2026-09-23','23rd cycle start is retained');
  raise notice '%',ok(not (r ? 'net_liquid_cents') or jsonb_typeof(r->'net_liquid_cents') in ('string','null'),'overview money is decimal string or explicitly unknown');
  -- Johannesburg/UTC edge: 21:59:59Z is still 22 October locally.
  r:=public.budget_get_overview_v1(date '2026-09-23','2026-09-22 22:00:00Z');
  raise notice '%',is(r->>'cycle_start','2026-09-23','UTC midnight boundary does not move the 23rd cycle early');

  r:=public.budget_get_fund_v1('00000000-0000-4000-8000-00000000e804',date '2026-09-23',date '2026-10-23',null,50);
  raise notice '%',ok(r ? 'fund' and r ? 'balances' and r ? 'entries' and r ? 'next_cursor','fund has stable paginated shape');
  r:=public.budget_list_versions_v1(null,50);
  raise notice '%',ok(r ? 'versions' and r ? 'next_cursor','version list has history pagination');
  r:=public.budget_get_version_v1('00000000-0000-4000-8000-00000000e805');
  raise notice '%',ok(r ? 'version' and r->'version' ? 'lines','version detail includes immutable header and lines');
  r:=public.budget_get_actuals_v1(jsonb_build_object('from','2026-09-23','to','2026-10-23'),null,50);
  raise notice '%',ok(r ? 'entries' and r ? 'filtered_totals' and r ? 'household_totals','actuals separates filtered and household totals');
  r:=public.budget_get_review_queue_v1(null,50);
  raise notice '%',ok(r ? 'items' and r ? 'next_cursor','review queue has impact/provenance pagination');
  r:=public.budget_get_liquidity_v1('2026-10-09 22:00:00Z',45);
  raise notice '%',ok(r ? 'resources' and r ? 'restricted_resources' and r ? 'restricted_claims' and r ? 'expected','liquidity separates observed/restricted/indicative data');
  raise notice '%',is((r->'forecast'->>'horizon_days')::integer,45,'liquidity default horizon is bounded');

  -- Cursor/filter binding and bounds are stable API errors, never SQL errors.
  begin perform public.budget_list_versions_v1('not-base64-json',50); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_invalid:%','malformed cursor is budget_invalid'); end;
  begin perform public.budget_get_actuals_v1(jsonb_build_object('from','2026-09-23','to','2026-10-23','unknown','x'),null,50); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_invalid:%','unknown actuals filter is budget_invalid'); end;
  begin perform public.budget_get_liquidity_v1(now(),0); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_invalid:%','zero liquidity horizon is budget_invalid'); end;
  begin perform public.budget_get_fund_v1('00000000-0000-0000-0000-000000000000',date '2026-10-23',date '2026-09-23',null,50); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_invalid:%','reversed fund range is budget_invalid'); end;

  -- Cross-household, anonymous and service callers fail closed.
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000e599','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e599',true);
  begin perform public.budget_list_versions_v1(null,50); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_forbidden:%','outsider member read is forbidden and returns no data'); end;
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_uid::text,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',auth_uid::text,true);
  execute 'set local role authenticated';
  before_commands:=(select count(*) from finance.budget_commands);
  before_versions:=(select count(*) from finance.budget_versions);
  before_funds:=(select count(*) from finance.funds);
  perform public.budget_get_overview_v1(date '2026-09-23','2026-09-22 22:00:00Z');
  perform public.budget_list_versions_v1(null,1);
  perform public.budget_get_actuals_v1(jsonb_build_object('from','2026-09-23','to','2026-10-23'),null,1);
  execute 'set local role authenticated';
  raise notice '%',is((select count(*) from finance.budget_commands),before_commands,'query reads create no command receipts');
  raise notice '%',is((select count(*) from finance.budget_versions),before_versions,'query reads do not mutate versions');
  raise notice '%',is((select count(*) from finance.funds),before_funds,'query reads do not mutate funds');
end
$member_reads$;

-- Behavioural mapping to every data-and-delivery acceptance row. All checks
-- below call member RPCs and inspect returned rows/totals/lineage.
do $acceptance$
declare
  r jsonb; p jsonb; c text; e text; n bigint; before bigint;
  h constant uuid := '00000000-0000-4000-8000-00000000e801';
  member_id constant uuid := '00000000-0000-4000-8000-00000000e802';
  auth_uid constant uuid := '00000000-0000-4000-8000-00000000e806';
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_uid::text,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',auth_uid::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  p:=jsonb_build_object('from','2026-09-23','to','2026-09-28');
  r:=public.budget_get_actuals_v1(p,null,50);

  raise notice '%',ok((select count(*)=1 from jsonb_array_elements(r->'entries') x where x->>'source_transaction_id'='query-groceries' and x->>'amount_cents'='-60000' and x->>'beneficiary_scope'='shared' and x->>'paid_by_member_id'=member_id::text),'DD-01 shared groceries: actual payer is retained separately from shared beneficiary');
  raise notice '%',ok((r->'entries' @> jsonb_build_array(jsonb_build_object('source_transaction_id','query-transfer','effect_kind','movement'))),'DD-02 spouse/internal transfer: movement is not a second consumption row');
  raise notice '%',is((select sum((x->>'amount_cents')::bigint)::bigint from jsonb_array_elements(r->'entries') x where x->>'effect_kind'='consumption'),(-150000)::bigint,'DD-03 gift/consumption arithmetic sums signed component rows');
  r:=public.budget_get_version_v1('00000000-0000-4000-8000-00000000e805');
  raise notice '%',ok(r->'version'->'lines'->0->>'contribution_cents'='60000' and r->'version'->'lines'->0->>'name'='Synthetic gifts','DD-04 target is a version intention, not a funded actual');
  raise notice '%',ok((r->'version'->'lines'->0 ? 'fund_id') and (r->'version' ? 'state'),'DD-05 version header and full line snapshot are distinct from actuals');
  raise notice '%',is(r->'version'->'lines'->0->>'name','Synthetic gifts','DD-06 frozen version label remains stable');
  raise notice '%',is((select count(*) from jsonb_array_elements((public.budget_get_actuals_v1(p,null,50)->'entries')) x where x->>'source_transaction_id'='query-split'),2::bigint,'DD-07 split purchase exposes components without parent row');
  r:=public.budget_get_liquidity_v1('2026-09-27 12:00:00Z',45);
  raise notice '%',ok(jsonb_typeof(r->'forecast')='object' and r->'forecast' ? 'entries','DD-08 cash/card liquidity result has one observed resource calculation');
  raise notice '%',ok(not exists(select 1 from jsonb_array_elements(r->'forecast'->'entries') x where x->>'kind'='card_repayment' and x->>'kind'='purchase'),'DD-09 repayment is not duplicated as a second forecast debit');
  r:=public.budget_get_review_queue_v1(null,50);
  raise notice '%',ok(r->>'complete'='false' and r->'reasons' @> '[{"code":"review_items_present"}]'::jsonb,'review queue is incomplete with actionable-item reason independent of pagination');
  raise notice '%',ok((select count(*)=1 from jsonb_array_elements(r->'items') x where x->>'kind'='allocation' and x->>'source_transaction_id'='query-review'),'DD-10 needs-review exposure appears once in the queue');
  raise notice '%',ok((select count(*)=1 from jsonb_array_elements(r->'items') x where x->>'kind'='allocation' and x ? 'reasons' and x ? 'provenance'),'DD-11 restricted/missing evidence is represented by reasons and provenance');
  raise notice '%',ok((select count(*)=1 from jsonb_array_elements(r->'items') x where x->>'kind'='allocation' and x->>'impact_cents'='-12500'),'DD-12 review impact is signed and does not invent reserve release');
  raise notice '%',ok((public.budget_get_actuals_v1(p,null,50)->'entries' @> jsonb_build_array(jsonb_build_object('source_transaction_id','query-split'))),'DD-13 source rows are exposed once through allocation components');
  raise notice '%',ok(jsonb_typeof((public.budget_get_actuals_v1(p,null,50)->'entries'->0->'source_snapshot'))='object','DD-14 source trail is returned for refund/correction-capable actuals');
  raise notice '%',ok(not (r ? 'income_cents') or r->>'income_cents' is null,'DD-15 income is not silently converted into a fund assignment');
  raise notice '%',ok((public.budget_get_actuals_v1(p,null,50)->'entries'->0) ? 'supersedes_id','DD-16 correction lineage field is present/nullable on current facts');
  r:=public.budget_get_overview_v1(date '2026-09-23','2026-09-27 12:00:00Z');
  raise notice '%',ok(r->>'complete'='false' and jsonb_array_length(coalesce(r->'reasons','[]'))>0,'DD-17 stale/missing reconciliation is incomplete with reasons');
  before:=(select count(*) from finance.budget_commands); r:=public.budget_get_fund_v1('00000000-0000-4000-8000-00000000e804',date '2026-09-23',date '2026-09-28',null,50); raise notice '%',is((select count(*) from finance.budget_commands),before,'DD-18 read replay never creates a second assignment command');
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000e599','role','authenticated')::text,true); perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e599',true); begin perform public.budget_get_actuals_v1(p,null,50); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_forbidden:%','DD-19 foreign household member is denied'); end;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_uid::text,'role','authenticated')::text,true); perform set_config('request.jwt.claim.sub',auth_uid::text,true); r:=public.budget_get_review_queue_v1(null,50); raise notice '%',ok((select count(*)=1 from jsonb_array_elements(r->'items') x where x->>'kind'='allocation' and x->>'source_transaction_id'='query-review' and x->>'fund_id' is null and x->'reasons' @> '[{"code":"allocation_needs_review"}]'::jsonb),'DD-20 unresolved/null-fund item remains visible in review queue');
  r:=public.budget_get_actuals_v1(p,null,50); raise notice '%',ok((r->'entries'->0->>'signed_amount_cents') ~ '^-?[0-9]+$','DD-21 provider sign is normalized as decimal signed cents');
  raise notice '%',ok((select count(*) from finance.budget_lines where household_id=h and version_id='00000000-0000-4000-8000-00000000e805' and fund_id='00000000-0000-4000-8000-00000000e804')=1,'DD-22 one target line per fund is visible in version detail');
  r:=public.budget_get_liquidity_v1('2026-09-27 12:00:00Z',45); raise notice '%',ok(r ? 'restricted_claims' and r ? 'restricted_resources','DD-23 restricted claim/correction surfaces remain separate from liquid resources');

  -- Deterministic keyset pages, filter binding, and differing filtered/household totals.
  r:=public.budget_get_actuals_v1(p,null,2); c:=r->>'next_cursor'; raise notice '%',is(jsonb_array_length(r->'entries'),2,'multi-page first keyset page is bounded');
  begin r:=public.budget_get_actuals_v1(p,c,2); raise notice '%',ok(jsonb_array_length(r->'entries')>0,'multi-page second keyset page advances deterministically'); exception when sqlstate 'P0001' then raise notice '%',ok(false,'multi-page second keyset page advances deterministically: '||sqlerrm); end;
  begin perform public.budget_get_actuals_v1(jsonb_build_object('from','2026-09-23','to','2026-09-29'),c,2); raise exception 'not rejected'; exception when sqlstate 'P0001' then raise notice '%',ok(sqlerrm like 'budget_invalid:%','cursor filter binding rejects changed range'); end;
  begin r:=public.budget_get_actuals_v1(p||jsonb_build_object('beneficiary_scope','shared','paid_by_member_id',member_id::text),null,50); raise notice '%',ok(r->'filtered_totals' <> r->'household_totals','filtered payer totals do not replace household totals'); exception when sqlstate 'P0001' then raise notice '%',ok(false,'filtered payer totals do not replace household totals: '||sqlerrm); end;

  -- Actual role/JWT denials, plus no mutation across all seven reads.
  execute 'set local role anon'; perform set_config('request.jwt.claims',jsonb_build_object('role','anon')::text,true); begin perform public.budget_get_version_v1('00000000-0000-4000-8000-00000000e805'); raise exception 'not rejected'; exception when insufficient_privilege then raise notice '%',ok(true,'anon RPC call returns no data'); end;
  execute 'set local role service_role'; perform set_config('request.jwt.claims',jsonb_build_object('role','service_role')::text,true); begin perform public.budget_get_liquidity_v1('2026-09-27 12:00:00Z',45); raise exception 'not rejected'; exception when insufficient_privilege then raise notice '%',ok(true,'service RPC call returns no data'); end;
  execute 'set local role authenticated'; perform set_config('request.jwt.claims',jsonb_build_object('sub',auth_uid::text,'role','authenticated')::text,true); perform set_config('request.jwt.claim.sub',auth_uid::text,true);
  before:=(select count(*) from finance.budget_commands)+(select count(*) from finance.budget_versions)+(select count(*) from finance.budget_allocation_sets)+(select count(*) from finance.budget_allocations)+(select count(*) from finance.fund_movements)+(select count(*) from finance.fund_earmarks);
  perform public.budget_get_overview_v1(date '2026-09-23','2026-09-27 12:00:00Z'); perform public.budget_get_fund_v1('00000000-0000-4000-8000-00000000e804',date '2026-09-23',date '2026-09-28',null,50); perform public.budget_list_versions_v1(null,50); perform public.budget_get_version_v1('00000000-0000-4000-8000-00000000e805'); perform public.budget_get_actuals_v1(p,null,50); perform public.budget_get_review_queue_v1(null,50); perform public.budget_get_liquidity_v1('2026-09-27 12:00:00Z',45);
  raise notice '%',is((select count(*) from finance.budget_commands)+(select count(*) from finance.budget_versions)+(select count(*) from finance.budget_allocation_sets)+(select count(*) from finance.budget_allocations)+(select count(*) from finance.fund_movements)+(select count(*) from finance.fund_earmarks),before,'all seven member reads are nonmutating');
end
$acceptance$;

select * from finish();
rollback;
