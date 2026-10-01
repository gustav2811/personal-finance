begin;
select plan(31);

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000d901');
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
  ('00000000-0000-4000-8000-00000000d902','00000000-0000-4000-8000-00000000d901','fund@test.invalid','00000000-0000-4000-8000-00000000d903','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
values ('00000000-0000-4000-8000-00000000d904','fund-cash','Fund cash','00000000-0000-4000-8000-00000000d901','test','ZAR');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by) values
  ('00000000-0000-4000-8000-00000000d905','00000000-0000-4000-8000-00000000d901','Gifts','shared','00000000-0000-4000-8000-00000000d902'),
  ('00000000-0000-4000-8000-00000000d906','00000000-0000-4000-8000-00000000d901','Travel','shared','00000000-0000-4000-8000-00000000d902');
insert into finance.budget_versions(id,household_id,version_number,state,starts_on_cycle,published_at,actor_id,reason)
values ('00000000-0000-4000-8000-00000000d907','00000000-0000-4000-8000-00000000d901',null,'draft',date '2026-09-23',null,'00000000-0000-4000-8000-00000000d902','fund test');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy)
values ('00000000-0000-4000-8000-00000000d908','00000000-0000-4000-8000-00000000d901','00000000-0000-4000-8000-00000000d907','00000000-0000-4000-8000-00000000d9a9','00000000-0000-4000-8000-00000000d905','Gifts','shared','consumption',0,'accumulating','cycle','carry');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,contribution_cents,funding_behaviour,recurrence,rollover_policy)
values ('00000000-0000-4000-8000-00000000d90a','00000000-0000-4000-8000-00000000d901','00000000-0000-4000-8000-00000000d907','00000000-0000-4000-8000-00000000d9b9','00000000-0000-4000-8000-00000000d906','Travel','shared','consumption',0,'accumulating','cycle','carry');
update finance.budget_versions set state='published',version_number=1,published_at=now()-interval '1 day'
where id='00000000-0000-4000-8000-00000000d907';
insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
values ('00000000-0000-4000-8000-00000000d901','00000000-0000-4000-8000-00000000d904','shared',true,'liquid',24,'outflow_negative','test','00000000-0000-4000-8000-00000000d902');
insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at)
values ('00000000-0000-4000-8000-00000000d904',current_date,200000,'ZAR','00000000-0000-4000-8000-00000000d901','test',now()-interval '1 hour');

do $seed$
declare h uuid := '00000000-0000-4000-8000-00000000d901'; a uuid := '00000000-0000-4000-8000-00000000d904';
  actor uuid := '00000000-0000-4000-8000-00000000d902'; fp text; sf text; coverage jsonb; checked jsonb;
begin
  select finance.budget_settings_fingerprint(h,a), finance.budget_snapshot_fingerprint(h,a,current_date) into fp,sf;
  coverage := jsonb_build_object('schema_version',1,'evidence','fund fixture',
    'utility_coverage',jsonb_build_object('status','not_required','evidence','none'),
    'accounts',jsonb_build_array(jsonb_build_object('account_id',a::text,'status','included',
      'settings_fingerprint',fp,'snapshot_date',current_date::text,'snapshot_fingerprint',sf,
      'balance_convention','cash_signed','activity_through',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'pending_included_ids','[]'::jsonb,'evidence','cash')));
  checked := finance.budget_check_coverage(h,coverage,now());
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  values ('00000000-0000-4000-8000-00000000d910',h,now(),actor,checked->>'status',checked->'coverage_snapshot',date '2026-09-23','fixture');
end $seed$;

do $member$
declare h uuid := '00000000-0000-4000-8000-00000000d901'; resources jsonb; p jsonb; r jsonb; replay jsonb;
  movement uuid; reversal uuid; reallocation uuid; failed boolean; before_receipts bigint; before_rows bigint;
begin
  select finance.budget_resources(h,now()) into resources;
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000d903','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000d903',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  p := jsonb_build_object('kind','opening','to_fund_id','00000000-0000-4000-8000-00000000d905',
    'amount_cents','100000','effective_on','2026-09-23','expected_version_id','00000000-0000-4000-8000-00000000d907',
    'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','opening','earmarks','[]'::jsonb);
  r := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d911',p);
  movement := (r->>'movement_id')::uuid;
  raise notice '%', ok(movement is not null,'member creates backed opening');
  replay := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d911',p);
  raise notice '%', is(replay,r,'opening replay returns original receipt');
  p := jsonb_build_object('kind','assign','to_fund_id','00000000-0000-4000-8000-00000000d905',
    'amount_cents','50000','effective_on',current_date::text,'expected_version_id','00000000-0000-4000-8000-00000000d907',
    'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','cycle gift',
    'funding_occurrence_key','cycle:2026-09-23:line:00000000-0000-4000-8000-00000000d9a9:occurrence:1','earmarks','[]'::jsonb);
  r := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d912',p);
  raise notice '%', ok((r->>'movement_id') is not null,'member assigns with canonical occurrence identity');
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d913',p||jsonb_build_object('funding_occurrence_key','cycle:2026-09-23:line:00000000-0000-4000-8000-00000000D9A9:occurrence:01')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_conflict: funding occurrence already exists'; end;
  raise notice '%', ok(failed,'case and ordinal variants canonicalize to duplicate occurrence');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d917',p||jsonb_build_object('funding_occurrence_key','cycle:2026-09-23:line:00000000-0000-4000-8000-00000000d9aa:occurrence:2')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_invalid: funding_occurrence_key does not match plan line'; end;
  raise notice '%', ok(failed,'occurrence rejects a line outside expected version');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d918',p||jsonb_build_object('funding_occurrence_key','cycle:2026-10-23:line:00000000-0000-4000-8000-00000000d9a9:occurrence:2')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_invalid: funding_occurrence_key does not match plan line'; end;
  raise notice '%', ok(failed,'occurrence rejects a cycle outside effective cycle');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d919',p||jsonb_build_object('funding_occurrence_key','cycle:2026-09-23:line:00000000-0000-4000-8000-00000000d9b9:occurrence:2')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_invalid: funding_occurrence_key does not match plan line'; end;
  raise notice '%', ok(failed,'occurrence rejects a line for another target fund');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d91a',jsonb_build_object(
    'kind','assign','to_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','100000',
    'effective_on','2026-09-23','expected_version_id','00000000-0000-4000-8000-00000000d907',
    'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint',
    'reason','attempt to backdate funding','earmarks','[]'::jsonb)); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_insufficient: backed unassigned resources'; end;
  raise notice '%', ok(failed,'backdated assignment cannot reuse today''s already assigned resources');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d91b',p||jsonb_build_object('funding_occurrence_key',null,'expected_version_id','00000000-0000-4000-8000-00000000d999')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_stale: plan version'; end;
  raise notice '%', ok(failed,'move requires current plan version');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d91c',p||jsonb_build_object('funding_occurrence_key',null,'expected_reconciliation_id','00000000-0000-4000-8000-00000000d999')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_stale: reconciliation'; end;
  raise notice '%', ok(failed,'move requires latest reconciliation identity');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d921',p||jsonb_build_object('funding_occurrence_key',null,'expected_reconciliation_fingerprint','wrong')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_stale: reconciliation'; end;
  raise notice '%', ok(failed,'move requires latest reconciliation fingerprint');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d91d',p||jsonb_build_object('kind','opening','amount_cents','1','effective_on','2026-09-22','funding_occurrence_key',null)); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_invalid: effective_on is outside the established range'; end;
  raise notice '%', ok(failed,'opening cannot precede established cutoff');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d91e',p||jsonb_build_object('kind','opening','amount_cents','1','effective_on','2026-09-23','funding_occurrence_key',null)); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_conflict: opening already exists'; end;
  raise notice '%', ok(failed,'ordinary opening is unique per target fund');
  before_receipts := (select count(*) from finance.budget_commands where household_id=h);
  before_rows := (select count(*) from finance.fund_movements where household_id=h);
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d914',p||jsonb_build_object('earmarks',jsonb_build_array(jsonb_build_object('x',1)))); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_incomplete: earmarks are unavailable until PR4'; end;
  raise notice '%', ok(failed,'earmark payload rejects before write');
  raise notice '%', is((select count(*) from finance.budget_commands where household_id=h),before_receipts,'failed move has no receipt');
  raise notice '%', is((select count(*) from finance.fund_movements where household_id=h),before_rows,'failed move has no movement');
  r := public.budget_correct_movement_v1('00000000-0000-4000-8000-00000000d915',jsonb_build_object('movement_id',movement::text,
    'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','correct opening',
    'replacement',jsonb_build_object('kind','opening','to_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','100000','effective_on','2026-09-23')));
  raise notice '%', ok(r->>'reversal_movement_id' is not null and r->>'replacement_movement_id' is not null,'correction appends reversal and replacement together');
  reversal := (r->>'reversal_movement_id')::uuid;
  raise notice '%', is((select count(*) from finance.fund_movements where household_id=h and correction_of=movement),2::bigint,'correction has exactly two linked rows');
  failed := false;
  begin perform public.budget_correct_movement_v1('00000000-0000-4000-8000-00000000d916',jsonb_build_object('movement_id',movement::text,'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','again')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_conflict: movement is already corrected'; end;
  raise notice '%', ok(failed,'original can only be corrected once');
  failed := false;
  begin perform public.budget_correct_movement_v1('00000000-0000-4000-8000-00000000d91f',jsonb_build_object('movement_id',reversal::text,'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','correct reversal')); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_invalid: correction must reference an original movement'; end;
  raise notice '%', ok(failed,'correction cannot target a reversal');
  failed := false;
  begin perform public.budget_correct_movement_v1('00000000-0000-4000-8000-00000000d920',jsonb_build_object('movement_id',movement::text,'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','wrong opening replacement','replacement',jsonb_build_object('kind','assign','to_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','1','effective_on','2026-09-23'))); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_conflict: movement is already corrected'; end;
  raise notice '%', ok(failed,'a second correction cannot append another reversal');
  r := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d924',jsonb_build_object('kind','reallocate','from_fund_id','00000000-0000-4000-8000-00000000d905','to_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','10000','effective_on',current_date::text,'expected_version_id','00000000-0000-4000-8000-00000000d907','expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','move between funds','earmarks','[]'::jsonb));
  reallocation := (r->>'movement_id')::uuid;
  raise notice '%', ok(reallocation is not null,'reallocate preserves backed total while moving source balance');
  before_receipts := (select count(*) from finance.budget_commands where household_id=h);
  before_rows := (select count(*) from finance.fund_movements where household_id=h);
  failed := false;
  begin perform public.budget_correct_movement_v1('00000000-0000-4000-8000-00000000d925',jsonb_build_object('movement_id',reallocation::text,'expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','bad replacement','replacement',jsonb_build_object('kind','opening','to_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','1','effective_on',current_date::text))); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_invalid: replacement cannot invent opening'; end;
  raise notice '%', ok(failed,'invalid replacement rejects correction');
  raise notice '%', is((select count(*) from finance.budget_commands where household_id=h),before_receipts,'failed replacement correction writes no receipt');
  raise notice '%', is((select count(*) from finance.fund_movements where household_id=h),before_rows,'failed replacement correction writes no reversal');
  execute 'reset role';
  update finance.funds set status='retired' where household_id=h and id='00000000-0000-4000-8000-00000000d906';
  execute 'set local role authenticated';
  r := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d926',jsonb_build_object('kind','release','from_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','10000','effective_on',current_date::text,'expected_version_id','00000000-0000-4000-8000-00000000d907','expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','release retired money','earmarks','[]'::jsonb));
  raise notice '%', ok(r->>'movement_id' is not null,'retired source can release remaining balance');
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d927',jsonb_build_object('kind','assign','to_fund_id','00000000-0000-4000-8000-00000000d906','amount_cents','1','effective_on',current_date::text,'expected_version_id','00000000-0000-4000-8000-00000000d907','expected_reconciliation_id',resources->>'reconciliation_id','expected_reconciliation_fingerprint',resources->>'reconciliation_fingerprint','reason','retired target','earmarks','[]'::jsonb)); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_not_found: fund'; end;
  raise notice '%', ok(failed,'retired target rejects new assignment');
  execute 'reset role';
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,notes)
  select '00000000-0000-4000-8000-00000000d922',h,now(),'00000000-0000-4000-8000-00000000d902','incomplete',coverage_snapshot,'newer incomplete fixture'
  from finance.budget_reconciliations where id='00000000-0000-4000-8000-00000000d910';
  execute 'set local role authenticated';
  failed := false;
  begin perform public.budget_move_funds_v1('00000000-0000-4000-8000-00000000d923',p||jsonb_build_object('funding_occurrence_key',null)); exception when sqlstate 'P0001' then failed := sqlerrm = 'budget_incomplete: resources are incomplete'; end;
  raise notice '%', ok(failed,'newest incomplete reconciliation blocks funding');
  execute 'reset role';
end $member$;

select ok(not has_function_privilege('anon','public.budget_move_funds_v1(uuid,jsonb)'::regprocedure,'execute'),'anon cannot move funds');
select ok(has_function_privilege('authenticated','public.budget_correct_movement_v1(uuid,jsonb)'::regprocedure,'execute'),'authenticated can correct funds');
select is(
  finance.budget_correction_payload(jsonb_build_object('movement_id','00000000-0000-4000-8000-00000000d905','expected_reconciliation_id','00000000-0000-4000-8000-00000000d910','expected_reconciliation_fingerprint','fixture','reason','normalize')),
  finance.budget_correction_payload(jsonb_build_object('movement_id','00000000-0000-4000-8000-00000000d905','expected_reconciliation_id','00000000-0000-4000-8000-00000000d910','expected_reconciliation_fingerprint','fixture','reason',' normalize ','replacement',null)),
  'correction absent and null replacement canonicalize before replay');
select * from finish();
rollback;
