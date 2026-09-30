begin;
select plan(26);

-- The commands are exercised as a member: payloads never carry household/actor.
insert into finance.households(id) values ('00000000-0000-4000-8000-00000000d101') on conflict do nothing;
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
 ('00000000-0000-4000-8000-00000000d102','00000000-0000-4000-8000-00000000d101','plans@test.invalid','00000000-0000-4000-8000-00000000d103','member'),
 ('00000000-0000-4000-8000-00000000d104','00000000-0000-4000-8000-00000000d101','payer@test.invalid','00000000-0000-4000-8000-00000000d105','member') on conflict do nothing;
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values ('00000000-0000-4000-8000-00000000d106','00000000-0000-4000-8000-00000000d101','Plan fund','shared','00000000-0000-4000-8000-00000000d102') on conflict do nothing;
insert into finance.categories(id,household_id,name,slug) values ('00000000-0000-4000-8000-00000000d107','00000000-0000-4000-8000-00000000d101','Plan category','plan-category') on conflict do nothing;
insert into public.accounts(account_id,source_account_id,name,household_id,source_system) values ('00000000-0000-4000-8000-00000000d115','plan-account','Plan account','00000000-0000-4000-8000-00000000d101','test') on conflict do nothing;
insert into finance.households(id) values ('00000000-0000-4000-8000-00000000d201') on conflict do nothing;
insert into finance.household_members(id,household_id,email,auth_user_id,role) values ('00000000-0000-4000-8000-00000000d202','00000000-0000-4000-8000-00000000d201','other-plan@test.invalid','00000000-0000-4000-8000-00000000d203','member') on conflict do nothing;
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values ('00000000-0000-4000-8000-00000000d204','00000000-0000-4000-8000-00000000d201','Other fund','shared','00000000-0000-4000-8000-00000000d202') on conflict do nothing;

do $tests$
declare p jsonb; publish_payload jsonb; r jsonb; v_id uuid; row_id uuid; failed boolean:=false; stale_message text;
begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000d103','role','authenticated')::text,true);
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d103',true); perform set_config('request.jwt.claim.role','authenticated',true); execute 'set local role authenticated';
 p:=jsonb_build_object('starts_on_cycle','2026-10-23','reason',' first plan ','income_assumptions',jsonb_build_array(jsonb_build_object('member_id','00000000-0000-4000-8000-00000000d102','expected_net_cents','00100','expected_on','2026-10-23','provenance','salary')),'source_references',jsonb_build_array(jsonb_build_object('source','bank','reference','statement')),'lines',jsonb_build_array(jsonb_build_object('stable_line_id','00000000-0000-4000-8000-00000000d108','fund_id','00000000-0000-4000-8000-00000000d106','name',' groceries ','category_id','00000000-0000-4000-8000-00000000d107','category_name_snapshot','Historical food','group_name_snapshot','Historical living','beneficiary_scope','shared','kind','consumption','contribution_cents','00010','funding_behaviour','target_by_date','target_cents','00100','due_on','2026-10-30','recurrence','cycle','rollover_policy','carry','planned_payer_member_id','00000000-0000-4000-8000-00000000d104')));
 r:=public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d109',p); v_id:=(r->>'version_id')::uuid;
 raise notice '%', ok(r->>'draft_revision'='1','member creates draft revision one');
 raise notice '%', is((select reason from finance.budget_versions where finance.budget_versions.id=v_id),'first plan','header is normalized');
 raise notice '%', is((select contribution_cents from finance.budget_lines where version_id=v_id),10::bigint,'line cents normalize from strings');
 raise notice '%', is((select category_name_snapshot from finance.budget_lines where version_id=v_id),'Historical food','line snapshots persist');
 row_id:=(select id from finance.budget_lines where version_id=v_id);
 r:=public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d109',p); raise notice '%', is((r->>'version_id')::uuid,v_id,'exact replay returns original result');
 p:=p||jsonb_build_object('draft_id',v_id::text,'expected_draft_revision',1,'reason','edited');
 r:=public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d110',p);
 raise notice '%', is((r->>'draft_revision')::bigint,2::bigint,'edit increments draft revision once');
 raise notice '%', is((select id from finance.budget_lines where version_id=v_id),row_id,'matching stable line retains row id');
 begin perform public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d111',p||jsonb_build_object('expected_draft_revision',1)); exception when sqlstate 'P0001' then failed:=true; stale_message:=sqlerrm; end; raise notice '%', ok(failed,'stale draft is rejected');
 publish_payload:=jsonb_build_object('draft_id',v_id::text,'expected_draft_revision',2,'expected_parent_version_id',null,'expected_latest_version_number',0,'reason','publish');
 r:=public.budget_publish_v1('00000000-0000-4000-8000-00000000d112',publish_payload);
 raise notice '%', is((r->>'version_number')::bigint,1::bigint,'publication assigns first version number');
 raise notice '%', is(stale_message,'budget_stale: draft revision','first stale edit has exact error');
 r:=public.budget_publish_v1('00000000-0000-4000-8000-00000000d112',publish_payload);
 raise notice '%', is((r->>'version_number')::bigint,1::bigint,'replay precedes stale publication tokens');
 execute 'reset role';
end $tests$;

do $more_tests$
declare
  p jsonb;
  r jsonb;
  v_draft uuid;
  parent_id uuid;
  future_id uuid;
  historical_id uuid;
  same_cycle_id uuid;
  clone_result jsonb;
  before_revision bigint;
  before_lines bigint;
  got_message text;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000d103','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d103',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  p := jsonb_build_object(
    'starts_on_cycle','2026-11-23','reason','all fields',
    'income_assumptions','[]'::jsonb,'source_references','[]'::jsonb,
    'lines',jsonb_build_array(jsonb_build_object(
      'stable_line_id','00000000-0000-4000-8000-00000000d116',
      'fund_id','00000000-0000-4000-8000-00000000d106','name','full line',
      'category_id','00000000-0000-4000-8000-00000000d107',
      'category_name_snapshot','Frozen category','group_name_snapshot','Frozen group',
      'beneficiary_scope','member','beneficiary_member_id','00000000-0000-4000-8000-00000000d104',
      'planned_payer_member_id','00000000-0000-4000-8000-00000000d104',
      'kind','debt_commitment','contribution_cents','2','funding_behaviour','target_by_date',
      'target_cents','9','due_on','2026-12-01','recurrence','annual','rollover_policy','release_explicit',
      'expected_payment_on','2026-11-25','expected_payment_account_id','00000000-0000-4000-8000-00000000d115',
      'match_category_id','00000000-0000-4000-8000-00000000d107')));
  r := public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d117',p);
  v_draft := (r->>'version_id')::uuid;
  raise notice '%', ok((select expected_payment_account_id='00000000-0000-4000-8000-00000000d115'::uuid and match_category_id='00000000-0000-4000-8000-00000000d107'::uuid and beneficiary_member_id='00000000-0000-4000-8000-00000000d104'::uuid from finance.budget_lines where version_id=v_draft),'full nullable line fields persist');
  before_revision := (select draft_revision from finance.budget_versions where id=v_draft);
  before_lines := (select count(*) from finance.budget_lines where version_id=v_draft);
  begin
    perform public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d118',p || jsonb_build_object('draft_id',v_draft::text,'expected_draft_revision',2));
  exception when sqlstate 'P0001' then got_message := sqlerrm;
  end;
  raise notice '%', is(got_message,'budget_stale: draft revision','stale revision has stable error');
  raise notice '%', is((select draft_revision from finance.budget_versions where id=v_draft),before_revision,'stale edit leaves header unchanged');
  raise notice '%', is((select count(*) from finance.budget_lines where version_id=v_draft),before_lines,'stale edit leaves lines unchanged');
  got_message := null;
  begin
    perform public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d119',p || jsonb_build_object('lines',jsonb_build_array((p->'lines'->0) || jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000d204'))));
  exception when sqlstate 'P0001' then got_message := sqlerrm;
  end;
  raise notice '%', is(got_message,'budget_forbidden: line reference','cross-household fund is forbidden');
  perform public.budget_update_fund_v1('00000000-0000-4000-8000-00000000d121',jsonb_build_object('fund_id','00000000-0000-4000-8000-00000000d106','expected_name','Plan fund','expected_status','active','name','Renamed fund','status','active'));
  raise notice '%', is((select category_name_snapshot from finance.budget_lines where version_id=v_draft),'Frozen category','fund rename does not refresh plan snapshots');
  raise notice '%', is((select name from finance.budget_lines where version_id=v_draft),'full line','fund rename does not change line name');
  execute 'set constraints all immediate';
  got_message := null;
  begin
    perform public.budget_publish_v1('00000000-0000-4000-8000-00000000d120',jsonb_build_object('draft_id',v_draft::text,'expected_draft_revision',1,'expected_parent_version_id',null,'expected_latest_version_number',0,'reason','bad latest'));
  exception when sqlstate 'P0001' then got_message := sqlerrm;
  end;
  raise notice '%', is(got_message,'budget_stale: latest version','stale latest publish has stable error');
  raise notice '%', ok(not exists(select 1 from finance.budget_commands where command_id='00000000-0000-4000-8000-00000000d120'),'failed publication has no receipt');
  parent_id := (select id from finance.budget_versions where household_id='00000000-0000-4000-8000-00000000d101' and state='published' and version_number=1);
  clone_result := public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d122',p || jsonb_build_object('starts_on_cycle','2027-01-23','draft_id',null,'expected_draft_revision',null,'parent_version_id',parent_id::text));
  future_id := (clone_result->>'version_id')::uuid;
  raise notice '%', ok((select stable_line_id='00000000-0000-4000-8000-00000000d116'::uuid and fund_id='00000000-0000-4000-8000-00000000d106'::uuid and id<>(select id from finance.budget_lines where version_id=v_draft) from finance.budget_lines where version_id=future_id),'clone retains stable/fund IDs but has a distinct row ID');
  perform public.budget_publish_v1('00000000-0000-4000-8000-00000000d123',jsonb_build_object('draft_id',future_id::text,'expected_draft_revision',1,'expected_parent_version_id',parent_id::text,'expected_latest_version_number',1,'reason','future'));
  clone_result := public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d124',p || jsonb_build_object('starts_on_cycle','2026-12-23','draft_id',null,'expected_draft_revision',null,'parent_version_id',parent_id::text)); historical_id := (clone_result->>'version_id')::uuid;
  clone_result := public.budget_publish_v1('00000000-0000-4000-8000-00000000d125',jsonb_build_object('draft_id',historical_id::text,'expected_draft_revision',1,'expected_parent_version_id',parent_id::text,'expected_latest_version_number',2,'reason','historical'));
  raise notice '%', is((clone_result->'warnings'->0->>'version_id')::uuid,future_id,'historical publication warns only about a future plan');
  clone_result := public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d126',p || jsonb_build_object('starts_on_cycle','2026-12-23','draft_id',null,'expected_draft_revision',null,'parent_version_id',parent_id::text)); same_cycle_id := (clone_result->>'version_id')::uuid;
  clone_result := public.budget_publish_v1('00000000-0000-4000-8000-00000000d127',jsonb_build_object('draft_id',same_cycle_id::text,'expected_draft_revision',1,'expected_parent_version_id',parent_id::text,'expected_latest_version_number',3,'reason','same cycle'));
  raise notice '%', ok(not (clone_result->'warnings' @> jsonb_build_array(jsonb_build_object('version_id',historical_id))),'same-cycle replacement emits no same-cycle divergence warning');
  raise notice '%', is((select id from finance.budget_versions where household_id='00000000-0000-4000-8000-00000000d101' and state='published' and starts_on_cycle<=date '2026-12-24' order by starts_on_cycle desc,version_number desc limit 1),same_cycle_id,'current plan ordering picks highest number for same cycle');
  execute 'reset role';
end $more_tests$;

select throws_ok($q$select public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d113','{"starts_on_cycle":"2026-10-23","reason":"x","income_assumptions":[],"source_references":[],"lines":[],"unknown":true}'::jsonb)$q$,'P0001','budget_invalid: unknown key unknown','unknown payload keys reject');
select throws_ok($q$select public.budget_save_draft_v1('00000000-0000-4000-8000-00000000d114','{"starts_on_cycle":"2026-10-23","reason":"x","income_assumptions":[],"source_references":[],"lines":[{"stable_line_id":"00000000-0000-4000-8000-00000000d108","fund_id":"00000000-0000-4000-8000-00000000d106","name":"x","beneficiary_scope":"shared","kind":"consumption","contribution_cents":10,"funding_behaviour":"cycle_allowance","recurrence":"cycle","rollover_policy":"carry"}]}'::jsonb)$q$,'P0001','budget_invalid: invalid contribution_cents','amounts are strings');
select * from finish();
rollback;
