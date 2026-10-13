create table if not exists finance.bank_zero_transfer_pairs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  debit_movement_id uuid not null,
  credit_movement_id uuid not null,
  state text not null default 'confirmed' check (state in ('confirmed', 'needs_review')),
  projection_state text not null default 'pending' check (projection_state in ('pending', 'complete', 'needs_review')),
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (debit_movement_id <> credit_movement_id),
  unique (household_id, debit_movement_id, credit_movement_id),
  foreign key (household_id, debit_movement_id)
    references finance.bank_zero_movements(household_id, id),
  foreign key (household_id, credit_movement_id)
    references finance.bank_zero_movements(household_id, id)
);
create index if not exists bank_zero_transfer_pair_lookup
  on finance.bank_zero_transfer_pairs (household_id, state, created_at desc);
create unique index if not exists bank_zero_transfer_pair_debit_unique
  on finance.bank_zero_transfer_pairs (household_id, debit_movement_id);
create unique index if not exists bank_zero_transfer_pair_credit_unique
  on finance.bank_zero_transfer_pairs (household_id, credit_movement_id);
alter table finance.bank_zero_transfer_pairs
  add constraint bank_zero_transfer_pairs_household_id_key unique (household_id, id);
alter table finance.bank_zero_movements
  add constraint bank_zero_movement_transfer_pair_fk
  foreign key (household_id, transfer_group_id)
  references finance.bank_zero_transfer_pairs(household_id, id);

alter table finance.bank_zero_transfer_pairs enable row level security;
create policy bank_zero_transfer_pair_household_read on finance.bank_zero_transfer_pairs
  for select to authenticated using (finance.is_household_member(household_id));
grant select on finance.bank_zero_transfer_pairs to authenticated;
grant all on finance.bank_zero_transfer_pairs to service_role;

create or replace function public.bank_zero_enqueue_transfer_flag_v1(
  p_household_id uuid,
  p_movement_id uuid,
  p_finwise_transaction_id text default null,
  p_current_transaction jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_movement finance.bank_zero_movements%rowtype;
  v_revision integer;
  v_expected_is_transfer boolean;
  v_description text;
  v_notes text;
begin
  select * into v_movement from finance.bank_zero_movements
  where household_id = p_household_id and id = p_movement_id for update;
  if not found or v_movement.transfer_group_id is null then return false; end if;

  update finance.bank_zero_publication_outbox
  set exact_request = jsonb_set(exact_request, '{isTransfer}', 'true'::jsonb, true),
      updated_at = now()
  where household_id = p_household_id and movement_id = p_movement_id
    and operation = 'create' and state in ('pending', 'retryable_failure');
  if found then return true; end if;

  p_finwise_transaction_id := coalesce(p_finwise_transaction_id, v_movement.finwise_transaction_id);
  if p_finwise_transaction_id is null then
    update finance.bank_zero_transfer_pairs
    set projection_state = 'needs_review',
        reason = 'A transfer leg has an uncertain FinWise create outcome; automatic retry is prohibited',
        updated_at = now()
    where household_id = p_household_id
      and (debit_movement_id = p_movement_id or credit_movement_id = p_movement_id)
      and exists (
        select 1 from finance.bank_zero_publication_outbox outbox
        where outbox.household_id = p_household_id and outbox.movement_id = p_movement_id
          and outbox.operation = 'create' and outbox.state = 'outcome_unknown'
      );
    return false;
  end if;

  if p_current_transaction is not null then
    v_expected_is_transfer := case
      when jsonb_typeof(p_current_transaction->'isTransfer') = 'boolean'
        then (p_current_transaction->>'isTransfer')::boolean
      else null
    end;
    v_description := coalesce(p_current_transaction->>'description', '');
    v_notes := p_current_transaction->>'notes';
  else
    select source_is_transfer, description, notes
      into v_expected_is_transfer, v_description, v_notes
    from public.transactions
    where household_id = p_household_id and id = p_finwise_transaction_id;
    if not found then
      if exists (
        select 1 from finance.bank_zero_publication_outbox outbox
        where outbox.household_id = p_household_id and outbox.movement_id = p_movement_id
          and outbox.operation = 'project' and outbox.state in ('pending', 'in_progress', 'retryable_failure')
      ) then return false; end if;
      update finance.bank_zero_transfer_pairs
      set projection_state = 'needs_review', reason = 'FinWise identity has no normalized transaction snapshot', updated_at = now()
      where household_id = p_household_id
        and (debit_movement_id = p_movement_id or credit_movement_id = p_movement_id);
      return false;
    end if;
  end if;

  if v_expected_is_transfer is true then return true; end if;
  if v_expected_is_transfer is false then
    update finance.bank_zero_transfer_pairs
    set projection_state = 'needs_review', reason = 'Existing FinWise transfer classification conflicts with the confirmed pair', updated_at = now()
    where household_id = p_household_id
      and (debit_movement_id = p_movement_id or credit_movement_id = p_movement_id);
    return false;
  end if;

  select coalesce(max(desired_revision), 0) + 1 into v_revision
  from finance.bank_zero_publication_outbox
  where household_id = p_household_id and movement_id = p_movement_id;
  insert into finance.bank_zero_publication_outbox (
    household_id, movement_id, desired_revision, operation, state,
    exact_request, finwise_transaction_id
  ) values (
    p_household_id, p_movement_id, v_revision, 'update', 'pending',
    jsonb_build_object(
      'finwise_transaction_id', p_finwise_transaction_id,
      'account_id', v_movement.account_id,
      'amount', v_movement.amount,
      'currency_code', v_movement.currency_code,
      'expected', jsonb_build_object('description', v_description, 'notes', v_notes, 'isTransfer', null),
      'patch', jsonb_build_object('isTransfer', true)
    ),
    p_finwise_transaction_id
  ) on conflict (household_id, movement_id, desired_revision) do nothing;
  return true;
end;
$$;

create or replace function public.bank_zero_transfer_create_request_v1()
returns trigger
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
begin
  if new.operation = 'create' and exists (
    select 1 from finance.bank_zero_movements movement
    where movement.household_id = new.household_id and movement.id = new.movement_id
      and movement.transfer_group_id is not null
  ) then
    new.exact_request := jsonb_set(new.exact_request, '{isTransfer}', 'true'::jsonb, true);
  end if;
  return new;
end;
$$;

create trigger bank_zero_transfer_create_request
  before insert or update on finance.bank_zero_publication_outbox
  for each row execute function public.bank_zero_transfer_create_request_v1();
revoke all on function public.bank_zero_transfer_create_request_v1() from public, anon, authenticated;
grant execute on function public.bank_zero_transfer_create_request_v1() to service_role;

revoke all on function public.bank_zero_enqueue_transfer_flag_v1(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.bank_zero_enqueue_transfer_flag_v1(uuid, uuid, text, jsonb) to service_role;

create or replace function public.bank_zero_pair_confirmed_transfer_v1()
returns trigger
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_movement finance.bank_zero_movements%rowtype;
  v_observation finance.bank_zero_observations%rowtype;
  v_destination_count integer;
  v_destination_id uuid;
  v_source_alias_count integer;
  v_partner_ids uuid[];
  v_partner finance.bank_zero_movements%rowtype;
  v_pair_id uuid;
  v_debit_id uuid;
  v_credit_id uuid;
  v_date date;
begin
  if new.relation <> 'created_from' then return new; end if;
  select * into v_movement from finance.bank_zero_movements
  where household_id = new.household_id and id = new.movement_id;
  if not found or v_movement.transfer_group_id is not null
     or v_movement.movement_type not in ('payment', 'receipt', 'transfer_leg', 'statement_movement') then return new; end if;
  select * into v_observation from finance.bank_zero_observations
  where household_id = new.household_id and id = new.observation_id;
  if not found then return new; end if;

  -- Counterparty names only resolve when they equal one active, household-registered alias.
  select count(distinct alias.account_id), min(alias.account_id::text)::uuid
    into v_destination_count, v_destination_id
  from finance.bank_zero_account_aliases alias
  join finance.bank_zero_routes route
    on route.household_id = alias.household_id and route.route_key = alias.route_key
  where alias.household_id = new.household_id
    and alias.status = 'active'
    and route.status = 'active'
    and alias.alias_normalized = lower(regexp_replace(btrim(coalesce(v_movement.counterparty, '')), '\s+', ' ', 'g'));
  if v_destination_count <> 1 or v_destination_id = v_movement.account_id then return new; end if;

  select count(*) into v_source_alias_count
  from finance.bank_zero_account_aliases alias
  join finance.bank_zero_routes route
    on route.household_id = alias.household_id and route.route_key = alias.route_key
  where alias.household_id = new.household_id and alias.account_id = v_movement.account_id
    and alias.status = 'active' and route.status = 'active';
  if v_source_alias_count = 0 then return new; end if;

  v_date := coalesce(v_movement.occurred_at at time zone 'Africa/Johannesburg', v_movement.posted_on::timestamp)::date;
  if v_date is null then return new; end if;

  select coalesce(array_agg(candidate.id order by candidate.created_at), '{}'::uuid[])
    into v_partner_ids
  from finance.bank_zero_movements candidate
  where candidate.household_id = new.household_id
    and candidate.id <> v_movement.id
    and candidate.account_id = v_destination_id
    and candidate.currency_code = v_movement.currency_code
    and candidate.amount = -v_movement.amount
    and candidate.movement_type in ('payment', 'receipt', 'transfer_leg', 'statement_movement')
    and candidate.reconciliation_state <> 'needs_review'
    and candidate.transfer_group_id is null
    and coalesce(candidate.occurred_at at time zone 'Africa/Johannesburg', candidate.posted_on::timestamp)::date
      between v_date - 1 and v_date + 1
    and exists (
      select 1 from finance.bank_zero_account_aliases source_alias
      join finance.bank_zero_routes source_route
        on source_route.household_id = source_alias.household_id and source_route.route_key = source_alias.route_key
      where source_alias.household_id = new.household_id
        and source_alias.account_id = v_movement.account_id
        and source_alias.status = 'active' and source_route.status = 'active'
        and source_alias.alias_normalized = lower(regexp_replace(btrim(coalesce(candidate.counterparty, '')), '\s+', ' ', 'g'))
    );

  if cardinality(v_partner_ids) <> 1 then
    if cardinality(v_partner_ids) > 1 then
      update finance.bank_zero_observations
      set status = 'needs_review', review_reason = 'Multiple registered opposite transfer legs are plausible'
      where household_id = new.household_id and id = new.observation_id;
      update finance.bank_zero_received_emails email
      set processing_outcome = 'needs_review', outcome_reason = 'Multiple registered opposite transfer legs are plausible', updated_at = now()
      where email.household_id = new.household_id and email.id = v_observation.received_email_id;
    end if;
    return new;
  end if;

  select * into v_partner from finance.bank_zero_movements where id = v_partner_ids[1];
  v_debit_id := case when v_movement.amount < 0 then v_movement.id else v_partner.id end;
  v_credit_id := case when v_movement.amount > 0 then v_movement.id else v_partner.id end;
  insert into finance.bank_zero_transfer_pairs (household_id, debit_movement_id, credit_movement_id)
  values (new.household_id, v_debit_id, v_credit_id)
  on conflict (household_id, debit_movement_id, credit_movement_id)
  do update set updated_at = now()
  returning id into v_pair_id;

  update finance.bank_zero_movements
  set movement_type = 'transfer_leg', transfer_group_id = v_pair_id, updated_at = now()
  where household_id = new.household_id and id in (v_debit_id, v_credit_id);

  insert into finance.bank_zero_evidence_links (
    household_id, observation_id, movement_id, relation, matching_method, decision_reason
  ) values (
    new.household_id, new.observation_id, v_partner.id, 'transfer_pair',
    'registered_opposite_account_aliases_exact_amount_and_date_v1',
    'Opposite equal-value legs name each other registered household account within one day'
  ) on conflict (household_id, observation_id, movement_id) do nothing;

  perform public.bank_zero_enqueue_transfer_flag_v1(new.household_id, v_debit_id);
  perform public.bank_zero_enqueue_transfer_flag_v1(new.household_id, v_credit_id);
  return new;
end;
$$;

create trigger bank_zero_pair_confirmed_transfer
  after insert on finance.bank_zero_evidence_links
  for each row execute function public.bank_zero_pair_confirmed_transfer_v1();

revoke all on function public.bank_zero_pair_confirmed_transfer_v1() from public, anon, authenticated;
grant execute on function public.bank_zero_pair_confirmed_transfer_v1() to service_role;

create or replace function public.bank_zero_transfer_after_create_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
begin
  if old.operation = 'project' and new.state = 'published'
     and old.state in ('pending', 'in_progress', 'retryable_failure')
     and exists (
       select 1 from finance.bank_zero_movements movement
       where movement.household_id = new.household_id and movement.id = new.movement_id
         and movement.transfer_group_id is not null
     ) then
    perform public.bank_zero_enqueue_transfer_flag_v1(
      new.household_id, new.movement_id, new.finwise_transaction_id, new.exact_request
    );
  elsif old.operation = 'create' and new.operation = 'project'
     and old.state = 'in_progress' and new.state = 'pending'
     and new.exact_request->>'isTransfer' is distinct from 'true'
     and exists (
       select 1 from finance.bank_zero_movements movement
       where movement.household_id = new.household_id and movement.id = new.movement_id
         and movement.transfer_group_id is not null
     ) then
    perform public.bank_zero_enqueue_transfer_flag_v1(
      new.household_id, new.movement_id, new.finwise_transaction_id, new.exact_request
    );
  end if;
  return new;
end;
$$;

create trigger bank_zero_transfer_after_create_projection
  after update of operation, state on finance.bank_zero_publication_outbox
  for each row execute function public.bank_zero_transfer_after_create_projection_v1();

revoke all on function public.bank_zero_transfer_after_create_projection_v1() from public, anon, authenticated;
grant execute on function public.bank_zero_transfer_after_create_projection_v1() to service_role;

create or replace function public.bank_zero_complete_transfer_projection_v1()
returns trigger
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
begin
  if new.source_is_transfer is true then
    update finance.bank_zero_transfer_pairs pair
    set projection_state = 'complete', reason = null, updated_at = now()
    where pair.household_id = new.household_id
      and pair.projection_state <> 'complete'
      and exists (
        select 1
        from finance.bank_zero_movements movement
        where movement.household_id = pair.household_id
          and movement.id in (pair.debit_movement_id, pair.credit_movement_id)
          and movement.finwise_transaction_id = new.id
      )
      and exists (
        select 1
        from finance.bank_zero_movements debit
        join finance.bank_zero_movements credit
          on credit.household_id = debit.household_id
         and credit.id = pair.credit_movement_id
        join public.transactions debit_tx
          on debit_tx.household_id = debit.household_id
         and debit_tx.id = debit.finwise_transaction_id
        join public.transactions credit_tx
          on credit_tx.household_id = credit.household_id
         and credit_tx.id = credit.finwise_transaction_id
        where debit.household_id = pair.household_id
          and debit.id = pair.debit_movement_id
          and debit_tx.source_is_transfer is true
          and credit_tx.source_is_transfer is true
      );
  end if;
  return new;
end;
$$;

create trigger bank_zero_complete_transfer_projection
  after insert or update of source_is_transfer on public.transactions
  for each row execute function public.bank_zero_complete_transfer_projection_v1();

revoke all on function public.bank_zero_complete_transfer_projection_v1() from public, anon, authenticated;
grant execute on function public.bank_zero_complete_transfer_projection_v1() to service_role;
