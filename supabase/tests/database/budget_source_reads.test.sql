begin;
select plan(46);

select has_function('finance','budget_resources','uuid, timestamptz');
select has_function('public','budget_get_overview_v1','date, timestamptz');
select has_function('public','budget_get_fund_v1','uuid, date, date, text, integer');
select ok(has_function_privilege('authenticated',
  'public.budget_get_overview_v1(date,timestamptz)'::regprocedure,'execute'),
  'authenticated can execute augmented overview');
select ok(has_function_privilege('authenticated',
  'public.budget_get_fund_v1(uuid,date,date,text,integer)'::regprocedure,'execute'),
  'authenticated can execute augmented fund read');
select ok(not has_function_privilege('anon',
  'public.budget_get_overview_v1(date,timestamptz)'::regprocedure,'execute'),
  'anon cannot execute augmented overview');
select ok(not has_function_privilege('service_role',
  'public.budget_get_fund_v1(uuid,date,date,text,integer)'::regprocedure,'execute'),
  'service role cannot execute member fund read');
select ok(not has_function_privilege('authenticated',
  'finance.budget_resources(uuid,timestamptz)'::regprocedure,'execute'),
  'member cannot execute private resource helper');

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000e801');
insert into finance.household_members(id,household_id,email,auth_user_id,role)
values ('00000000-0000-4000-8000-00000000e802','00000000-0000-4000-8000-00000000e801',
  'source-reads@test.invalid','00000000-0000-4000-8000-00000000e803','member');
insert into finance.funds(id,household_id,name,beneficiary_scope,created_by)
values ('00000000-0000-4000-8000-00000000e804','00000000-0000-4000-8000-00000000e801',
  'source read fund','shared','00000000-0000-4000-8000-00000000e802');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
values ('00000000-0000-4000-8000-00000000e805','source-read-cash','Cash',
        '00000000-0000-4000-8000-00000000e801','test','ZAR'),
       ('00000000-0000-4000-8000-00000000e806','source-read-card','Card',
        '00000000-0000-4000-8000-00000000e801','test','ZAR');
insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at)
values ('00000000-0000-4000-8000-00000000e805',date '2026-09-30',2000000,'ZAR',
        '00000000-0000-4000-8000-00000000e801','test','2026-09-30 11:00+00'),
       ('00000000-0000-4000-8000-00000000e806',date '2026-09-30',300000,'ZAR',
        '00000000-0000-4000-8000-00000000e801','test','2026-09-30 11:00+00');
insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,
  freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
values ('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805','shared',true,'liquid',48,'outflow_negative','fixture','00000000-0000-4000-8000-00000000e802'),
       ('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806','shared',true,'card',48,'outflow_positive','fixture','00000000-0000-4000-8000-00000000e802');
insert into finance.categories(id,household_id,name,slug)
values ('00000000-0000-4000-8000-00000000e813','00000000-0000-4000-8000-00000000e801','Food','source-read-food');
insert into finance.budget_versions(id,household_id,starts_on_cycle,actor_id,state,reason)
values ('00000000-0000-4000-8000-00000000e807','00000000-0000-4000-8000-00000000e801',date '2026-09-23','00000000-0000-4000-8000-00000000e802','draft','');
insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,kind,
  funding_behaviour,recurrence,rollover_policy,category_id,match_category_id)
values ('00000000-0000-4000-8000-00000000e808','00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e807','00000000-0000-4000-8000-00000000e809','00000000-0000-4000-8000-00000000e804','Claim','shared','consumption','accumulating','cycle','carry','00000000-0000-4000-8000-00000000e813','00000000-0000-4000-8000-00000000e813');
update finance.budget_versions set state='published',version_number=1,
  published_at='2026-09-20 08:00+00',reason='fixture'
where id='00000000-0000-4000-8000-00000000e807';
insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
values ('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e810','fixture','{}','00000000-0000-4000-8000-00000000e802','{}');
insert into finance.fund_movements(id,household_id,to_fund_id,amount_cents,kind,effective_on,actor_id,command_id,reason)
values ('00000000-0000-4000-8000-00000000e811','00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e804',1500000,'opening',date '2026-09-23','00000000-0000-4000-8000-00000000e802','00000000-0000-4000-8000-00000000e810','fixture');
insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
values ('00000000-0000-4000-8000-00000000e812','00000000-0000-4000-8000-00000000e801','2026-09-30 12:00+00','00000000-0000-4000-8000-00000000e802','complete',
  finance.budget_check_coverage('00000000-0000-4000-8000-00000000e801',jsonb_build_object(
    'schema_version',1,'evidence','fixture','utility_coverage',jsonb_build_object('status','not_required','evidence','fixture'),
    'accounts',jsonb_build_array(
      jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e805','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805',date '2026-09-30'),'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'),
      jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e806','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806',date '2026-09-30'),'balance_convention','debt_positive','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'))),
    '2026-09-30 12:00+00')->'coverage_snapshot',date '2026-09-23','fixture');

select throws_ok($q$select public.budget_get_overview_v1(null,now())$q$,
  'P0001','budget_invalid: cycle_start must be day 23','null cycle remains rejected');

do $member$
declare
  r jsonb;
  denied boolean := false;
  snap jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'net_liquid_cents','1700000',
    'member read computes two-million cash minus three-hundred-thousand card debt');
  raise notice '%', is(r->>'net_claims_cents','1500000',
    'member read retains authoritative funded claim');
  raise notice '%', is(r->>'unassigned_cents','200000',
    'member read computes exact unassigned resources');
  raise notice '%', is(r->>'provisional_net_liquid_cents','1700000',
    'proved observation also exposes exact provisional resources');
  execute 'reset role';
  -- An explicitly included pending is already in the observed cash balance.
  -- It may affect its matched claim, but must not reserve cash a second time.
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
  values ('source-read-included','00000000-0000-4000-8000-00000000e805',date '2026-09-30',date '2026-09-30','{}',
    '00000000-0000-4000-8000-00000000e801','test',true,false,-600,'ZAR','source-read-included-v1');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status)
  values ('00000000-0000-4000-8000-00000000e822','00000000-0000-4000-8000-00000000e801','source-read-included','00000000-0000-4000-8000-00000000e813','user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,nature,decision_source,status)
  values ('00000000-0000-4000-8000-00000000e823','00000000-0000-4000-8000-00000000e801','source-read-included',false,false,'consumption','user','confirmed');
  update public.snapshots set amount_cents=1940000
  where account_id='00000000-0000-4000-8000-00000000e805' and date='2026-09-30';
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  values ('00000000-0000-4000-8000-00000000e813','00000000-0000-4000-8000-00000000e801','2026-09-30 12:00+00','00000000-0000-4000-8000-00000000e802','complete',
    finance.budget_source_state_snapshot('00000000-0000-4000-8000-00000000e801',
      finance.budget_check_coverage('00000000-0000-4000-8000-00000000e801',jsonb_build_object(
        'schema_version',1,'evidence','fixture','utility_coverage',jsonb_build_object('status','not_required','evidence','fixture'),
        'accounts',jsonb_build_array(
          jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e805','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805',date '2026-09-30'),'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00Z','pending_included_ids','["source-read-included"]'::jsonb,'evidence','fixture'),
          jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e806','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806',date '2026-09-30'),'balance_convention','debt_positive','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'))),
        '2026-09-30 12:00+00')->'coverage_snapshot'),date '2026-09-23','included pending fixture');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'provisional_net_liquid_cents','1640000','included pending uses the reduced observed cash exactly once');
  raise notice '%', ok(r->'pending_adjustments' @> '[{"transaction_id":"source-read-included","resource_delta_cents":"0"}]'::jsonb,
    'included pending reports a zero resource delta');
  execute 'reset role';
  delete from finance.transaction_treatments where transaction_id='source-read-included';
  delete from finance.transaction_classifications where transaction_id='source-read-included';
  delete from public.transactions where id='source-read-included';
  update public.snapshots set amount_cents=2000000
  where account_id='00000000-0000-4000-8000-00000000e805' and date='2026-09-30';
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
  values ('source-read-pending','00000000-0000-4000-8000-00000000e805',date '2026-09-30',date '2026-09-30','{}',
    '00000000-0000-4000-8000-00000000e801','test',true,false,-600,'ZAR','source-read-pending-v1');
  -- Keep the original complete cutover row, then freeze the pending source in
  -- a later reconciliation.  It is deliberately not an included balance item.
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  values ('00000000-0000-4000-8000-00000000e819','00000000-0000-4000-8000-00000000e801','2026-09-30 12:00+00','00000000-0000-4000-8000-00000000e802','complete',
    finance.budget_source_state_snapshot('00000000-0000-4000-8000-00000000e801',
      finance.budget_check_coverage('00000000-0000-4000-8000-00000000e801',jsonb_build_object(
        'schema_version',1,'evidence','fixture','utility_coverage',jsonb_build_object('status','not_required','evidence','fixture'),
        'accounts',jsonb_build_array(
          jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e805','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805',date '2026-09-30'),'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'),
          jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e806','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806',date '2026-09-30'),'balance_convention','debt_positive','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'))),
        '2026-09-30 12:00+00')->'coverage_snapshot'),date '2026-09-23','pending baseline fixture');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'provisional_net_liquid_cents','1640000',
    'unknown-purpose pending still reserves its proved six-hundred-rand outflow');
  raise notice '%', is(r->>'provisional_net_claims_cents','1500000',
    'unknown-purpose pending does not invent a fund claim delta');
  raise notice '%', is(r->>'provisional_unassigned_cents','140000',
    'unknown-purpose pending reduces only provisional unassigned resources');
  execute 'reset role';
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status)
  values ('00000000-0000-4000-8000-00000000e814','00000000-0000-4000-8000-00000000e801','source-read-pending','00000000-0000-4000-8000-00000000e813','user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,nature,decision_source,status)
  values ('00000000-0000-4000-8000-00000000e815','00000000-0000-4000-8000-00000000e801','source-read-pending',false,false,'consumption','user','confirmed');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'provisional_net_liquid_cents','1640000',
    'known pending reserves its six-hundred-rand outflow once');
  raise notice '%', is(r->>'provisional_net_claims_cents','1440000',
    'known pending reduces the matched fund claim once');
  raise notice '%', is(r->>'provisional_unassigned_cents','200000',
    'known pending preserves the unassigned remainder');
  raise notice '%', ok((r->'pending_adjustments') @> '[{"kind":"pending","amount_cents":"60000"}]'::jsonb,
    'member read exposes the bounded pending adjustment');
  execute 'reset role';
  update public.transactions set source_is_pending=false where id='source-read-pending';
  snap := finance.budget_source_snapshot('00000000-0000-4000-8000-00000000e801','source-read-pending');
  -- Direct fixture assembly follows the command path's invariant: create the
  -- set, attach every component, then write its command receipt last while
  -- the deferrable journal constraints are held.
  set constraints all deferred;
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,
    source_amount_cents,occurred_on,revision_number,status,actor_id,command_id,classification_id,treatment_id)
  values ('00000000-0000-4000-8000-00000000e817','00000000-0000-4000-8000-00000000e801','source-read-pending',snap,
    snap->>'source_fingerprint',(snap->>'amount_cents')::bigint,date '2026-09-30',1,'current',
    '00000000-0000-4000-8000-00000000e802','00000000-0000-4000-8000-00000000e816',
    '00000000-0000-4000-8000-00000000e814','00000000-0000-4000-8000-00000000e815');
  insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,
    beneficiary_scope,effect_kind)
  values ('00000000-0000-4000-8000-00000000e818','00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e817',
    0,-60000,'00000000-0000-4000-8000-00000000e804','00000000-0000-4000-8000-00000000e813','shared','consumption');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
  values ('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e816','fixture','{}','00000000-0000-4000-8000-00000000e802','{}');
  set constraints all immediate;
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'provisional_net_liquid_cents','1640000',
    'same-provider posted replacement remains unreflected until a fresh observation');
  raise notice '%', is(r->>'net_claims_cents','1440000',
    'reviewed posted replacement contributes one authoritative claim');
  raise notice '%', is(r->>'provisional_net_claims_cents','1440000',
    'posted replacement does not retain a second pending fund deduction');
  raise notice '%', is(r->>'provisional_unassigned_cents','200000',
    'same-id lifecycle keeps the original conservative unassigned remainder');
  raise notice '%', ok(r ? 'provisional_net_liquid_cents',
    'overview exposes provisional net resources');
  raise notice '%', ok(r ? 'provisional_net_claims_cents',
    'overview exposes provisional claims');
  raise notice '%', ok(r ? 'provisional_unassigned_cents',
    'overview exposes provisional unassigned');
  raise notice '%', ok(r ? 'pending_adjustments',
    'overview exposes bounded source adjustments');
  raise notice '%', ok((r->'funds') is not null,
    'overview retains fund collection');
  r := public.budget_get_fund_v1('00000000-0000-4000-8000-00000000e804',
    date '2026-09-01',date '2026-10-01',null,50);
  raise notice '%', ok(r ? 'provisional_available_cents',
    'fund read exposes provisional availability');
  raise notice '%', ok(r ? 'source_adjustments',
    'fund read exposes source adjustments');
  execute 'reset role';
  -- A new observed balance and reconciliation prove the posted lifecycle is
  -- now reflected.  The monetary totals remain identical while completeness
  -- is restored.
  update public.snapshots set amount_cents=1940000
  where account_id='00000000-0000-4000-8000-00000000e805' and date='2026-09-30';
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  values ('00000000-0000-4000-8000-00000000e820','00000000-0000-4000-8000-00000000e801','2026-09-30 12:00+00','00000000-0000-4000-8000-00000000e802','complete',
    finance.budget_source_state_snapshot('00000000-0000-4000-8000-00000000e801',
      finance.budget_check_coverage('00000000-0000-4000-8000-00000000e801',jsonb_build_object(
        'schema_version',1,'evidence','fixture','utility_coverage',jsonb_build_object('status','not_required','evidence','fixture'),
        'accounts',jsonb_build_array(
          jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e805','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e805',date '2026-09-30'),'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'),
          jsonb_build_object('account_id','00000000-0000-4000-8000-00000000e806','status','included','settings_fingerprint',finance.budget_settings_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806'),'snapshot_date','2026-09-30','snapshot_fingerprint',finance.budget_snapshot_fingerprint('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e806',date '2026-09-30'),'balance_convention','debt_positive','activity_through','2026-09-30T12:00:00Z','pending_included_ids','[]'::jsonb,'evidence','fixture'))),
        '2026-09-30 12:00+00')->'coverage_snapshot'),date '2026-09-23','fresh posted observation fixture');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', is(r->>'complete','true','fresh observed posted reconciliation restores complete resources');
  raise notice '%', is(r->>'net_liquid_cents','1640000','fresh observation proves the same net resources');
  raise notice '%', is(r->>'provisional_net_claims_cents','1440000','fresh observation preserves the reviewed claim');
  raise notice '%', is(r->>'provisional_unassigned_cents','200000','fresh observation preserves unassigned resources');
  execute 'reset role';
  -- A confirmed purchase has one posted economic leg and one pending mirror.
  -- The member RPC must expose one reviewed debit, not a mirror debit or a
  -- pending-purpose gate.  Both rows are frozen before the read.
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash,effective_at)
  values ('source-read-purchase-a-canonical','00000000-0000-4000-8000-00000000e805',date '2026-09-30',date '2026-09-30','{}',
    '00000000-0000-4000-8000-00000000e801','test',false,false,-600,'ZAR','purchase-canonical','2026-09-30 13:00+00'),
    ('source-read-purchase-z-mirror','00000000-0000-4000-8000-00000000e805',date '2026-09-30',date '2026-09-30','{}',
    '00000000-0000-4000-8000-00000000e801','test',true,false,-600,'ZAR','purchase-mirror','2026-09-30 13:00+00');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status)
  values ('00000000-0000-4000-8000-00000000e828','00000000-0000-4000-8000-00000000e801','source-read-purchase-a-canonical','00000000-0000-4000-8000-00000000e813','user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,nature,decision_source,status)
  values ('00000000-0000-4000-8000-00000000e829','00000000-0000-4000-8000-00000000e801','source-read-purchase-a-canonical',false,false,'consumption','user','confirmed');
  insert into finance.financial_events(id,household_id,event_type,status)
  values ('00000000-0000-4000-8000-00000000e825','00000000-0000-4000-8000-00000000e801','purchase','confirmed');
  insert into finance.financial_event_legs(id,household_id,event_id,transaction_id,leg_role,status)
  values ('00000000-0000-4000-8000-00000000e826','00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e825','source-read-purchase-a-canonical','economic_recognition','active'),
    ('00000000-0000-4000-8000-00000000e827','00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e825','source-read-purchase-z-mirror','mirror','active');
  snap := finance.budget_source_snapshot('00000000-0000-4000-8000-00000000e801','source-read-purchase-a-canonical');
  set constraints all deferred;
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,
    source_amount_cents,occurred_on,revision_number,status,actor_id,command_id,classification_id,treatment_id)
  values ('00000000-0000-4000-8000-00000000e831','00000000-0000-4000-8000-00000000e801','source-read-purchase-a-canonical',snap,
    snap->>'source_fingerprint',(snap->>'amount_cents')::bigint,date '2026-09-30',1,'current',
    '00000000-0000-4000-8000-00000000e802','00000000-0000-4000-8000-00000000e830',
    '00000000-0000-4000-8000-00000000e828','00000000-0000-4000-8000-00000000e829');
  insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,
    beneficiary_scope,effect_kind)
  values ('00000000-0000-4000-8000-00000000e832','00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e831',
    0,-60000,'00000000-0000-4000-8000-00000000e804','00000000-0000-4000-8000-00000000e813','shared','consumption');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
  values ('00000000-0000-4000-8000-00000000e801','00000000-0000-4000-8000-00000000e830','fixture','{}','00000000-0000-4000-8000-00000000e802','{}');
  set constraints all immediate;
  insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,opening_fund_cutover,notes)
  select '00000000-0000-4000-8000-00000000e833','00000000-0000-4000-8000-00000000e801','2026-09-30 14:00+00',
    '00000000-0000-4000-8000-00000000e802','complete',
    finance.budget_source_state_snapshot('00000000-0000-4000-8000-00000000e801',coverage_snapshot),date '2026-09-23','confirmed purchase fixture'
  from finance.budget_reconciliations where id='00000000-0000-4000-8000-00000000e820';
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 14:00+00');
  raise notice '%', is(r->>'complete','true','confirmed purchase mirror does not leave a member read gate');
  raise notice '%', is(r->>'net_liquid_cents','1580000','confirmed purchase group reserves one unreflected canonical debit');
  raise notice '%', is(r->>'net_claims_cents','1380000','confirmed purchase canonical review contributes one claim debit');
  raise notice '%', is(r->>'unassigned_cents','200000','confirmed purchase mirror adds neither claim nor unassigned debit');
  execute 'reset role';
  -- Every hard source/coverage uncertainty suppresses every provisional
  -- money field for a real member read; none is coerced to zero.
  update finance.budget_account_settings set sign_evidence='changed-fixture'
  where household_id='00000000-0000-4000-8000-00000000e801'
    and account_id='00000000-0000-4000-8000-00000000e805';
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', ok(r->>'provisional_net_liquid_cents' is null
    and r->>'provisional_net_claims_cents' is null and r->>'provisional_unassigned_cents' is null
    and (r->'funds'->0->>'provisional_available_cents') is null,
    'settings drift nulls every provisional member money field');
  execute 'reset role';
  update finance.budget_account_settings set sign_evidence='fixture'
  where household_id='00000000-0000-4000-8000-00000000e801'
    and account_id='00000000-0000-4000-8000-00000000e805';
  update public.snapshots set observed_at='2026-09-25 11:00+00'
  where account_id='00000000-0000-4000-8000-00000000e805' and date='2026-09-30';
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', ok(r->>'provisional_net_liquid_cents' is null
    and r->>'provisional_net_claims_cents' is null and r->>'provisional_unassigned_cents' is null
    and (r->'funds'->0->>'provisional_available_cents') is null,
    'stale observation nulls every provisional member money field');
  execute 'reset role';
  update public.snapshots set observed_at='2026-09-30 11:00+00'
  where account_id='00000000-0000-4000-8000-00000000e805' and date='2026-09-30';
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,
    source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
  values ('source-read-ambiguous-pending','00000000-0000-4000-8000-00000000e805',date '2026-09-30',date '2026-09-30','{}',
    '00000000-0000-4000-8000-00000000e801','test',true,false,-700,'ZAR','ambiguous-pending'),
    ('source-read-ambiguous-posted','00000000-0000-4000-8000-00000000e805',date '2026-09-30',date '2026-09-30','{}',
    '00000000-0000-4000-8000-00000000e801','test',false,false,-700,'ZAR','ambiguous-posted');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', ok(r->'reasons' @> '[{"code":"pending_identity_ambiguous"}]'::jsonb
    and r->>'provisional_net_liquid_cents' is null and r->>'provisional_net_claims_cents' is null
    and r->>'provisional_unassigned_cents' is null and (r->'funds'->0->>'provisional_available_cents') is null,
    'ambiguous pending identity nulls every provisional member money field');
  execute 'reset role';
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
  values ('00000000-0000-4000-8000-00000000e821','source-read-uncovered','Uncovered',
    '00000000-0000-4000-8000-00000000e801','test','ZAR');
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e803','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e803',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r := public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  raise notice '%', ok(r->>'provisional_net_liquid_cents' is null
    and r->>'provisional_net_claims_cents' is null and r->>'provisional_unassigned_cents' is null
    and (r->'funds'->0->>'provisional_available_cents') is null,
    'inventory drift nulls every provisional member money field');
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object(
    'sub','00000000-0000-4000-8000-00000000e899','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000e899',true);
  begin
    perform public.budget_get_overview_v1(date '2026-09-23','2026-09-30 12:00+00');
  exception when sqlstate 'P0001' then
    denied := sqlerrm = 'budget_forbidden: bound household member required';
  end;
  raise notice '%', ok(denied,'foreign member cannot read household resources');
end $member$;

select * from finish();
rollback;
