begin;
select plan(12);

do $$
declare
  h uuid:='00000000-0000-4000-8000-00000000f901';
  m uuid:='00000000-0000-4000-8000-00000000f902';
  u uuid:='00000000-0000-4000-8000-00000000f903';
  a uuid:='00000000-0000-4000-8000-00000000f904';
  p jsonb; f text; sf text; at timestamptz:=statement_timestamp()-interval '2 minutes'; r jsonb; r2 jsonb; checked jsonb; state jsonb;
begin
  insert into finance.households(id) values(h);
  insert into finance.household_members(id,household_id,email,auth_user_id,role) values(m,h,'cutover@test.invalid',u,'member');
  insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code,lifecycle_status)
    values(a,'cutover-liquid','Cutover liquid',h,'test','ZAR','active');
  insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
    values(h,a,'shared',true,'liquid',24,'outflow_negative','statement',m);
  insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at)
    values(a,current_date,10000,'ZAR',h,'test',at-interval '1 minute');
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code)
    values
      ('cutover-old-null',a,at-interval '40 days',(at-interval '40 days')::date,'{}',h,'test',null,false,-50,'ZAR'),
      ('cutover-old-archived',a,at-interval '40 days',(at-interval '40 days')::date,'{}',h,'test',null,true,-40,'ZAR'),
      ('cutover-old-active',a,at-interval '40 days',(at-interval '40 days')::date,'{}',h,'test',false,false,-30,'ZAR'),
      ('cutover-current-null',a,at-interval '1 day',(at-interval '1 day')::date,'{}',h,'test',null,false,-20,'ZAR'),
      ('cutover-current-pending',a,at-interval '1 day',(at-interval '1 day')::date,'{}',h,'test',true,false,-30,'ZAR');
  select finance.budget_settings_fingerprint(h,a),finance.budget_snapshot_fingerprint(h,a,current_date) into f,sf;
  p:=jsonb_build_object('as_of',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'opening_fund_cutover',(current_date-7)::text,'notes','initial cutover test',
    'coverage_snapshot',jsonb_build_object('schema_version',1,'evidence','statement','utility_coverage',jsonb_build_object('status','not_required','evidence','none'),
      'accounts',jsonb_build_array(jsonb_build_object('account_id',a::text,'status','included','settings_fingerprint',f,'snapshot_date',current_date::text,'snapshot_fingerprint',sf,'balance_convention','cash_signed','activity_through',to_char(at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'pending_included_ids','[]'::jsonb,'evidence','statement'))));

  checked:=finance.budget_check_coverage_with_cutover(h,p->'coverage_snapshot',at,current_date-7,true);
  raise notice '%',ok(not (checked->'reasons' @> '[{"transaction_id":"cutover-old-null"}]'::jsonb),'initial cutover skips only opening-balance history');
  raise notice '%',ok(checked->'reasons' @> '[{"transaction_id":"cutover-current-null"}]'::jsonb,'post-cutover unknown source remains blocking');
  raise notice '%',ok(checked->'reasons' @> '[{"transaction_id":"cutover-current-pending"}]'::jsonb,'explicit pending source remains blocking');

  delete from public.transactions where id in ('cutover-current-null','cutover-current-pending');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u::text,'role','authenticated','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r:=public.budget_record_reconciliation_v1('00000000-0000-4000-8000-00000000f905',p);
  raise notice '%',is(r->>'status','complete','member initial cutover completes with old unallocated source');
  execute 'reset role';

  state:=finance.budget_reconciliation_state(h,(r->>'reconciliation_id')::uuid,at);
  raise notice '%',is(state->>'status','complete','persisted cutoff reuses frozen baseline for known opening history');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u::text,'role','authenticated','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r2:=public.budget_record_reconciliation_v1('00000000-0000-4000-8000-00000000f906',p||jsonb_build_object('opening_fund_cutover',null));
  raise notice '%',is(r2->>'status','complete','subsequent fresh coverage reuses latest completed baseline');
  execute 'reset role';
  update public.transactions set source_is_archived=true where id='cutover-old-active';
  state:=finance.budget_reconciliation_state(h,(r->>'reconciliation_id')::uuid,at);
  raise notice '%',ok(state->'reasons' @> '[{"code":"source_unverified","transaction_id":"cutover-old-active"}]'::jsonb,'archiving a formerly active frozen source remains drift');
  update public.transactions set source_is_archived=false where id='cutover-old-active';
  insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code)
    values('cutover-late-backdated',a,at-interval '30 days',(at-interval '30 days')::date,'{}',h,'test',false,false,-10,'ZAR');
  state:=finance.budget_reconciliation_state(h,(r->>'reconciliation_id')::uuid,at);
  raise notice '%',ok(state->'reasons' @> '[{"code":"source_balance_inclusion_unknown","transaction_id":"cutover-late-backdated"}]'::jsonb,'late backdated source absent from frozen baseline reopens reconciliation');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u::text,'role','authenticated','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub',u::text,true); perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  r2:=public.budget_record_reconciliation_v1('00000000-0000-4000-8000-00000000f907',p||jsonb_build_object('opening_fund_cutover',null));
  raise notice '%',is(r2->>'status','incomplete','late backdated source blocks subsequent fresh reconciliation');
  execute 'reset role';
  delete from public.transactions where id='cutover-late-backdated';

  update finance.budget_account_settings set resource_class='restricted' where household_id=h and account_id=a;
  select finance.budget_settings_fingerprint(h,a) into f;
  p:=jsonb_set(p,'{coverage_snapshot,accounts,0,settings_fingerprint}',to_jsonb(f));
  checked:=finance.budget_check_coverage(h,p->'coverage_snapshot',at);
  raise notice '%',ok(checked->'reasons' @> '[{"code":"restricted_resources_unverified"}]'::jsonb,'restricted resource without capacity proof remains blocked');
  p:=jsonb_set(jsonb_set(p,'{coverage_snapshot,accounts,0,eligible_restricted_cents}','"10000"'::jsonb),'{coverage_snapshot,accounts,0,restricted_evidence}','"statement balance"'::jsonb);
  checked:=finance.budget_check_coverage(h,p->'coverage_snapshot',at);
  raise notice '%',ok(not (checked->'reasons' @> '[{"code":"restricted_resources_unverified"}]'::jsonb),'matching restricted capacity and evidence removes only its gate');
  p:=jsonb_set(p,'{coverage_snapshot,accounts,0,eligible_restricted_cents}','"10001"'::jsonb);
  checked:=finance.budget_check_coverage(h,p->'coverage_snapshot',at);
  raise notice '%',ok(checked->'reasons' @> '[{"code":"restricted_eligibility_exceeds_balance"}]'::jsonb,'restricted capacity cannot exceed observed balance');
end $$;

select * from finish();
rollback;
