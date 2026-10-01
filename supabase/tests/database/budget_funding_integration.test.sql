begin;
select plan(24);

-- The fixture uses one household and two members.  The command sequence below
-- runs under the member JWT; only immutable source facts are seeded as admin.
insert into finance.households(id) values
  ('00000000-0000-4000-8000-00000000a501'),
  ('00000000-0000-4000-8000-00000000a511');
insert into finance.household_members(id,household_id,email,auth_user_id,role) values
  ('00000000-0000-4000-8000-00000000a502','00000000-0000-4000-8000-00000000a501','integration@test.invalid','00000000-0000-4000-8000-00000000a503','member'),
  ('00000000-0000-4000-8000-00000000a504','00000000-0000-4000-8000-00000000a501','cara@test.invalid','00000000-0000-4000-8000-00000000a505','member'),
  ('00000000-0000-4000-8000-00000000a512','00000000-0000-4000-8000-00000000a511','outsider@test.invalid','00000000-0000-4000-8000-00000000a513','member');
insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code) values
  ('00000000-0000-4000-8000-00000000a506','integration-account','Integration account','00000000-0000-4000-8000-00000000a501','test','ZAR');
insert into finance.categories(id,household_id,name,slug) values
  ('00000000-0000-4000-8000-00000000a507','00000000-0000-4000-8000-00000000a501','Groceries','groceries'),
  ('00000000-0000-4000-8000-00000000a508','00000000-0000-4000-8000-00000000a501','Gifts','gifts');
insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at)
values ('00000000-0000-4000-8000-00000000a506',current_date,200000,'ZAR','00000000-0000-4000-8000-00000000a501','test',now()-interval '1 hour');

do $integration$
declare
  h uuid := '00000000-0000-4000-8000-00000000a501';
  member_auth uuid := '00000000-0000-4000-8000-00000000a503';
  cara uuid := '00000000-0000-4000-8000-00000000a504';
  account uuid := '00000000-0000-4000-8000-00000000a506';
  groceries uuid := '00000000-0000-4000-8000-00000000a507';
  gifts_category uuid := '00000000-0000-4000-8000-00000000a508';
  groceries_fund uuid;
  gifts_fund uuid;
  draft_id uuid;
  version_id uuid;
  reconciliation_id uuid;
  reconciliation_fp text;
  source_fp_1 text;
  source_fp_2 text;
  source_fp_refund text;
  allocation_1 jsonb;
  allocation_2 jsonb;
  refund jsonb;
  move jsonb;
  gifts_balance bigint;
  gifts_outflow bigint;
  gifts_refund bigint;
  overview jsonb;
  detail jsonb;
  resources jsonb;
  payload jsonb;
  line_groceries uuid := '00000000-0000-4000-8000-00000000a509';
  line_gifts uuid := '00000000-0000-4000-8000-00000000a510';
  failed boolean := false;
  stale jsonb;
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',member_auth::text,'role','authenticated','email','integration@test.invalid','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub',member_auth::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';

  groceries_fund := (public.budget_create_fund_v1('00000000-0000-4000-8000-00000000a601',
    '{"name":"Groceries","beneficiary_scope":"shared"}'::jsonb)->>'fund_id')::uuid;
  gifts_fund := (public.budget_create_fund_v1('00000000-0000-4000-8000-00000000a602',
    '{"name":"Gifts","beneficiary_scope":"shared"}'::jsonb)->>'fund_id')::uuid;
  raise notice '%', ok(groceries_fund is not null and gifts_fund is not null,'member creates both funds');

  payload := jsonb_build_object('account_id',account::text,'owner_scope','shared','included',true,
    'resource_class','liquid','freshness_hours',24,'transaction_sign_convention','outflow_negative',
    'sign_evidence','bank statement');
  raise notice '%', ok((public.budget_configure_account_v1('00000000-0000-4000-8000-00000000a603',payload)->>'settings_fingerprint') is not null,'member configures account');

  payload := jsonb_build_object('starts_on_cycle','2026-09-23','reason','integration plan',
    'income_assumptions',jsonb_build_array(jsonb_build_object('member_id',cara::text,'expected_net_cents','200000','expected_on','2026-09-23','provenance','fixture')),
    'source_references',jsonb_build_array(jsonb_build_object('source','fixture','reference','integration')),
    'lines',jsonb_build_array(
      jsonb_build_object('stable_line_id',line_groceries::text,'fund_id',groceries_fund::text,'name','Groceries',
        'category_id',groceries::text,'category_name_snapshot','Groceries','group_name_snapshot','Living',
        'beneficiary_scope','shared','kind','consumption','contribution_cents','60000','funding_behaviour','accumulating',
        'recurrence','cycle','rollover_policy','carry'),
      jsonb_build_object('stable_line_id',line_gifts::text,'fund_id',gifts_fund::text,'name','Gifts',
        'category_id',gifts_category::text,'category_name_snapshot','Gifts','group_name_snapshot','Living',
        'beneficiary_scope','shared','kind','consumption','contribution_cents','30000','funding_behaviour','accumulating',
        'recurrence','cycle','rollover_policy','carry')));
  draft_id := (public.budget_save_draft_v1('00000000-0000-4000-8000-00000000a604',payload)->>'version_id')::uuid;
  raise notice '%', ok(draft_id is not null,'member saves draft');
  version_id := (public.budget_publish_v1('00000000-0000-4000-8000-00000000a605',
    jsonb_build_object('draft_id',draft_id::text,'expected_draft_revision',1,'expected_parent_version_id',null,
      'expected_latest_version_number',0,'reason','integration publish'))->>'version_id')::uuid;
  raise notice '%', ok(version_id=draft_id,'member publishes current plan');

  -- Reconciliation is also a member command.  Build coverage from the trusted
  -- source fingerprints while still in the transaction, before moving funds.
  execute 'reset role';
  payload := jsonb_build_object('as_of',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'opening_fund_cutover','2026-09-23','notes','integration reconciliation',
    'coverage_snapshot',jsonb_build_object('schema_version',1,'evidence','fixture',
      'utility_coverage',jsonb_build_object('status','not_required','evidence','none'),
      'accounts',jsonb_build_array(jsonb_build_object('account_id',account::text,'status','included',
        'settings_fingerprint',finance.budget_settings_fingerprint(h,account),
        'snapshot_date',current_date::text,'snapshot_fingerprint',finance.budget_snapshot_fingerprint(h,account,current_date),
        'balance_convention','cash_signed','activity_through',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'pending_included_ids','[]'::jsonb,'evidence','bank statement'))));
  execute 'set local role authenticated';
  payload := public.budget_record_reconciliation_v1('00000000-0000-4000-8000-00000000a606',payload);
  reconciliation_id := (payload->>'reconciliation_id')::uuid;
  reconciliation_fp := payload->>'reconciliation_fingerprint';
  raise notice '%', is(payload->>'status','complete','member records complete reconciliation');

  move := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000a607',
    jsonb_build_object('kind','opening','to_fund_id',gifts_fund::text,'amount_cents','100000',
      'effective_on','2026-09-23','expected_version_id',version_id::text,'expected_reconciliation_id',reconciliation_id::text,
      'expected_reconciliation_fingerprint',reconciliation_fp,'reason','opening funding','earmarks','[]'::jsonb));
  raise notice '%', ok((move->>'movement_id') is not null,'member creates opening movement');
  move := public.budget_move_funds_v1('00000000-0000-4000-8000-00000000a608',
    jsonb_build_object('kind','assign','to_fund_id',gifts_fund::text,'amount_cents','50000',
      'effective_on','2026-09-23','expected_version_id',version_id::text,'expected_reconciliation_id',reconciliation_id::text,
      'expected_reconciliation_fingerprint',reconciliation_fp,'reason','cycle assignment','earmarks','[]'::jsonb));
  raise notice '%', ok((move->>'movement_id') is not null,'member creates assignment movement');

  execute 'reset role';
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash) values
    ('integration-purchase-1',account,now(),current_date,'{}',h,'test',false,false,-900,'ZAR','integration-hash-1'),
    ('integration-purchase-2',account,now(),current_date,'{}',h,'test',false,false,-900,'ZAR','integration-hash-2'),
    ('integration-refund',account,now(),current_date,'{}',h,'test',false,false,200,'ZAR','integration-hash-3');
  insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status) values
    ('00000000-0000-4000-8000-00000000a517',h,'integration-purchase-1',groceries,'user','confirmed'),
    ('00000000-0000-4000-8000-00000000a518',h,'integration-purchase-2',gifts_category,'user','confirmed'),
    ('00000000-0000-4000-8000-00000000a519',h,'integration-refund',gifts_category,'user','confirmed');
  insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,decision_source,status) values
    ('00000000-0000-4000-8000-00000000a527',h,'integration-purchase-1',false,false,'user','confirmed'),
    ('00000000-0000-4000-8000-00000000a528',h,'integration-purchase-2',false,false,'user','confirmed'),
    ('00000000-0000-4000-8000-00000000a529',h,'integration-refund',false,false,'user','confirmed');
  select finance.budget_source_snapshot(h,'integration-purchase-1')->>'source_fingerprint',
    finance.budget_source_snapshot(h,'integration-purchase-2')->>'source_fingerprint',
    finance.budget_source_snapshot(h,'integration-refund')->>'source_fingerprint'
  into source_fp_1,source_fp_2,source_fp_refund;
  execute 'set local role authenticated';

  allocation_1 := public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000a609',
    jsonb_build_object('transaction_id','integration-purchase-1','expected_source_fingerprint',source_fp_1,
      'expected_current_set_id',null,'components',jsonb_build_array(
        jsonb_build_object('amount_cents','-60000','beneficiary_scope','shared','fund_id',groceries_fund::text,'category_id',groceries::text,'category_name_snapshot','Groceries','paid_by_member_id',cara::text,'effect_kind','consumption'),
        jsonb_build_object('amount_cents','-30000','beneficiary_scope','shared','fund_id',gifts_fund::text,'category_id',gifts_category::text,'category_name_snapshot','Gifts','paid_by_member_id',cara::text,'effect_kind','consumption')),
      'evidence',jsonb_build_object('receipt_reference','fixture-receipt-1','split_review_reason','fixture split')));
  raise notice '%', is(jsonb_array_length(allocation_1->'allocation_ids'),2,'first source stores reviewed split');
  allocation_2 := public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000a610',
    jsonb_build_object('transaction_id','integration-purchase-2','expected_source_fingerprint',source_fp_2,
      'expected_current_set_id',null,'components',jsonb_build_array(
        jsonb_build_object('amount_cents','-90000','beneficiary_scope','shared','fund_id',gifts_fund::text,'category_id',gifts_category::text,'category_name_snapshot','Gifts','paid_by_member_id',cara::text,'effect_kind','consumption')),
      'evidence',jsonb_build_object('receipt_reference','fixture-receipt-2')));
  raise notice '%', is(jsonb_array_length(allocation_2->'allocation_ids'),1,'second source stores Gifts outflow');
  refund := public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000a611',
    jsonb_build_object('transaction_id','integration-refund','expected_source_fingerprint',source_fp_refund,
      'expected_current_set_id',null,'components',jsonb_build_array(
        jsonb_build_object('amount_cents','20000','beneficiary_scope','shared','fund_id',gifts_fund::text,'category_id',gifts_category::text,'category_name_snapshot','Gifts','paid_by_member_id',cara::text,'effect_kind','refund','original_refund_allocation_id',(allocation_2->'allocation_ids'->>0))),
      'evidence',jsonb_build_object('receipt_reference','fixture-refund')));
  raise notice '%', ok((refund->>'set_id') is not null,'linked refund stores after the outflow');

  execute 'reset role';
  select balance_cents,outflow_cents,refund_cents into gifts_balance,gifts_outflow,gifts_refund from finance.budget_fund_balances(h,current_date) where fund_id=gifts_fund;
  raise notice '%', is(gifts_balance,50000::bigint,'Gifts balance is 50000 after assignment, outflows, and refund');
  raise notice '%', is(gifts_outflow,120000::bigint,'Gifts outflows include the split component and full purchase');
  raise notice '%', is(gifts_refund,20000::bigint,'Gifts refund is tracked separately');

  execute 'set local role authenticated';
  overview := public.budget_get_overview_v1(date '2026-09-23',now());
  raise notice '%', is(overview->>'calculation_version','household-budget-v1','overview uses budget calculation version');
  raise notice '%', is((overview->'funds'->0->>'balance_cents') is not null or (overview->'funds'->1->>'balance_cents') is not null,true,'overview includes fund balances');
  raise notice '%', is((select count(*) from finance.budget_commands where household_id=h),11::bigint,'each successful member command leaves one receipt');
  detail := public.budget_get_fund_v1(gifts_fund,date '2026-09-23',current_date+1,null,50);
  raise notice '%', ok(jsonb_array_length(detail->'entries') >= 5,'fund history includes movements and allocation revisions');
  raise notice '%', ok(exists(select 1 from finance.budget_allocations where household_id=h and paid_by_member_id=cara),'payer is frozen on allocation rows');
  execute 'reset role';

  -- Replay remains the original receipt after the source has changed.
  update public.transactions set amount=-1000,raw_payload_hash='integration-hash-2-changed' where id='integration-purchase-2';
  resources := finance.budget_resources(h,now());
  raise notice '%', is((resources->>'complete')::boolean,false,'source drift makes availability incomplete');
  raise notice '%', is(resources->>'net_liquid_cents',null,'source drift leaves availability null');
  raise notice '%', ok((resources->'reasons') @> '[{"code":"source_allocation_stale"}]'::jsonb,'source drift is explicit');
  execute 'set local role authenticated';
  stale := public.budget_review_allocation_v1('00000000-0000-4000-8000-00000000a610',
    jsonb_build_object('transaction_id','integration-purchase-2','expected_source_fingerprint',source_fp_2,
      'expected_current_set_id',null,'components',jsonb_build_array(
        jsonb_build_object('amount_cents','-90000','beneficiary_scope','shared','fund_id',gifts_fund::text,'category_id',gifts_category::text,'category_name_snapshot','Gifts','paid_by_member_id',cara::text,'effect_kind','consumption')),
      'evidence',jsonb_build_object('receipt_reference','fixture-receipt-2')));
  raise notice '%', is(stale,allocation_2,'replay after source change retains original effect');
  overview := public.budget_get_overview_v1(date '2026-09-23',now());
  raise notice '%', is(overview->>'net_liquid_cents',null,'overview availability remains null after drift');
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub','00000000-0000-4000-8000-00000000a599','role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000a599',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  begin
    perform public.budget_get_overview_v1(date '2026-09-23',now());
  exception when sqlstate 'P0001' then failed := sqlerrm like 'budget_forbidden:%';
  end;
  raise notice '%', ok(failed,'outsider cannot read the household');
end $integration$;

select * from finish();
rollback;
