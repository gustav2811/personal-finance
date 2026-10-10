-- Stage 4: restricted claims and household-safe utility recognition.
-- Implementation follows the frozen stage-4 manifest in the parent task.

-- Ownership is deliberately opt-in.  This migration never infers an owner from
-- a location, source, or the fact that a database happens to contain one
-- household.
alter table consumption.devices add column if not exists household_id uuid;
alter table consumption.ledger_entries add column if not exists household_id uuid;
alter table consumption.devices add constraint consumption_devices_household_fk
  foreign key (household_id) references finance.households(id) not valid;
alter table consumption.ledger_entries add constraint consumption_ledger_entries_household_fk
  foreign key (household_id) references finance.households(id) not valid;
create index if not exists consumption_devices_household_idx on consumption.devices(household_id) where household_id is not null;
create index if not exists consumption_ledger_entries_household_idx on consumption.ledger_entries(household_id) where household_id is not null;

create or replace function consumption.validate_budget_ownership()
returns trigger language plpgsql security definer set search_path = pg_temp as $$
declare parent_household uuid; device_household uuid; supplied_household uuid;
begin
  if tg_table_name = 'devices' then
    if tg_op = 'UPDATE' and old.household_id is not null and new.household_id is distinct from old.household_id then
      raise exception using errcode='P0001', message='budget_forbidden: device ownership is immutable';
    end if;
    if new.parent_device_id is not null then
      select household_id into parent_household from consumption.devices where id=new.parent_device_id;
      if new.household_id is not null and parent_household is distinct from new.household_id then
        raise exception using errcode='P0001', message='budget_invalid: child device household must match owned parent';
      end if;
      if parent_household is not null and new.household_id is null then
        raise exception using errcode='P0001', message='budget_invalid: child device household must match owned parent';
      end if;
    end if;
  else
    supplied_household := new.household_id;
    select household_id into device_household from consumption.devices where id=new.device_id;
    -- The ingest batch has no household field.  Ownership is always copied from
    -- its selected device before the equality invariant is checked.
    if supplied_household is not null and supplied_household is distinct from device_household then
      raise exception using errcode='P0001', message='budget_invalid: ledger ownership must derive from device';
    end if;
    new.household_id := device_household;
  end if;
  return new;
end $$;
drop trigger if exists consumption_devices_budget_ownership on consumption.devices;
create trigger consumption_devices_budget_ownership before insert or update of household_id,parent_device_id on consumption.devices
for each row execute function consumption.validate_budget_ownership();
drop trigger if exists consumption_ledger_entries_budget_ownership on consumption.ledger_entries;
create trigger consumption_ledger_entries_budget_ownership before insert or update of household_id,device_id on consumption.ledger_entries
for each row execute function consumption.validate_budget_ownership();

-- The existing batch upsert must derive ownership on every update.  This keeps
-- service ingestion compatible while denying callers an ownership field.
create or replace function consumption.derive_ledger_household()
returns trigger language plpgsql security definer set search_path = pg_temp as $$
begin
  select d.household_id into new.household_id from consumption.devices d where d.id=new.device_id;
  return new;
end $$;
drop trigger if exists consumption_ledger_entries_derive_household on consumption.ledger_entries;

create or replace function public.provision_consumption_device_ownership_v1(
  p_household_id uuid, p_device_id uuid, p_evidence text
) returns jsonb language plpgsql security definer set search_path = pg_temp as $$
declare v_device consumption.devices%rowtype; v_role text;
begin
  v_role := coalesce(current_setting('request.jwt.claim.role',true),'');
  if current_user <> 'service_role' and v_role <> 'service_role' then
    raise exception using errcode='P0001', message='budget_forbidden: service_role required';
  end if;
  if p_household_id is null or p_device_id is null or nullif(btrim(p_evidence),'') is null then
    raise exception using errcode='P0001', message='budget_invalid: ownership evidence';
  end if;
  perform 1 from finance.households where id=p_household_id for update;
  if not found then raise exception using errcode='P0001', message='budget_not_found: household'; end if;
  select * into v_device from consumption.devices where id=p_device_id for update;
  if not found then raise exception using errcode='P0001', message='budget_not_found: device'; end if;
  if v_device.household_id is not null and v_device.household_id <> p_household_id then
    raise exception using errcode='P0001', message='budget_conflict: device is owned by another household';
  end if;
  if v_device.parent_device_id is not null and exists (
    select 1 from consumption.devices p where p.id=v_device.parent_device_id
      and p.household_id is distinct from p_household_id
  ) then raise exception using errcode='P0001', message='budget_invalid: parent household'; end if;
  if exists (select 1 from consumption.devices child where child.parent_device_id=p_device_id and child.household_id is distinct from p_household_id) then
    raise exception using errcode='P0001', message='budget_invalid: child household';
  end if;
  update consumption.devices set household_id=p_household_id,
    metadata=metadata || jsonb_build_object('budget_ownership_evidence',btrim(p_evidence),'budget_ownership_provisioned_at',statement_timestamp())
  where id=p_device_id;
  return jsonb_build_object('device_id',p_device_id::text,'household_id',p_household_id::text);
end $$;
revoke all on function public.provision_consumption_device_ownership_v1(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.provision_consumption_device_ownership_v1(uuid,uuid,text) to service_role;

-- Members only see sources explicitly bound to their household.  Ingest retains
-- its service-role table privileges and no member receives direct writes.
-- Policies on a table are OR-combined.  Remove the earlier dashboard-wide
-- policies before adding the household predicates below.
drop policy if exists dashboard_users_read_devices on consumption.devices;
drop policy if exists dashboard_users_read_ledger_entries on consumption.ledger_entries;
drop policy if exists consumption_devices_household_read on consumption.devices;
create policy consumption_devices_household_read on consumption.devices for select to authenticated
using (household_id is not null and finance.is_household_member(household_id));
drop policy if exists consumption_ledger_entries_household_read on consumption.ledger_entries;
create policy consumption_ledger_entries_household_read on consumption.ledger_entries for select to authenticated
using (household_id is not null and finance.is_household_member(household_id));

-- An event leg has exactly one source.  Existing transaction legs remain valid.
alter table finance.financial_event_legs alter column transaction_id drop not null;
alter table finance.financial_event_legs add column if not exists utility_entry_id uuid references consumption.ledger_entries(id);
alter table finance.financial_event_legs add constraint financial_event_legs_one_source
  check ((transaction_id is not null) <> (utility_entry_id is not null)) not valid;
alter table finance.financial_event_legs validate constraint financial_event_legs_one_source;
drop index if exists finance.financial_event_legs_one_active;
create unique index financial_event_legs_one_active_transaction on finance.financial_event_legs(transaction_id) where status='active' and transaction_id is not null;
create unique index financial_event_legs_one_active_utility on finance.financial_event_legs(utility_entry_id) where status='active' and utility_entry_id is not null;
create or replace function finance.validate_event_leg_source()
returns trigger language plpgsql security definer set search_path = pg_temp as $$
declare h uuid;
begin
  if new.utility_entry_id is not null then
    select household_id into h from consumption.ledger_entries where id=new.utility_entry_id;
    if h is distinct from new.household_id then raise exception using errcode='P0001', message='budget_invalid: utility event leg household'; end if;
  elsif new.transaction_id is not null and not exists(select 1 from public.transactions where id=new.transaction_id and household_id=new.household_id) then
    raise exception using errcode='P0001', message='budget_invalid: transaction event leg household';
  end if;
  if not exists(select 1 from finance.financial_events where id=new.event_id and household_id=new.household_id) then
    raise exception using errcode='P0001', message='budget_invalid: event leg household';
  end if;
  return new;
end $$;
drop trigger if exists financial_event_legs_validate_source on finance.financial_event_legs;
create trigger financial_event_legs_validate_source before insert or update on finance.financial_event_legs
for each row execute function finance.validate_event_leg_source();

alter table finance.budget_allocation_sets drop constraint if exists budget_allocation_sets_utility_entry_id_check;
alter table finance.budget_allocation_sets drop constraint if exists budget_allocation_sets_check;
alter table finance.budget_allocation_sets add constraint budget_allocation_sets_source_xor
  check ((transaction_id is not null) <> (utility_entry_id is not null)) not valid;
alter table finance.budget_allocation_sets validate constraint budget_allocation_sets_source_xor;
drop trigger if exists budget_allocation_sets_utility_disabled on finance.budget_allocation_sets;

create or replace function finance.budget_utility_snapshot(p_household_id uuid,p_utility_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_temp set timezone='UTC' as $$
declare l consumption.ledger_entries%rowtype; d consumption.devices%rowtype; body jsonb; cents bigint; signed bigint; reasons jsonb:='[]'::jsonb;
begin
  select * into l from consumption.ledger_entries where id=p_utility_entry_id; if not found then perform finance.budget_fail('budget_forbidden','utility source'); end if;
  select * into d from consumption.devices where id=l.device_id; if not found or l.household_id is distinct from p_household_id or d.household_id is distinct from p_household_id then perform finance.budget_fail('budget_forbidden','utility source'); end if;
  if l.currency <> 'ZAR' then reasons:=reasons||jsonb_build_array('currency_invalid'); end if;
  if l.amount*100 <> trunc(l.amount*100) or l.amount*100 > 9223372036854775807::numeric then reasons:=reasons||jsonb_build_array('amount_invalid'); else cents:=(l.amount*100)::bigint; end if;
  if l.entry_type not in ('usage_charge','fee','deposit','correction') then reasons:=reasons||jsonb_build_array('entry_type_unsupported'); end if;
  if l.occurred_at is null then reasons:=reasons||jsonb_build_array('occurred_at_missing'); end if;
  if l.entry_type in ('usage_charge','fee') then signed := -cents; elsif l.entry_type='correction' then signed:=case when l.direction='debit' then -cents else cents end; else signed:=0; end if;
  body:=jsonb_build_object('utility_entry_id',l.id::text,'household_id',p_household_id::text,'device_id',d.id::text,'source',l.source,'source_record_id',l.source_record_id,'utility_type',l.utility_type,'entry_type',l.entry_type,'direction',l.direction,'amount_cents',case when cents is null then null else cents::text end,'signed_amount_cents',case when signed is null then null else signed::text end,'currency',l.currency,'occurred_at',l.occurred_at,'posted_at',l.posted_at,'raw_event_id',l.raw_event_id::text,'complete',jsonb_array_length(reasons)=0,'reasons',reasons);
  return body || jsonb_build_object('source_fingerprint',finance.budget_hash(body));
end $$;

create or replace function finance.budget_earmark_payload(p_value jsonb, p_require_reconciliation boolean default false)
returns jsonb language plpgsql immutable set search_path=pg_temp as $$
declare v_link jsonb; v_count integer; v_amount bigint;
begin
  perform finance.budget_validate_object(p_value,
    case when p_require_reconciliation then array['fund_id','restricted_account_id','amount_cents','effective_on','reason','expected_reconciliation_id','expected_reconciliation_fingerprint','link'] else array['fund_id','restricted_account_id','amount_cents','reason'] end,
    case when p_require_reconciliation then array[]::text[] else array[]::text[] end);
  v_amount:=finance.budget_cents(p_value,'amount_cents'); if v_amount=0 then perform finance.budget_fail('budget_invalid','earmark amount'); end if;
  v_link:=p_value->'link';
  if p_require_reconciliation then
    perform finance.budget_validate_object(v_link,array[]::text[],array['fund_movement_id','allocation_id','financial_event_id','reconciliation_id']);
    v_count:=((v_link->>'fund_movement_id') is not null)::integer+((v_link->>'allocation_id') is not null)::integer+((v_link->>'financial_event_id') is not null)::integer+((v_link->>'reconciliation_id') is not null)::integer;
    if v_count<>1 then perform finance.budget_fail('budget_invalid','earmark link'); end if;
    perform finance.budget_uuid(v_link,'fund_movement_id',true);
    perform finance.budget_uuid(v_link,'allocation_id',true);
    perform finance.budget_uuid(v_link,'financial_event_id',true);
    perform finance.budget_uuid(v_link,'reconciliation_id',true);
  else v_link:=jsonb_build_object('fund_movement_id',null,'allocation_id',null,'financial_event_id',null,'reconciliation_id',null); end if;
  return jsonb_build_object('fund_id',finance.budget_uuid(p_value,'fund_id')::text,'restricted_account_id',finance.budget_uuid(p_value,'restricted_account_id')::text,'amount_cents',v_amount::text,'effective_on',case when p_require_reconciliation then finance.budget_date(p_value,'effective_on')::text else null end,'reason',finance.budget_text(p_value,'reason'),'expected_reconciliation_id',case when p_require_reconciliation then finance.budget_uuid(p_value,'expected_reconciliation_id')::text else null end,'expected_reconciliation_fingerprint',case when p_require_reconciliation then finance.budget_text(p_value,'expected_reconciliation_fingerprint') else null end,'link',v_link);
end $$;

create or replace function finance.budget_earmark_capacity(p_household uuid,p_account uuid,p_reconciliation uuid)
returns bigint language plpgsql stable security definer set search_path=pg_temp as $$
declare x jsonb; v text;
begin
  select value into x from finance.budget_reconciliations r, lateral jsonb_array_elements(r.coverage_snapshot->'accounts') value
  where r.household_id=p_household and r.id=p_reconciliation and value->>'account_id'=p_account::text;
  v:=coalesce(x->>'eligible_restricted_cents',x->'observation'->>'eligible_restricted_cents');
  if v is null or v !~ '^[0-9]+$' then perform finance.budget_fail('budget_incomplete','restricted capacity is unverified'); end if;
  return v::bigint;
end $$;

create or replace function finance.budget_validate_earmark_final(p_household uuid,p_asof date,p_reconciliation uuid)
returns void language plpgsql security definer set search_path=pg_temp as $$
declare r record; d date; claimed numeric; capacity bigint; balance bigint;
begin
  -- A backdated claim must remain valid after every later movement, allocation,
  -- or claim correction, not only at its own effective date.
  for d in
    select p_asof union
    select effective_on from finance.fund_earmarks where household_id=p_household and effective_on>p_asof
    union select effective_on from finance.fund_movements where household_id=p_household and effective_on>p_asof
    union select s.occurred_on from finance.budget_allocation_sets s where s.household_id=p_household and s.occurred_on>p_asof and s.status in ('current','needs_review')
    order by 1
  loop
    for r in select distinct fund_id from finance.fund_earmarks where household_id=p_household and effective_on<=d loop
      select coalesce(sum(amount_cents),0) into claimed from finance.fund_earmarks where household_id=p_household and fund_id=r.fund_id and effective_on<=d;
      select balance_cents into balance from finance.budget_fund_balances(p_household,d) where fund_id=r.fund_id;
      if claimed < 0 or claimed > greatest(coalesce(balance,0),0) then perform finance.budget_fail('budget_insufficient','earmark fund claim'); end if;
    end loop;
    for r in select distinct restricted_account_id from finance.fund_earmarks where household_id=p_household and effective_on<=d loop
      select coalesce(sum(amount_cents),0) into claimed from finance.fund_earmarks where household_id=p_household and restricted_account_id=r.restricted_account_id and effective_on<=d;
      capacity:=finance.budget_earmark_capacity(p_household,r.restricted_account_id,p_reconciliation);
      if claimed < 0 or claimed > capacity then perform finance.budget_fail('budget_insufficient','earmark restricted capacity'); end if;
    end loop;
  end loop;
end $$;

create or replace function finance.budget_insert_earmark(p_household uuid,p_actor uuid,p_command uuid,p_earmark jsonb,p_reconciliation uuid,p_effective date,p_link jsonb)
returns uuid language plpgsql security definer set search_path=pg_temp as $$
declare v_id uuid; v_fund uuid:=(p_earmark->>'fund_id')::uuid; v_account uuid:=(p_earmark->>'restricted_account_id')::uuid;
begin
  perform 1 from finance.funds where household_id=p_household and id=v_fund for update; if not found then perform finance.budget_fail('budget_forbidden','earmark fund'); end if;
  perform 1 from public.accounts a join finance.budget_account_settings s on s.household_id=a.household_id and s.account_id=a.account_id
    where a.household_id=p_household and a.account_id=v_account and s.included and s.resource_class in ('restricted','mortgage') for update;
  if not found then perform finance.budget_fail('budget_invalid','restricted account'); end if;
  if p_link->>'fund_movement_id' is not null and not exists(select 1 from finance.fund_movements where household_id=p_household and id=(p_link->>'fund_movement_id')::uuid) then perform finance.budget_fail('budget_forbidden','earmark movement link'); end if;
  if p_link->>'allocation_id' is not null and not exists(select 1 from finance.budget_allocations where household_id=p_household and id=(p_link->>'allocation_id')::uuid) then perform finance.budget_fail('budget_forbidden','earmark allocation link'); end if;
  if p_link->>'financial_event_id' is not null and not exists(select 1 from finance.financial_events where household_id=p_household and id=(p_link->>'financial_event_id')::uuid) then perform finance.budget_fail('budget_forbidden','earmark event link'); end if;
  if p_link->>'reconciliation_id' is not null and not exists(select 1 from finance.budget_reconciliations where household_id=p_household and id=(p_link->>'reconciliation_id')::uuid) then perform finance.budget_fail('budget_forbidden','earmark reconciliation link'); end if;
  if p_link->>'correction_of' is not null and not exists(select 1 from finance.fund_earmarks where household_id=p_household and id=(p_link->>'correction_of')::uuid) then perform finance.budget_fail('budget_forbidden','earmark correction link'); end if;
  insert into finance.fund_earmarks(household_id,fund_id,restricted_account_id,amount_cents,effective_on,actor_id,command_id,fund_movement_id,allocation_id,financial_event_id,reconciliation_id,correction_of,reason)
  values(p_household,v_fund,v_account,(p_earmark->>'amount_cents')::bigint,p_effective,p_actor,p_command,
    nullif(p_link->>'fund_movement_id','')::uuid,nullif(p_link->>'allocation_id','')::uuid,nullif(p_link->>'financial_event_id','')::uuid,nullif(p_link->>'reconciliation_id','')::uuid,nullif(p_link->>'correction_of','')::uuid,p_earmark->>'reason') returning id into v_id;
  return v_id;
end $$;

create or replace function public.budget_change_earmark_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare p jsonb; replay jsonb; h uuid; actor uuid; rec finance.budget_reconciliations%rowtype; eid uuid; result jsonb;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then perform finance.budget_fail('budget_forbidden','authenticated caller required'); end if;
  perform finance.bind_household_member();
  if not exists(select 1 from finance.household_members where auth_user_id=auth.uid()) then perform finance.budget_fail('budget_forbidden','household member required'); end if;
  p:=finance.budget_earmark_payload(p_payload,true);
  replay:=finance.budget_begin_command(p_command_id,'budget_change_earmark_v1',p); if replay is not null then return replay; end if;
  h:=finance.resolve_caller_household(); actor:=finance.budget_actor_member(h); perform 1 from finance.households where id=h for update;
  select * into rec from finance.budget_reconciliations where household_id=h and id=(p->>'expected_reconciliation_id')::uuid and status='complete' for update;
  if not found then perform finance.budget_fail('budget_incomplete','complete reconciliation'); end if;
  if finance.budget_reconciliation_state(h,rec.id,statement_timestamp())->>'reconciliation_fingerprint' is distinct from p->>'expected_reconciliation_fingerprint' then perform finance.budget_fail('budget_stale','reconciliation'); end if;
  set constraints all deferred;
  eid:=finance.budget_insert_earmark(h,actor,p_command_id,p,rec.id,(p->>'effective_on')::date,p->'link');
  perform finance.budget_validate_earmark_final(h,(p->>'effective_on')::date,rec.id);
  result:=finance.budget_finish_command(p_command_id,'budget_change_earmark_v1',p,jsonb_build_object('earmark_id',eid::text));
  set constraints all immediate;
  return result;
end $$;

-- Replace the PR3 restriction with actual restricted totals.  Claims are not
-- cash: they reduce only the liquid portion of a fund and never inflate income.
create or replace function finance.budget_fund_balances(p_household uuid,p_asof date)
returns table(fund_id uuid,balance_cents bigint,assigned_cents bigint,outflow_cents bigint,refund_cents bigint,restricted_cents bigint)
language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare f record; cutover date; movement numeric; assigned numeric; outflow numeric; refund numeric; allocation_delta numeric; restricted numeric;
begin
  cutover:=finance.budget_opening_cutover(p_household);
  for f in select id from finance.funds where household_id=p_household order by id loop
    select coalesce(sum(case when m.to_fund_id=f.id then m.amount_cents when m.from_fund_id=f.id then -m.amount_cents else 0 end),0)::numeric
      into movement from finance.fund_movements m where m.household_id=p_household and m.effective_on<=p_asof and (m.to_fund_id=f.id or m.from_fund_id=f.id);
    assigned:=movement;
    select coalesce(sum(case when a.amount_cents<0 and a.effect_kind in ('consumption','contribution','required_debt_payment','extra_debt_payment') then -(a.amount_cents::numeric) else 0 end),0),coalesce(sum(case when a.amount_cents>0 and a.effect_kind='refund' then a.amount_cents::numeric else 0 end),0),coalesce(sum(a.amount_cents::numeric) filter (where cutover is not null and s.occurred_on>=cutover),0)
      into outflow,refund,allocation_delta from finance.budget_allocations a join finance.budget_allocation_sets s on s.household_id=a.household_id and s.id=a.set_id where a.household_id=p_household and a.fund_id=f.id and s.status in ('current','needs_review') and s.occurred_on<=p_asof;
    select coalesce(sum(e.amount_cents::numeric),0) into restricted from finance.fund_earmarks e where e.household_id=p_household and e.fund_id=f.id and e.effective_on<=p_asof;
    fund_id:=f.id;
    balance_cents:=finance.budget_checked_bigint(movement+allocation_delta);
    assigned_cents:=finance.budget_checked_bigint(assigned);
    outflow_cents:=finance.budget_checked_bigint(outflow);
    refund_cents:=finance.budget_checked_bigint(refund);
    restricted_cents:=finance.budget_checked_bigint(restricted);
    return next;
  end loop;
end
$$;

drop trigger if exists budget_earmarks_disabled on finance.fund_earmarks;

-- Keep the proven bank command byte-for-byte available behind a private name;
-- the public dispatcher adds the utility branch without changing bank behavior.
alter function public.budget_review_allocation_v1(uuid,jsonb) set schema finance;
alter function finance.budget_review_allocation_v1(uuid,jsonb) rename to budget_review_allocation_bank_v1;

create or replace function public.budget_review_allocation_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare h uuid; actor uuid; p jsonb; replay jsonb; snap jsonb; entry uuid; current_set finance.budget_allocation_sets%rowtype;
  new_set uuid; alloc uuid; ids jsonb:='[]'::jsonb; c jsonb; amount bigint; total bigint:=0; ord int:=0; effect text; fund uuid; v_event_id uuid; expected_current uuid; evidence jsonb; signed bigint; occurred date; old_claim finance.fund_earmarks%rowtype; claim_alloc uuid; v_reconciliation uuid;
begin
  -- A prior bank call in the same SQL transaction may have left an envelope.
  -- Only the current bank dispatch below is allowed to establish one.
  perform set_config('finance.stage4_earmarks','',true);
  -- Check source XOR before dispatching so the legacy parser cannot turn the
  -- established source error into an incidental unknown-key error.
  if p_payload ? 'transaction_id' and p_payload->'transaction_id' <> 'null'::jsonb
     and p_payload ? 'utility_entry_id' and p_payload->'utility_entry_id' <> 'null'::jsonb then
    perform finance.budget_fail('budget_invalid','exactly one source');
  end if;
  if coalesce(p_payload ? 'utility_entry_id',false) is not true or p_payload->'utility_entry_id'='null'::jsonb then
    if jsonb_typeof(coalesce(p_payload->'earmarks','[]'::jsonb))<>'array' then perform finance.budget_fail('budget_invalid','earmarks'); end if;
    -- Preserve PR2's canonical empty form.  In particular, do not add an
    -- earmarks key when replaying a historical bank command that had none.
    if not (p_payload ? 'earmarks') or jsonb_array_length(coalesce(p_payload->'earmarks','[]'::jsonb))=0 then
      perform set_config('finance.stage4_earmarks','',true);
      return finance.budget_review_allocation_bank_v1(p_command_id,p_payload);
    end if;
    perform set_config('finance.stage4_earmarks',jsonb_build_object('kind','allocation','canonical_payload',p_payload,'earmarks',coalesce(p_payload->'earmarks','[]'::jsonb))::text,true);
    return finance.budget_review_allocation_bank_v1(p_command_id,p_payload-'earmarks');
  end if;
  -- Authorization is deliberately before the human decision payload.  An
  -- unowned or foreign source must never disclose which review fields it needs.
  entry:=finance.budget_uuid(p_payload,'utility_entry_id');
  h:=finance.resolve_caller_household(); actor:=finance.budget_actor_member(h); perform 1 from finance.households where id=h for update;
  perform 1 from consumption.ledger_entries where id=entry for update;
  snap:=finance.budget_utility_snapshot(h,entry);
  if snap->>'source_fingerprint'<>finance.budget_text(p_payload,'expected_source_fingerprint') then perform finance.budget_fail('budget_stale','source fingerprint'); end if;
  perform finance.budget_validate_object(p_payload,array['utility_entry_id','expected_source_fingerprint','components','evidence'],array['expected_current_set_id','earmarks']);
  expected_current:=finance.budget_uuid(p_payload,'expected_current_set_id',true);
  if jsonb_typeof(p_payload->'components')<>'array' or jsonb_array_length(p_payload->'components')=0 then perform finance.budget_fail('budget_invalid','components'); end if;
  evidence:=p_payload->'evidence'; perform finance.budget_validate_object(evidence,array['utility_decision_reference'],array['receipt_reference','split_review_reason','review_reason']); perform finance.budget_text(evidence,'utility_decision_reference');
  p:=jsonb_build_object('utility_entry_id',entry::text,'expected_source_fingerprint',finance.budget_text(p_payload,'expected_source_fingerprint'),'expected_current_set_id',expected_current::text,'components',p_payload->'components','evidence',evidence,'earmarks',coalesce(p_payload->'earmarks','[]'::jsonb));
  if jsonb_typeof(p->'earmarks')<>'array' then perform finance.budget_fail('budget_invalid','earmarks'); end if;
  replay:=finance.budget_begin_command(p_command_id,'budget_review_allocation_v1',p); if replay is not null then return replay; end if;
  -- The owned source was locked and snapshotted before payload-specific review validation.
  if snap->>'source_fingerprint'<>p->>'expected_source_fingerprint' then perform finance.budget_fail('budget_stale','source fingerprint'); end if;
  if not coalesce((snap->>'complete')::boolean,false) then perform finance.budget_fail('budget_incomplete','utility source'); end if;
  select * into current_set from finance.budget_allocation_sets where household_id=h and utility_entry_id=entry and status in ('current','needs_review') for update;
  if expected_current is distinct from current_set.id then perform finance.budget_fail('budget_stale','current allocation'); end if;
  set constraints all deferred;
  if current_set.id is not null then
    -- Supersession never deletes history: it appends the exact inverse of every
    -- old allocation-linked claim before the replacement is made live.
    for old_claim in select e.* from finance.fund_earmarks e join finance.budget_allocations a on a.household_id=e.household_id and a.id=e.allocation_id where e.household_id=h and a.set_id=current_set.id loop
      insert into finance.fund_earmarks(household_id,fund_id,restricted_account_id,amount_cents,effective_on,actor_id,command_id,allocation_id,reason)
      values(h,old_claim.fund_id,old_claim.restricted_account_id,-old_claim.amount_cents,old_claim.effective_on,actor,p_command_id,old_claim.allocation_id,'reverse: superseded utility allocation');
    end loop;
    update finance.budget_allocation_sets set status='superseded' where id=current_set.id;
  end if;
  signed:=(snap->>'signed_amount_cents')::bigint; occurred:=(snap->>'occurred_at')::timestamptz::date;
  insert into finance.budget_allocation_sets(household_id,utility_entry_id,source_snapshot,source_fingerprint,source_amount_cents,occurred_on,revision_number,supersedes_id,actor_id,command_id,evidence)
  values(h,entry,snap,snap->>'source_fingerprint',signed,occurred,coalesce(current_set.revision_number,0)+1,current_set.id,actor,p_command_id,evidence) returning id into new_set;
  for c in select value from jsonb_array_elements(p->'components') loop
    perform finance.budget_validate_object(c,array['amount_cents','beneficiary_scope','effect_kind'],array['fund_id','category_id','category_name_snapshot','beneficiary_member_id','paid_by_member_id','payment_account_id','original_refund_allocation_id','opening_refund_reason','financial_event_id']);
    amount:=finance.budget_cents(c,'amount_cents'); effect:=finance.budget_text(c,'effect_kind'); fund:=finance.budget_uuid(c,'fund_id',true); v_event_id:=finance.budget_uuid(c,'financial_event_id',true); total:=total+amount;
    if finance.budget_text(c,'beneficiary_scope') not in ('shared','member') then perform finance.budget_fail('budget_invalid','beneficiary scope'); end if;
    if (snap->>'entry_type') in ('usage_charge','fee') and not (effect in ('consumption','contribution','required_debt_payment','extra_debt_payment','refund') and ((amount<0 and effect<>'refund' and fund is not null) or (amount>0 and effect='refund' and fund is not null))) then perform finance.budget_fail('budget_invalid','utility charge economics'); end if;
    if (snap->>'entry_type')='deposit' and not (effect='movement' and amount=0 and fund is null) then perform finance.budget_fail('budget_invalid','utility deposit is resource movement'); end if;
    if v_event_id is not null and not exists(select 1 from finance.financial_event_legs l where l.household_id=h and l.event_id=v_event_id and l.utility_entry_id=entry and l.status='active') then perform finance.budget_fail('budget_invalid','utility financial event'); end if;
    if fund is not null and not exists(select 1 from finance.funds where household_id=h and id=fund) then perform finance.budget_fail('budget_forbidden','fund'); end if;
    insert into finance.budget_allocations(household_id,set_id,ordinal,amount_cents,fund_id,category_id,category_name_snapshot,beneficiary_scope,beneficiary_member_id,paid_by_member_id,payment_account_id,effect_kind,original_refund_allocation_id,opening_refund_reason,financial_event_id)
    values(h,new_set,ord,amount,fund,finance.budget_uuid(c,'category_id',true),finance.budget_text(c,'category_name_snapshot',true),finance.budget_text(c,'beneficiary_scope'),finance.budget_uuid(c,'beneficiary_member_id',true),finance.budget_uuid(c,'paid_by_member_id',true),finance.budget_uuid(c,'payment_account_id',true),effect,finance.budget_uuid(c,'original_refund_allocation_id',true),finance.budget_text(c,'opening_refund_reason',true),v_event_id) returning id into alloc;
    ids:=ids||jsonb_build_array(alloc::text); ord:=ord+1;
  end loop;
  if total<>signed then perform finance.budget_fail('budget_invalid','component sum'); end if;
  if jsonb_array_length(p->'earmarks')>0 then
    select id into v_reconciliation from finance.budget_reconciliations where household_id=h and status='complete' order by as_of desc,recorded_at desc limit 1;
    for c,ord in select value,ordinality::int from jsonb_array_elements(p->'earmarks') with ordinality loop
      if ord > jsonb_array_length(ids) then perform finance.budget_fail('budget_invalid','earmark allocation link'); end if;
      c:=finance.budget_earmark_payload(c,false);
      claim_alloc:=(ids->>(ord-1))::uuid;
      perform finance.budget_insert_earmark(h,actor,p_command_id,c,v_reconciliation,occurred,jsonb_build_object('fund_movement_id',null,'allocation_id',claim_alloc::text,'financial_event_id',null,'reconciliation_id',null));
    end loop;
  end if;
  select id into v_reconciliation from finance.budget_reconciliations where household_id=h and status='complete' order by as_of desc,recorded_at desc limit 1;
  perform finance.budget_validate_earmark_final(h,occurred,v_reconciliation);
  perform finance.budget_finish_command(p_command_id,'budget_review_allocation_v1',p,jsonb_build_object('set_id',new_set::text,'revision_number',coalesce(current_set.revision_number,0)+1,'allocation_ids',ids,'source_fingerprint',snap->>'source_fingerprint'));
  set constraints all immediate;
  return jsonb_build_object('set_id',new_set::text,'revision_number',coalesce(current_set.revision_number,0)+1,'allocation_ids',ids,'source_fingerprint',snap->>'source_fingerprint');
end $$;

-- PR2 movement mechanics remain the authority for balances and backing.  The
-- small wrapper makes a supplied claim part of the same SQL transaction and
-- records reversal claims against a correction's reversal movement.
alter function public.budget_move_funds_v1(uuid,jsonb) set schema finance;
alter function finance.budget_move_funds_v1(uuid,jsonb) rename to budget_move_funds_v1_legacy;
create or replace function public.budget_move_funds_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare raw jsonb:=coalesce(p_payload->'earmarks','[]'::jsonb); clean jsonb; result jsonb; e jsonb;
begin
  if jsonb_typeof(raw)<>'array' then perform finance.budget_fail('budget_invalid','earmarks'); end if;
  if not (p_payload ? 'earmarks') or jsonb_array_length(raw)=0 then perform set_config('finance.stage4_earmarks','',true); return finance.budget_move_funds_v1_legacy(p_command_id,p_payload); end if;
  for e in select value from jsonb_array_elements(raw) loop
    perform finance.budget_earmark_payload(e,false);
  end loop;
  clean:=p_payload-'earmarks';
  perform set_config('finance.stage4_earmarks',jsonb_build_object('kind','move','canonical_payload',p_payload,'earmarks',raw)::text,true);
  return finance.budget_move_funds_v1_legacy(p_command_id,clean);
end $$;

alter function public.budget_correct_movement_v1(uuid,jsonb) set schema finance;
alter function finance.budget_correct_movement_v1(uuid,jsonb) rename to budget_correct_movement_v1_legacy;
create or replace function public.budget_correct_movement_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare raw jsonb:=coalesce(p_payload->'replacement'->'earmarks','[]'::jsonb); clean jsonb:=p_payload; h uuid; has_claims boolean; e jsonb;
begin
  if jsonb_typeof(raw)<>'array' then perform finance.budget_fail('budget_invalid','earmarks'); end if;
  if not (p_payload ? 'replacement') or p_payload->'replacement' is null or not (p_payload->'replacement' ? 'earmarks') or jsonb_array_length(raw)=0 then
    h:=finance.resolve_caller_household();
    select exists(select 1 from finance.fund_earmarks where household_id=h and fund_movement_id=finance.budget_uuid(p_payload,'movement_id')) into has_claims;
    if not has_claims then perform set_config('finance.stage4_earmarks','',true); return finance.budget_correct_movement_v1_legacy(p_command_id,p_payload); end if;
  end if;
  if jsonb_array_length(raw)>0 then
    for e in select value from jsonb_array_elements(raw) loop
      perform finance.budget_earmark_payload(e,false);
    end loop;
  end if;
  if clean ? 'replacement' and clean->'replacement' is not null then clean:=jsonb_set(clean,array['replacement'],(clean->'replacement')-'earmarks'); end if;
  perform set_config('finance.stage4_earmarks',jsonb_build_object('kind','correct','canonical_payload',p_payload,'earmarks',raw)::text,true);
  return finance.budget_correct_movement_v1_legacy(p_command_id,clean);
end $$;

-- The legacy movement bodies call these receipt helpers.  A transaction-local
-- canonical envelope lets this migration add claims before (never after) the
-- command receipt is committed, while preserving normal receipt semantics.
create or replace function finance.budget_begin_command(p_command_id uuid,p_kind text,p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_temp as $$
declare v_household uuid; v_actor uuid; v_receipt finance.budget_commands%rowtype; v_stage jsonb; v_effective jsonb:=p_payload;
begin
  v_stage:=nullif(current_setting('finance.stage4_earmarks',true),'')::jsonb;
  if v_stage is not null and ((v_stage->>'kind' in ('move','correct') and p_kind in ('budget_move_funds_v1','budget_correct_movement_v1')) or (v_stage->>'kind'='allocation' and p_kind='budget_review_allocation_v1')) then v_effective:=v_stage->'canonical_payload'; end if;
  if p_command_id is null or btrim(coalesce(p_kind,''))='' or jsonb_typeof(v_effective) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid command'); end if;
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then perform finance.budget_fail('budget_forbidden','authenticated caller required'); end if;
  perform finance.bind_household_member();
  if not exists(select 1 from finance.household_members where auth_user_id=auth.uid()) then
    perform finance.budget_fail('budget_forbidden','household member required');
  end if;
  v_household:=finance.resolve_caller_household(); perform 1 from finance.households where id=v_household for update; v_actor:=finance.budget_actor_member(v_household);
  select * into v_receipt from finance.budget_commands where household_id=v_household and command_id=p_command_id;
  if found then if v_receipt.kind is distinct from p_kind or v_receipt.payload is distinct from v_effective then perform finance.budget_fail('budget_conflict','command receipt differs'); end if; return v_receipt.result; end if;
  return null;
end $$;

create or replace function finance.budget_finish_command(p_command_id uuid,p_kind text,p_payload jsonb,p_result jsonb)
returns jsonb language plpgsql volatile security definer set search_path=pg_temp as $$
declare h uuid; actor uuid; stage jsonb; effective jsonb:=p_payload; e jsonb; claim finance.fund_earmarks%rowtype; rec uuid; movement uuid; reversal uuid; replacement uuid; asof date; new_set uuid; prior_set uuid; n integer; allocation uuid; original_claim_ids uuid[]:='{}';
begin
  if jsonb_typeof(p_result) is distinct from 'object' then perform finance.budget_fail('budget_invalid','invalid command result'); end if;
  if auth.uid() is null or coalesce(auth.jwt()->>'role','')<>'authenticated' then perform finance.budget_fail('budget_forbidden','authenticated caller required'); end if;
  perform finance.bind_household_member(); h:=finance.resolve_caller_household(); perform 1 from finance.households where id=h for update; actor:=finance.budget_actor_member(h);
  stage:=nullif(current_setting('finance.stage4_earmarks',true),'')::jsonb;
  if stage is not null and stage->>'kind' in ('move','correct') and p_kind in ('budget_move_funds_v1','budget_correct_movement_v1') then
    effective:=stage->'canonical_payload'; rec:=(p_payload->>'expected_reconciliation_id')::uuid;
    if stage->>'kind'='move' then
      movement:=(p_result->>'movement_id')::uuid; asof:=(p_payload->>'effective_on')::date;
      for e in select value from jsonb_array_elements(stage->'earmarks') loop
        perform finance.budget_insert_earmark(h,actor,p_command_id,finance.budget_earmark_payload(e,false),rec,asof,jsonb_build_object('fund_movement_id',movement::text,'allocation_id',null,'financial_event_id',null,'reconciliation_id',null));
      end loop;
    else
      reversal:=(p_result->>'reversal_movement_id')::uuid; replacement:=nullif(p_result->>'replacement_movement_id','')::uuid;
      for claim in select * from finance.fund_earmarks where household_id=h and fund_movement_id=(p_payload->>'movement_id')::uuid order by id loop
        original_claim_ids:=array_append(original_claim_ids,claim.id);
        insert into finance.fund_earmarks(household_id,fund_id,restricted_account_id,amount_cents,effective_on,actor_id,command_id,fund_movement_id,correction_of,reason)
        values(h,claim.fund_id,claim.restricted_account_id,-claim.amount_cents,claim.effective_on,actor,p_command_id,reversal,claim.id,('reverse: ' || (p_payload->>'reason')));
      end loop;
      n:=0;
      if replacement is not null then for e in select value from jsonb_array_elements(stage->'earmarks') loop
        n:=n+1;
        if n>coalesce(array_length(original_claim_ids,1),0) then perform finance.budget_fail('budget_invalid','replacement earmark lineage'); end if;
        perform finance.budget_insert_earmark(h,actor,p_command_id,finance.budget_earmark_payload(e,false),rec,(p_payload->'replacement'->>'effective_on')::date,jsonb_build_object('fund_movement_id',replacement::text,'allocation_id',null,'financial_event_id',null,'reconciliation_id',null,'correction_of',original_claim_ids[n]::text));
      end loop; end if;
      asof:=coalesce((p_payload->'replacement'->>'effective_on')::date,(select effective_on from finance.fund_movements where id=reversal));
    end if;
    perform finance.budget_validate_earmark_final(h,asof,rec);
  elsif stage is not null and stage->>'kind'='allocation' and p_kind='budget_review_allocation_v1' then
    effective:=stage->'canonical_payload'; new_set:=(p_result->>'set_id')::uuid;
    select supersedes_id into prior_set from finance.budget_allocation_sets where household_id=h and id=new_set;
    if prior_set is not null then for claim in select e.* from finance.fund_earmarks e join finance.budget_allocations a on a.household_id=e.household_id and a.id=e.allocation_id where e.household_id=h and a.set_id=prior_set loop
      insert into finance.fund_earmarks(household_id,fund_id,restricted_account_id,amount_cents,effective_on,actor_id,command_id,allocation_id,reason) values(h,claim.fund_id,claim.restricted_account_id,-claim.amount_cents,claim.effective_on,actor,p_command_id,claim.allocation_id,'reverse: superseded allocation');
    end loop; end if;
    rec:=(select id from finance.budget_reconciliations where household_id=h and status='complete' order by as_of desc,recorded_at desc limit 1);
    asof:=(select occurred_on from finance.budget_allocation_sets where id=new_set);
    for e,n in select value,ordinality::int from jsonb_array_elements(stage->'earmarks') with ordinality loop
      if n>jsonb_array_length(p_result->'allocation_ids') then perform finance.budget_fail('budget_invalid','earmark allocation link'); end if;
      allocation:=(p_result->'allocation_ids'->>(n-1))::uuid;
      perform finance.budget_insert_earmark(h,actor,p_command_id,finance.budget_earmark_payload(e,false),rec,asof,jsonb_build_object('fund_movement_id',null,'allocation_id',allocation::text,'financial_event_id',null,'reconciliation_id',null));
    end loop;
    perform finance.budget_validate_earmark_final(h,asof,rec);
  end if;
  insert into finance.budget_commands(household_id,command_id,kind,payload,actor_id,result) values(h,p_command_id,p_kind,effective,actor,p_result);
  return p_result;
end $$;

-- PR2 deliberately blocked any operation touching an earmarked fund.  During a
-- Stage4 envelope that block is replaced by the final, locked claim-capacity
-- check in budget_finish_command.  Empty/legacy public calls clear the envelope
-- above, so they retain the original guard.
create or replace function finance.budget_fail(p_prefix text,p_detail text)
returns void language plpgsql volatile set search_path=pg_temp as $$
declare stage jsonb;
begin
  stage:=nullif(current_setting('finance.stage4_earmarks',true),'')::jsonb;
  if p_prefix='budget_incomplete' and p_detail in ('earmarks are unavailable until PR4','earmarked funds are unavailable until PR4','earmarked fund')
     and stage is not null and stage->>'kind' in ('move','correct','allocation')
     and jsonb_typeof(coalesce(stage->'earmarks','[]'::jsonb))='array' then
    return;
  end if;
  raise exception using errcode='P0001',message=p_prefix||': '||p_detail;
end $$;

-- PR3 treated every restricted/mortgage row as intrinsically unverified.  In
-- Stage4 a row is verified only with explicit eligible cents and evidence; that
-- proof removes this obsolete gate without turning its capacity into liquid cash.
alter function finance.budget_reconciliation_state(uuid,uuid,timestamptz) rename to budget_reconciliation_state_stage3;
create or replace function finance.budget_reconciliation_state(p_household uuid,p_reconciliation uuid,p_checked_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare state jsonb; r finance.budget_reconciliations%rowtype; reason jsonb; reasons jsonb:='[]'::jsonb; verified_all boolean:=true; has_restricted boolean:=false;
begin
  state:=finance.budget_reconciliation_state_stage3(p_household,p_reconciliation,p_checked_at);
  select * into r from finance.budget_reconciliations where household_id=p_household and id=p_reconciliation;
  for reason in select value from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) loop
    if reason->'settings_snapshot'->>'resource_class' in ('restricted','mortgage') then
      has_restricted:=true;
      if coalesce(reason->>'eligible_restricted_cents','') !~ '^[0-9]+$' or nullif(btrim(coalesce(reason->>'restricted_evidence','')),'') is null then verified_all:=false; end if;
    end if;
  end loop;
  for reason in select value from jsonb_array_elements(coalesce(state->'reasons','[]'::jsonb)) loop
    if reason->>'code'='restricted_resources_unverified' and exists(
      select 1 from jsonb_array_elements(coalesce(r.coverage_snapshot->'accounts','[]'::jsonb)) a
      where a->>'account_id'=reason->>'account_id'
        and a->'settings_snapshot'->>'resource_class' in ('restricted','mortgage')
        and coalesce(a->>'eligible_restricted_cents','') ~ '^[0-9]+$'
        and nullif(btrim(coalesce(a->>'restricted_evidence','')),'') is not null
    ) then continue; end if;
    if reason->>'code'='historic_incomplete' and has_restricted and verified_all then continue; end if;
    reasons:=reasons||jsonb_build_array(reason);
  end loop;
  return state||jsonb_build_object('status',case when jsonb_array_length(reasons)=0 then 'complete' else 'incomplete' end,'reasons',reasons);
end $$;

alter table finance.budget_account_settings drop constraint if exists budget_account_settings_utility_device_id_check;
alter function public.budget_configure_account_v1(uuid,jsonb) set schema finance;
alter function finance.budget_configure_account_v1(uuid,jsonb) rename to budget_configure_account_v1_legacy;
create or replace function public.budget_configure_account_v1(p_command_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_temp set timezone='UTC' as $$
declare p jsonb; replay jsonb; h uuid; actor uuid; account uuid; owner uuid; settlement uuid; device uuid; expected text; before jsonb; after jsonb;
begin
  perform finance.budget_validate_object(p_payload,array['account_id','owner_scope','included','resource_class','freshness_hours','transaction_sign_convention'],array['expected_settings_fingerprint','owner_member_id','exclusion_reason','settlement_account_id','usual_due_day','sign_evidence','utility_device_id']);
  account:=finance.budget_uuid(p_payload,'account_id'); owner:=finance.budget_uuid(p_payload,'owner_member_id',true); settlement:=finance.budget_uuid(p_payload,'settlement_account_id',true); device:=finance.budget_uuid(p_payload,'utility_device_id',true); expected:=finance.budget_text(p_payload,'expected_settings_fingerprint',true);
  p:=jsonb_build_object('account_id',account::text,'expected_settings_fingerprint',expected,'owner_scope',finance.budget_text(p_payload,'owner_scope'),'owner_member_id',owner::text,'included',finance.budget_boolean(p_payload,'included'),'exclusion_reason',finance.budget_text(p_payload,'exclusion_reason',true),'resource_class',finance.budget_text(p_payload,'resource_class'),'settlement_account_id',settlement::text,'usual_due_day',finance.budget_integer(p_payload,'usual_due_day',1,31,true),'freshness_hours',finance.budget_integer(p_payload,'freshness_hours',1,2147483647),'transaction_sign_convention',finance.budget_text(p_payload,'transaction_sign_convention'),'sign_evidence',finance.budget_text(p_payload,'sign_evidence',true),'utility_device_id',device::text);
  if p->>'owner_scope' not in ('shared','member') or ((p->>'owner_scope'='shared')<>(owner is null)) or p->>'resource_class' not in ('liquid','restricted','mortgage','card','tracking_only') or ((p->>'included')::boolean and p->>'resource_class'='tracking_only') or (not (p->>'included')::boolean and coalesce(p->>'exclusion_reason','')='') or p->>'transaction_sign_convention' not in ('outflow_negative','outflow_positive','unknown') or (p->>'transaction_sign_convention'<>'unknown' and coalesce(p->>'sign_evidence','')='') then perform finance.budget_fail('budget_invalid','invalid account settings'); end if;
  replay:=finance.budget_begin_command(p_command_id,'budget_configure_account_v1',p); if replay is not null then return replay; end if;
  h:=finance.resolve_caller_household(); actor:=finance.budget_actor_member(h);
  if not exists(select 1 from public.accounts where household_id=h and account_id=account) then perform finance.budget_fail('budget_not_found','account'); end if;
  if owner is not null and not exists(select 1 from finance.household_members where household_id=h and id=owner) then perform finance.budget_fail('budget_not_found','owner member'); end if;
  if settlement is not null and not exists(select 1 from public.accounts where household_id=h and account_id=settlement) then perform finance.budget_fail('budget_not_found','settlement account'); end if;
  if device is not null and not exists(select 1 from consumption.devices where id=device and household_id=h) then perform finance.budget_fail('budget_forbidden','owned utility device'); end if;
  before:=finance.budget_settings_snapshot(h,account); if (finance.budget_settings_fingerprint(h,account) is null and expected is not null) or (finance.budget_settings_fingerprint(h,account) is not null and finance.budget_settings_fingerprint(h,account) is distinct from expected) then perform finance.budget_fail('budget_stale','settings'); end if;
  insert into finance.budget_account_settings as s(household_id,account_id,owner_scope,owner_member_id,included,exclusion_reason,resource_class,settlement_account_id,usual_due_day,freshness_hours,transaction_sign_convention,sign_evidence,utility_device_id,actor_id) values(h,account,p->>'owner_scope',owner,(p->>'included')::boolean,p->>'exclusion_reason',p->>'resource_class',settlement,(p->>'usual_due_day')::integer,(p->>'freshness_hours')::integer,p->>'transaction_sign_convention',p->>'sign_evidence',device,actor) on conflict(household_id,account_id) do update set owner_scope=excluded.owner_scope,owner_member_id=excluded.owner_member_id,included=excluded.included,exclusion_reason=excluded.exclusion_reason,resource_class=excluded.resource_class,settlement_account_id=excluded.settlement_account_id,usual_due_day=excluded.usual_due_day,freshness_hours=excluded.freshness_hours,transaction_sign_convention=excluded.transaction_sign_convention,sign_evidence=excluded.sign_evidence,utility_device_id=excluded.utility_device_id,updated_at=now(),actor_id=excluded.actor_id;
  after:=finance.budget_settings_snapshot(h,account); set constraints all immediate;
  return finance.budget_finish_command(p_command_id,'budget_configure_account_v1',p,jsonb_build_object('account_id',account::text,'settings_fingerprint',finance.budget_hash(after),'before',before,'after',after));
end $$;

-- Restricted observations and claims are exposed explicitly, never folded into
-- liquid resources.  Existing PR3 source-drift arithmetic remains authoritative.
alter function finance.budget_resources(uuid,timestamptz) rename to budget_resources_stage3;
create or replace function finance.budget_resources(p_household uuid,p_asof timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare r jsonb; rec uuid; e jsonb; restricted jsonb:='[]'::jsonb; claims jsonb:='[]'::jsonb;
begin
  r:=finance.budget_resources_stage3(p_household,p_asof); rec:=nullif(r->>'reconciliation_id','')::uuid;
  if rec is not null then
    select coalesce(jsonb_agg(jsonb_build_object('account_id',x->>'account_id','resource_class',x->'settings_snapshot'->>'resource_class','eligible_restricted_cents',coalesce(x->>'eligible_restricted_cents',x->'observation'->>'eligible_restricted_cents'),'evidence',coalesce(x->>'restricted_evidence',x->'observation'->>'restricted_evidence')) order by x->>'account_id'),'[]'::jsonb) into restricted
    from finance.budget_reconciliations q, lateral jsonb_array_elements(q.coverage_snapshot->'accounts') x where q.id=rec and x->'settings_snapshot'->>'resource_class' in ('restricted','mortgage');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('fund_id',fund_id::text,'restricted_cents',restricted_cents::text,'liquid_cents',greatest(balance_cents-restricted_cents,0)::text) order by fund_id),'[]'::jsonb) into claims from finance.budget_fund_balances(p_household,(p_asof at time zone 'Africa/Johannesburg')::date);
  return r || jsonb_build_object('restricted_resources',restricted,'restricted_claims',claims);
end $$;

-- Utility ledgers are a separate source family: coverage is explicit, reviewed
-- rows are fingerprinted against utility snapshots, and unallocated charges
-- keep availability provisional.
create or replace function finance.budget_utility_source_state(p_household uuid,p_asof timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare l record; s finance.budget_allocation_sets%rowtype; snap jsonb; reasons jsonb:='[]'::jsonb; cutover date;
begin
  cutover:=finance.budget_opening_cutover(p_household);
  for l in select e.id,e.entry_type,e.occurred_at,e.posted_at from consumption.ledger_entries e
    where e.household_id=p_household and e.entry_type in ('usage_charge','fee','correction')
      and coalesce(e.occurred_at,e.posted_at) is not null
      and coalesce(e.occurred_at,e.posted_at)<=p_asof
      and (cutover is null or coalesce(e.occurred_at,e.posted_at)::date>=cutover)
    order by e.id loop
    select * into s from finance.budget_allocation_sets x where x.household_id=p_household
      and x.utility_entry_id=l.id and x.status in ('current','needs_review') limit 1;
    if not found then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utility_unallocated','utility_entry_id',l.id::text));
      continue;
    end if;
    if s.status='needs_review' then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utility_allocation_needs_review','utility_entry_id',l.id::text,'set_id',s.id::text));
    end if;
    begin snap:=finance.budget_utility_snapshot(p_household,l.id);
    exception when others then snap:=null; end;
    if snap is null or not coalesce((snap->>'complete')::boolean,false)
       or snap->>'source_fingerprint' is distinct from s.source_fingerprint then
      reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utility_source_drift','utility_entry_id',l.id::text,'set_id',s.id::text));
    end if;
  end loop;
  return jsonb_build_object('complete',jsonb_array_length(reasons)=0,'reasons',reasons);
end $$;

-- The Stage3 source loop assumes every allocation has a bank transaction id.
-- Remove only its null-transaction artifacts for utility sets, then apply the
-- explicit utility source checks above.
alter function finance.budget_source_exposure(uuid,jsonb,timestamptz) rename to budget_source_exposure_stage3;
create or replace function finance.budget_source_exposure(p_household uuid,p_coverage jsonb,p_asof timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare r jsonb; u jsonb; utility_ids uuid[]:='{}'; removed_delta numeric:=0; reasons jsonb; adjustments jsonb;
begin
  r:=finance.budget_source_exposure_stage3(p_household,p_coverage,p_asof);
  select coalesce(array_agg(s.id),'{}') into utility_ids from finance.budget_allocation_sets s
    where s.household_id=p_household and s.utility_entry_id is not null and s.status in ('current','needs_review');
  select coalesce(sum((x->>'resource_delta_cents')::numeric),0) into removed_delta
    from jsonb_array_elements(coalesce(r->'adjustments','[]'::jsonb)) x
    where nullif(x->>'set_id','')::uuid=any(utility_ids);
  select coalesce(jsonb_agg(x),'[]'::jsonb) into adjustments
    from jsonb_array_elements(coalesce(r->'adjustments','[]'::jsonb)) x
    where nullif(x->>'set_id','')::uuid is null or not (nullif(x->>'set_id','')::uuid=any(utility_ids));
  select coalesce(jsonb_agg(x),'[]'::jsonb) into reasons
    from jsonb_array_elements(coalesce(r->'reasons','[]'::jsonb)) x
    where not (x->>'code'='source_allocation_stale' and x->>'transaction_id' is null);
  u:=finance.budget_utility_source_state(p_household,p_asof);
  reasons:=reasons||coalesce(u->'reasons','[]'::jsonb);
  return r||jsonb_build_object('complete',jsonb_array_length(reasons)=0,'reasons',reasons,
    'adjustments',adjustments,'resource_delta_cents',case when r->>'resource_delta_cents' is null then null
      else finance.budget_checked_bigint((r->>'resource_delta_cents')::numeric-removed_delta)::text end,
    'provisional_known',coalesce((r->>'provisional_known')::boolean,false) and coalesce((u->>'complete')::boolean,false));
end $$;

-- A verified utility statement/evidence set can satisfy coverage.  Existing
-- devices require that proof; households with no utility devices may opt out.
alter function finance.budget_check_coverage_base(uuid,jsonb,timestamptz) rename to budget_check_coverage_base_stage3;
create or replace function finance.budget_check_coverage_base(p_household uuid,p_coverage jsonb,p_asof timestamptz)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare r jsonb; reasons jsonb; status text; evidence text;
begin
  r:=finance.budget_check_coverage_base_stage3(p_household,p_coverage,p_asof);
  status:=p_coverage->'utility_coverage'->>'status';
  evidence:=nullif(btrim(p_coverage->'utility_coverage'->>'evidence'),'');
  select coalesce(jsonb_agg(x),'[]'::jsonb) into reasons from jsonb_array_elements(coalesce(r->'reasons','[]'::jsonb)) x
    where not (x->>'code'='utilities_unverified' and status='verified' and evidence is not null);
  if status='not_required' and evidence is not null and exists(select 1 from consumption.devices d where d.household_id=p_household) then
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utilities_unverified'));
  end if;
  if status='verified' and evidence is null and not (reasons @> '[{"code":"utilities_unverified"}]'::jsonb) then
    reasons:=reasons||jsonb_build_array(jsonb_build_object('code','utilities_unverified'));
  end if;
  return r||jsonb_build_object('status',case when jsonb_array_length(reasons)=0 then 'complete' else 'incomplete' end,'reasons',reasons);
end $$;

alter function public.budget_get_overview_v1(date,timestamptz) set schema finance;
alter function finance.budget_get_overview_v1(date,timestamptz) rename to budget_get_overview_v1_stage3;
create or replace function public.budget_get_overview_v1(p_cycle_start date,p_as_of timestamptz default now())
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare v jsonb; h uuid; f jsonb; net_liquid numeric; net_claims numeric:=0; positive_claims numeric:=0; negative_claims numeric:=0; deficit numeric;
begin
  v:=finance.budget_get_overview_v1_stage3(p_cycle_start,p_as_of); h:=finance.budget_reader_household();
  select coalesce(jsonb_agg(x || jsonb_build_object('restricted_cents',b.restricted_cents::text,'liquid_cents',greatest(b.balance_cents-b.restricted_cents,0)::text) order by ord),'[]'::jsonb) into f from jsonb_array_elements(coalesce(v->'funds','[]'::jsonb)) with ordinality q(x,ord) left join finance.budget_fund_balances(h,(p_as_of at time zone 'Africa/Johannesburg')::date) b on b.fund_id=(x->>'fund_id')::uuid;
  select coalesce(sum(balance_cents::numeric-restricted_cents::numeric),0),
    coalesce(sum(greatest(balance_cents::numeric-restricted_cents::numeric,0)),0),
    coalesce(sum(greatest(-balance_cents::numeric,0)),0)
    into net_claims,positive_claims,negative_claims
    from finance.budget_fund_balances(h,(p_as_of at time zone 'Africa/Johannesburg')::date);
  net_liquid:=nullif(v->>'net_liquid_cents','')::numeric;
  deficit:=case when net_liquid is null then null else greatest(positive_claims-net_liquid,negative_claims,0) end;
  return v || jsonb_build_object('funds',f,'restricted_resources',finance.budget_resources(h,p_as_of)->'restricted_resources','restricted_claims',finance.budget_resources(h,p_as_of)->'restricted_claims',
    'net_claims_cents',finance.budget_checked_bigint(net_claims)::text,
    'positive_claims_cents',finance.budget_checked_bigint(positive_claims)::text,
    'deficit_cents',case when deficit is null then null else finance.budget_checked_bigint(deficit)::text end,
    'unassigned_cents',case when net_liquid is null or coalesce((v->>'complete')::boolean,false) is not true then null
      else finance.budget_checked_bigint(net_liquid-net_claims)::text end);
end $$;

alter function public.budget_get_fund_v1(uuid,date,date,text,integer) set schema finance;
alter function finance.budget_get_fund_v1(uuid,date,date,text,integer) rename to budget_get_fund_v1_stage3;
create or replace function public.budget_get_fund_v1(p_fund_id uuid,p_from date,p_to date,p_cursor text default null,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=pg_temp set timezone='UTC' as $$
declare v jsonb; h uuid; b record;
begin v:=finance.budget_get_fund_v1_stage3(p_fund_id,p_from,p_to,p_cursor,p_limit); h:=finance.budget_reader_household(); select * into b from finance.budget_fund_balances(h,p_to-1) where fund_id=p_fund_id; return v || jsonb_build_object('restricted_cents',coalesce(b.restricted_cents,0)::text,'liquid_cents',greatest(coalesce(b.balance_cents,0)-coalesce(b.restricted_cents,0),0)::text); end $$;

revoke all on function finance.budget_utility_snapshot(uuid,uuid),finance.budget_utility_source_state(uuid,timestamptz),finance.budget_earmark_payload(jsonb,boolean),finance.budget_earmark_capacity(uuid,uuid,uuid),finance.budget_validate_earmark_final(uuid,date,uuid),finance.budget_insert_earmark(uuid,uuid,uuid,jsonb,uuid,date,jsonb),finance.budget_review_allocation_bank_v1(uuid,jsonb),finance.budget_source_exposure_stage3(uuid,jsonb,timestamptz),finance.budget_check_coverage_base_stage3(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_reconciliation_state_stage3(uuid,uuid,timestamptz),finance.budget_reconciliation_state(uuid,uuid,timestamptz),finance.budget_source_exposure(uuid,jsonb,timestamptz),finance.budget_check_coverage_base(uuid,jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function finance.budget_resources_stage3(uuid,timestamptz),finance.budget_resources(uuid,timestamptz),finance.budget_get_overview_v1_stage3(date,timestamptz),finance.budget_get_fund_v1_stage3(uuid,date,date,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.budget_change_earmark_v1(uuid,jsonb),public.budget_review_allocation_v1(uuid,jsonb) from public,anon,service_role;
revoke all on function public.budget_get_overview_v1(date,timestamptz),public.budget_get_fund_v1(uuid,date,date,text,integer) from public,anon,service_role;
revoke all on function finance.budget_configure_account_v1_legacy(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.budget_configure_account_v1(uuid,jsonb) from public,anon,service_role;
revoke all on function finance.budget_move_funds_v1_legacy(uuid,jsonb),finance.budget_correct_movement_v1_legacy(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.budget_move_funds_v1(uuid,jsonb),public.budget_correct_movement_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.budget_change_earmark_v1(uuid,jsonb),public.budget_review_allocation_v1(uuid,jsonb),public.budget_move_funds_v1(uuid,jsonb),public.budget_correct_movement_v1(uuid,jsonb),public.budget_configure_account_v1(uuid,jsonb) to authenticated;
grant execute on function public.budget_get_overview_v1(date,timestamptz),public.budget_get_fund_v1(uuid,date,date,text,integer) to authenticated;
revoke all on function consumption.validate_budget_ownership(),consumption.derive_ledger_household() from public,anon,authenticated,service_role;
revoke all on function finance.validate_event_leg_source() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
