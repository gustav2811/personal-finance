begin;
select plan(41);

-- Stage 3 acceptance fixtures deliberately use independent households.  The
-- initial complete reconciliation is frozen before any source rows are added.
create temp table source_acceptance_fixtures (
  household_id uuid primary key, member_id uuid not null, account_id uuid not null,
  fund_id uuid not null, category_id uuid not null, version_id uuid not null,
  line_id uuid not null, coverage jsonb not null
) on commit drop;

create function pg_temp.acceptance_coverage(p_household uuid, p_account uuid)
returns jsonb language plpgsql as $$
declare sf text; bf text;
begin
  select finance.budget_settings_fingerprint(p_household,p_account),
         finance.budget_snapshot_fingerprint(p_household,p_account,date '2026-09-30')
    into sf,bf;
  return jsonb_build_object(
    'schema_version',1,'evidence','stage3-acceptance',
    'utility_coverage',jsonb_build_object('status','not_required','evidence','fixture'),
    'accounts',jsonb_build_array(jsonb_build_object(
      'account_id',p_account::text,'status','included','settings_fingerprint',sf,
      'snapshot_date','2026-09-30','snapshot_fingerprint',bf,
      'balance_convention','cash_signed','activity_through','2026-09-30T12:00:00Z',
      'pending_included_ids','[]'::jsonb,'evidence','fixture',
      'snapshot_snapshot',jsonb_build_object('observed_at','2026-09-30T12:00:00Z'))));
end $$;

do $fixture$
declare
  hs text[] := array[
    '00000000-0000-4000-8000-000000009801','00000000-0000-4000-8000-000000009802',
    '00000000-0000-4000-8000-000000009803','00000000-0000-4000-8000-000000009804',
    '00000000-0000-4000-8000-000000009805','00000000-0000-4000-8000-000000009806',
    '00000000-0000-4000-8000-000000009807','00000000-0000-4000-8000-000000009808'];
  h uuid; m uuid; a uuid; f uuid; c uuid; v uuid; l uuid; cov jsonb; i integer;
begin
  for i in 1..array_length(hs,1) loop
    h:=hs[i]::uuid;
    m:=format('00000000-0000-4000-8000-0000000099%s',lpad(i::text,2,'0'))::uuid;
    a:=format('00000000-0000-4000-8000-000000009a%s',lpad(i::text,2,'0'))::uuid;
    f:=format('00000000-0000-4000-8000-000000009b%s',lpad(i::text,2,'0'))::uuid;
    c:=format('00000000-0000-4000-8000-000000009c%s',lpad(i::text,2,'0'))::uuid;
    v:=format('00000000-0000-4000-8000-000000009d%s',lpad(i::text,2,'0'))::uuid;
    l:=format('00000000-0000-4000-8000-000000009e%s',lpad(i::text,2,'0'))::uuid;
    insert into finance.households(id) values(h);
    insert into finance.household_members(id,household_id,email,auth_user_id,role)
      values(m,h,format('source-acceptance-%s@test.invalid',i),m,'member');
    insert into public.accounts(account_id,source_account_id,name,household_id,source_system,currency_code)
      values(a,format('source-acceptance-%s',i),format('Acceptance %s',i),h,'acceptance','ZAR');
    insert into public.snapshots(account_id,date,amount_cents,currency_code,household_id,source_system,observed_at)
      values(a,date '2026-09-30',500000,'ZAR',h,'acceptance','2026-09-30 12:00+00');
    insert into finance.budget_account_settings(household_id,account_id,owner_scope,included,resource_class,
      freshness_hours,transaction_sign_convention,sign_evidence,actor_id)
      values(h,a,'shared',true,'liquid',48,'outflow_negative','acceptance',m);
    insert into finance.funds(id,household_id,name,beneficiary_scope,created_by)
      values(f,h,format('Acceptance fund %s',i),'shared',m);
    insert into finance.categories(id,household_id,name,slug)
      values(c,h,'Acceptance','stage3-acceptance');
    insert into finance.budget_versions(id,household_id,state,version_number,draft_revision,starts_on_cycle,
      published_at,actor_id,reason)
      values(v,h,'draft',null,1,date '2026-09-23',null,m,'stage3 acceptance');
    insert into finance.budget_lines(id,household_id,version_id,stable_line_id,fund_id,name,beneficiary_scope,
      kind,contribution_cents,funding_behaviour,recurrence,rollover_policy,category_id,match_category_id)
      values(l,h,v,l,f,'Acceptance line','shared','consumption',0,'accumulating','cycle','carry',c,c);
    update finance.budget_versions set state='published',version_number=1,published_at='2026-09-20 08:00+00' where id=v;
    if i=2 then
      insert into public.transactions(id,account_id,date,effective_at,occurred_on,details,household_id,source_system,
        source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
        values('accept-pre-increase',a,date '2026-09-29',timestamptz '2026-09-29 08:00+00',date '2026-09-29','{}',h,'acceptance',false,false,-10,'ZAR','accept-pre-increase');
    elsif i=8 then
      insert into public.transactions(id,account_id,date,effective_at,occurred_on,details,household_id,source_system,
        source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
        values('accept-known-preopening',a,date '2026-09-22',timestamptz '2026-09-22 08:00+00',date '2026-09-22','{}',h,'acceptance',false,false,-10,'ZAR','accept-known-preopening');
    end if;
    cov:=pg_temp.acceptance_coverage(h,a);
    cov:=finance.budget_source_state_snapshot(h,cov);
    insert into finance.budget_reconciliations(id,household_id,as_of,actor_id,status,coverage_snapshot,
      opening_fund_cutover,notes)
      values(gen_random_uuid(),h,'2026-09-30 12:00+00',m,'complete',
        finance.budget_source_state_snapshot(h,cov),date '2026-09-23','initial acceptance cutover');
    insert into source_acceptance_fixtures values(h,m,a,f,c,v,l,cov);
  end loop;
end $fixture$;

-- Source rows are intentionally created after the frozen empty baseline.
insert into public.transactions(id,account_id,date,effective_at,occurred_on,details,household_id,source_system,
  source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
select x.tx,x.a,x.d,x.e,x.d,'{}',q.h,'acceptance',false,false,-10,'ZAR',x.tx
from (values
  ('accept-post-increase','00000000-0000-4000-8000-000000009a01'::uuid,date '2026-10-01',timestamptz '2026-10-01 08:00+00'),
  ('accept-decrease','00000000-0000-4000-8000-000000009a03'::uuid,date '2026-10-01',timestamptz '2026-10-01 08:00+00'),
  ('accept-metadata','00000000-0000-4000-8000-000000009a04'::uuid,date '2026-10-01',timestamptz '2026-10-01 08:00+00'),
  ('accept-purchase-posted','00000000-0000-4000-8000-000000009a05'::uuid,date '2026-10-01',timestamptz '2026-10-01 08:00+00'),
  ('accept-purchase-pending','00000000-0000-4000-8000-000000009a05'::uuid,date '2026-10-01',timestamptz '2026-10-01 08:01+00'),
  ('accept-future-pending','00000000-0000-4000-8000-000000009a06'::uuid,date '2026-09-29',timestamptz '2026-09-29 08:00+00'),
  ('accept-future-candidate','00000000-0000-4000-8000-000000009a06'::uuid,date '2026-10-10',timestamptz '2026-10-10 08:00+00'),
  ('accept-proposed-posted','00000000-0000-4000-8000-000000009a07'::uuid,date '2026-09-29',timestamptz '2026-09-29 08:00+00'),
  ('accept-proposed-pending','00000000-0000-4000-8000-000000009a07'::uuid,date '2026-09-29',timestamptz '2026-09-29 08:01+00')
) as x(tx,a,d,e)
join lateral (select a::text::uuid as a, (select household_id from public.accounts where account_id=x.a) as h) q on true;

update public.transactions set source_is_pending=true where id in ('accept-purchase-pending','accept-future-pending','accept-proposed-pending');
update public.transactions set raw_payload_hash='initial-metadata' where id='accept-metadata';

-- Classification/treatment are confirmed for reviewed rows.  The allocation
-- set and component precede the command receipt; the FK and split checks fire
-- at the end of the transaction.
do $reviewed$
declare r record; snap jsonb; cmd uuid; set_id uuid; alloc_id uuid;
begin
  for r in select * from source_acceptance_fixtures where household_id in (
    '00000000-0000-4000-8000-000000009801','00000000-0000-4000-8000-000000009802',
    '00000000-0000-4000-8000-000000009803','00000000-0000-4000-8000-000000009804',
    '00000000-0000-4000-8000-000000009808') loop
    execute format('insert into finance.transaction_classifications(id,household_id,transaction_id,category_id,decision_source,status) values (%L,%L,%L,%L,''user'',''confirmed'')',gen_random_uuid(),r.household_id,'accept-'||case when r.household_id::text like '%9801' then 'post-increase' when r.household_id::text like '%9802' then 'pre-increase' when r.household_id::text like '%9803' then 'decrease' when r.household_id::text like '%9804' then 'metadata' when r.household_id::text like '%9808' then 'known-preopening' else 'metadata' end,r.category_id);
    execute format('insert into finance.transaction_treatments(id,household_id,transaction_id,is_transfer,exclude_from_spend,nature,decision_source,status) values (%L,%L,%L,false,false,''consumption'',''user'',''confirmed'')',gen_random_uuid(),r.household_id,'accept-'||case when r.household_id::text like '%9801' then 'post-increase' when r.household_id::text like '%9802' then 'pre-increase' when r.household_id::text like '%9803' then 'decrease' when r.household_id::text like '%9804' then 'metadata' when r.household_id::text like '%9808' then 'known-preopening' else 'metadata' end);
    cmd:=gen_random_uuid(); set_id:=gen_random_uuid(); alloc_id:=gen_random_uuid();
    snap:=finance.budget_source_snapshot(r.household_id,'accept-'||case when r.household_id::text like '%9801' then 'post-increase' when r.household_id::text like '%9802' then 'pre-increase' when r.household_id::text like '%9803' then 'decrease' when r.household_id::text like '%9804' then 'metadata' when r.household_id::text like '%9808' then 'known-preopening' else 'metadata' end);
    execute format('insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id) values (%L,%L,%L,%L,%L,-1000,%L,1,''current'',%L,%L)',set_id,r.household_id,'accept-'||case when r.household_id::text like '%9801' then 'post-increase' when r.household_id::text like '%9802' then 'pre-increase' when r.household_id::text like '%9803' then 'decrease' when r.household_id::text like '%9804' then 'metadata' when r.household_id::text like '%9808' then 'known-preopening' else 'metadata' end,snap,snap->>'source_fingerprint',(snap->>'occurred_on')::date,r.member_id,cmd);
    insert into finance.budget_allocations(id,household_id,set_id,ordinal,amount_cents,fund_id,category_id,category_name_snapshot,beneficiary_scope,effect_kind)
      values(alloc_id,r.household_id,set_id,0,-1000,r.fund_id,r.category_id,'Acceptance','shared','consumption');
    insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result)
      values(r.household_id,cmd,'acceptance','{}',r.member_id,'{}');
  end loop;
end $reviewed$;

-- The engine must conserve signed money and never re-charge a reviewed ledger.
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009801'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009801'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','reviewed post-cutoff source starts at its frozen debit');
update public.transactions set amount=-15,raw_payload_hash='post-increased' where id='accept-post-increase';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009801'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009801'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1500','post-cutoff increase is charged once');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009801'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009801'),timestamptz '2026-10-02')->'fund_deltas'->>'00000000-0000-4000-8000-000000009b01'),'-500','post-cutoff increase adds only the extra fund claim');
select is((select source_amount_cents::text from finance.budget_allocation_sets where transaction_id='accept-post-increase' and status='current'),'-1000','authoritative reviewed fund ledger stays frozen');

update public.transactions set amount=-15,raw_payload_hash='pre-increased' where id='accept-pre-increase';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009802'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009802'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-500','before-cutoff increase charges only the extra debit');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009802'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009802'),timestamptz '2026-10-02')->'fund_deltas'->>'00000000-0000-4000-8000-000000009b02'),'-500','before-cutoff increase adds one extra fund claim');
select ok((finance.budget_source_exposure('00000000-0000-4000-8000-000000009808'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009808'),timestamptz '2026-10-02')->>'resource_delta_cents')='0' and coalesce((finance.budget_source_exposure('00000000-0000-4000-8000-000000009808'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009808'),timestamptz '2026-10-02')->'fund_deltas'->>'00000000-0000-4000-8000-000000009b08'),'0')='0','frozen posted pre-opening source does not debit resources or funds');

update public.transactions set amount=-5,raw_payload_hash='decreased' where id='accept-decrease';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','unreflected decrease retains frozen resource debit');
select is(coalesce((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->'fund_deltas'->>'00000000-0000-4000-8000-000000009b03'),'0'),'0','decrease does not release a fund claim');
update public.transactions set amount=0,raw_payload_hash='zeroed' where id='accept-decrease';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','zeroed unreflected source retains frozen resource debit');
update public.transactions set amount=1,raw_payload_hash='positive' where id='accept-decrease';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','positive replacement retains frozen resource debit');
update public.transactions set source_is_archived=true where id='accept-decrease';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','archive retains frozen resource debit');
select is((select source_amount_cents::text from finance.budget_allocation_sets where transaction_id='accept-decrease' and status='current'),'-1000','archive leaves reviewed ledger intact');
savepoint archived_frozen_source;
update public.transactions set source_is_archived=true where id='accept-known-preopening';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009808'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009808'),timestamptz '2026-10-02')->>'resource_delta_cents'),'0','archived pre-opening source was already reflected');
update public.transactions set source_is_archived=false,amount=-10,effective_at=timestamptz '2026-10-01 08:00+00',occurred_on=date '2026-10-01',raw_payload_hash='unreflected-frozen' where id='accept-decrease';
update source_acceptance_fixtures set coverage=finance.budget_source_state_snapshot(household_id,coverage) where household_id='00000000-0000-4000-8000-000000009803';
update public.transactions set source_is_archived=true where id='accept-decrease';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'complete'),'false','archived unreflected source present in frozen baseline is incomplete');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'provisional_known'),'true','archived frozen source keeps bounded provisional arithmetic');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009803'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009803'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','archived frozen source retains its resource debit');
rollback to archived_frozen_source;

update public.transactions set raw_payload_hash='metadata-only-drift' where id='accept-metadata';
select ok((finance.budget_source_exposure('00000000-0000-4000-8000-000000009804'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009804'),timestamptz '2026-10-02')->'reasons') @> '[{"code":"source_allocation_stale","transaction_id":"accept-metadata"}]'::jsonb,'metadata drift reports source allocation stale');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009804'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009804'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','metadata drift adds no extra claim');

-- A confirmed purchase group has one economic posted leg and one pending mirror.
insert into finance.financial_events(id,household_id,event_type,status) values('00000000-0000-4000-8000-000000009f05','00000000-0000-4000-8000-000000009805','purchase','confirmed');
insert into finance.financial_event_legs(id,household_id,event_id,transaction_id,leg_role,status) values
  ('00000000-0000-4000-8000-000000009f06','00000000-0000-4000-8000-000000009805','00000000-0000-4000-8000-000000009f05','accept-purchase-posted','economic_recognition','active'),
  ('00000000-0000-4000-8000-000000009f07','00000000-0000-4000-8000-000000009805','00000000-0000-4000-8000-000000009f05','accept-purchase-pending','mirror','active');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','unlisted confirmed purchase pair contributes one resource debit');
select ok(((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->'adjustments'->0->'source_ids') @> '["accept-purchase-posted","accept-purchase-pending"]'::jsonb),'purchase adjustment retains every source id');
savepoint purchase_balance_proof;
update public.transactions set effective_at=timestamptz '2026-09-29 08:00+00',occurred_on=date '2026-09-29' where id in ('accept-purchase-posted','accept-purchase-pending');
select ok((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->'reasons') @> '[{"code":"source_balance_inclusion_unknown"}]'::jsonb,'purchase identity does not prove pre-cutoff balance inclusion');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'provisional_known'),'false','purchase pair with unknown frozen inclusion is not provisional-known');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'resource_delta_cents'),null,'purchase pair with unknown frozen inclusion has no resource total');
rollback to purchase_balance_proof;
update source_acceptance_fixtures set coverage=jsonb_set(coverage,'{accounts,0,pending_included_ids}','["accept-purchase-pending"]'::jsonb) where household_id='00000000-0000-4000-8000-000000009805';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'resource_delta_cents'),'0','included purchase pair is not debited twice');
savepoint pending_economic_leg;
update finance.financial_event_legs set leg_role='economic_recognition' where transaction_id='accept-purchase-pending';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'provisional_known'),'false','pending economic leg is hard-unknown');
rollback to pending_economic_leg;
savepoint posted_mirror_leg;
update finance.financial_event_legs set leg_role='mirror' where transaction_id='accept-purchase-posted';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'provisional_known'),'false','posted mirror leg is hard-unknown');
rollback to posted_mirror_leg;

do $posted_review$
declare r record; s jsonb; cmd uuid:='00000000-0000-4000-8000-000000009f09'; sid uuid:='00000000-0000-4000-8000-000000009f0a';
begin
  select * into r from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805';
  s:=finance.budget_source_snapshot(r.household_id,'accept-purchase-posted');
  insert into finance.budget_allocation_sets(id,household_id,transaction_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,status,actor_id,command_id)
    values(sid,r.household_id,'accept-purchase-posted',s,s->>'source_fingerprint',-1000,date '2026-10-01',1,'current',r.member_id,cmd);
  insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,fund_id,category_id,category_name_snapshot,beneficiary_scope,effect_kind)
    values(r.household_id,sid,0,-1000,r.fund_id,r.category_id,'Acceptance','shared','consumption');
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values(r.household_id,cmd,'acceptance','{}',r.member_id,'{}');
end $posted_review$;
select is(coalesce((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->'fund_deltas'->>'00000000-0000-4000-8000-000000009b05'),'0'),'0','current posted allocation adds no second fund claim');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'resource_delta_cents'),'0','current posted purchase review keeps included mirror at zero resource delta');

-- A second economic leg invalidates identity; proposed evidence cannot collapse
-- rows, and a future candidate cannot create ambiguity with an old pending row.
insert into public.transactions(id,account_id,date,effective_at,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
values('accept-purchase-extra','00000000-0000-4000-8000-000000009a05',date '2026-10-01',timestamptz '2026-10-01 08:02+00',date '2026-10-01','{}','00000000-0000-4000-8000-000000009805','acceptance',false,false,-10,'ZAR','extra');
insert into finance.financial_event_legs(id,household_id,event_id,transaction_id,leg_role,status) values('00000000-0000-4000-8000-000000009f08','00000000-0000-4000-8000-000000009805','00000000-0000-4000-8000-000000009f05','accept-purchase-extra','economic_recognition','active');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'provisional_known'),'false','extra economic leg invalidates purchase identity');
update public.transactions set amount=0,raw_payload_hash='extra-zero' where id='accept-purchase-extra';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009805'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009805'),timestamptz '2026-10-02')->>'provisional_known'),'false','zero economic leg invalidates purchase identity');
select ok((finance.budget_source_exposure('00000000-0000-4000-8000-000000009806'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009806'),timestamptz '2026-10-02')->'reasons') @> '[{"code":"pending_activity_provisional"}]'::jsonb,'pending before cutoff is explicitly provisional');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009806'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009806'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','future posted candidate is excluded and pending remains one debit');
update public.transactions set effective_at=timestamptz '2026-09-22 08:00+00',occurred_on=date '2026-09-22',raw_payload_hash='pre-opening-pending' where id='accept-future-pending';
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009806'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009806'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1000','pending pre-opening source still reserves its debit');
insert into public.transactions(id,account_id,date,effective_at,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
values('accept-pre-opening-late','00000000-0000-4000-8000-000000009a06',date '2026-09-22',timestamptz '2026-09-22 08:01+00',date '2026-09-22','{}','00000000-0000-4000-8000-000000009806','acceptance',false,false,-11,'ZAR','pre-opening-late');
select ok((finance.budget_source_exposure('00000000-0000-4000-8000-000000009806'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009806'),timestamptz '2026-10-02')->'reasons') @> '[{"code":"source_balance_inclusion_unknown"}]'::jsonb,'late pre-opening posted source absent from frozen baseline is unknown');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009806'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009806'),timestamptz '2026-10-02')->>'resource_delta_cents'),null,'pre-opening unknown inclusion has no asserted resource total');

insert into finance.financial_events(id,household_id,event_type,status) values('00000000-0000-4000-8000-000000009f0b','00000000-0000-4000-8000-000000009807','purchase','proposed');
insert into finance.financial_event_legs(id,household_id,event_id,transaction_id,leg_role,status) values
  ('00000000-0000-4000-8000-000000009f0c','00000000-0000-4000-8000-000000009807','00000000-0000-4000-8000-000000009f0b','accept-proposed-posted','economic_recognition','active'),
  ('00000000-0000-4000-8000-000000009f0d','00000000-0000-4000-8000-000000009807','00000000-0000-4000-8000-000000009f0b','accept-proposed-pending','mirror','active');
select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009807'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009807'),timestamptz '2026-10-02')->>'provisional_known'),'false','proposed event evidence cannot collapse source rows');

select is((finance.budget_source_exposure('00000000-0000-4000-8000-000000009801'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009801'),timestamptz '2026-10-02')->>'resource_delta_cents'),'-1500'::text,'signed aggregate remains a decimal string');
select ok((jsonb_typeof((finance.budget_source_exposure('00000000-0000-4000-8000-000000009801'::uuid,(select coverage from source_acceptance_fixtures where household_id='00000000-0000-4000-8000-000000009801'),timestamptz '2026-10-02')->'fund_deltas'))='object'),'fund aggregates remain checked JSON objects');
select throws_ok($q$select finance.budget_checked_bigint(9223372036854775808::numeric)$q$,'P0001','budget_invalid: numeric result is outside bigint','monetary overflow is typed budget_invalid');

savepoint acceptance_rollback;
insert into public.transactions(id,account_id,date,occurred_on,details,household_id,source_system,source_is_pending,source_is_archived,amount,currency_code,raw_payload_hash)
values('accept-rollback','00000000-0000-4000-8000-000000009a01',date '2026-10-01',date '2026-10-01','{}','00000000-0000-4000-8000-000000009801','acceptance',false,false,-1,'ZAR','rollback');
rollback to acceptance_rollback;
select is((select count(*)::integer from public.transactions where id='accept-rollback'),0,'fixture mutation rolls back cleanly');

select * from finish();
rollback;
