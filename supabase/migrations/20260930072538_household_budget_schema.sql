-- Household budget PR1 packet B: additive schema and tenant boundaries.
create schema if not exists finance;

create unique index if not exists household_members_household_id_id_key on finance.household_members (household_id, id);
create unique index if not exists accounts_household_id_account_id_key on public.accounts (household_id, account_id);
create unique index if not exists transactions_household_id_id_key on public.transactions (household_id, id);
create unique index if not exists categories_household_id_id_key on finance.categories (household_id, id);
create unique index if not exists classifications_household_id_id_key on finance.transaction_classifications (household_id, id);
create unique index if not exists treatments_household_id_id_key on finance.transaction_treatments (household_id, id);
create unique index if not exists events_household_id_id_key on finance.financial_events (household_id, id);

create or replace function finance.budget_immutable_row()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = 'budget_forbidden: immutable row';
end;
$$;

create or replace function finance.budget_utility_source_disabled()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = 'budget_invalid: utility allocation sources are disabled until PR4';
end;
$$;

create or replace function finance.budget_earmark_disabled()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  raise exception using errcode = 'P0001', message = 'budget_invalid: earmarks are disabled until PR4';
end;
$$;

create or replace function finance.budget_validate_version()
returns trigger language plpgsql set search_path = pg_temp as $$
declare
  v_parent record;
begin
  if new.parent_version_id is not null then
    select * into v_parent from finance.budget_versions
    where household_id = new.household_id and id = new.parent_version_id;
    if not found or v_parent.id = new.id or v_parent.state <> 'published' then
      raise exception using errcode = 'P0001', message = 'budget_invalid: parent must be a distinct published version';
    end if;
    if new.state = 'published' and new.version_number is not null
       and v_parent.version_number >= new.version_number then
      raise exception using errcode = 'P0001', message = 'budget_invalid: published parent must precede its child';
    end if;
  end if;
  return new;
end;
$$;

create or replace function finance.budget_allocation_set_lifecycle()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'P0001', message = 'budget_forbidden: allocation sets are append-only';
  end if;
  if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
    raise exception using errcode = 'P0001', message = 'budget_forbidden: allocation sets are immutable';
  end if;
  if not (
    new.status = old.status
    or (old.status = 'current' and new.status in ('needs_review', 'superseded'))
    or (old.status = 'needs_review' and new.status = 'superseded')
  ) then
    raise exception using errcode = 'P0001', message = 'budget_invalid: invalid allocation set status transition';
  end if;
  return new;
end;
$$;

create or replace function finance.budget_published_line_guard()
returns trigger language plpgsql set search_path = pg_temp as $$
declare
  v_version record;
  v_old_household_id uuid;
  v_old_version_id uuid;
  v_new_household_id uuid;
  v_new_version_id uuid;
begin
  -- Lock both headers in UUID order before checking publication state.
  if tg_op <> 'INSERT' then
    v_old_household_id := old.household_id;
    v_old_version_id := old.version_id;
  end if;
  if tg_op <> 'DELETE' then
    v_new_household_id := new.household_id;
    v_new_version_id := new.version_id;
  end if;
  for v_version in
    select id, state
    from finance.budget_versions
    where (household_id, id) = (v_old_household_id, v_old_version_id)
       or (household_id, id) = (v_new_household_id, v_new_version_id)
    order by id
    for update
  loop
    if v_version.state = 'published' then
      raise exception using errcode = 'P0001', message = 'budget_forbidden: published budget lines are immutable';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function finance.budget_check_allocation_split_for_set(
  p_household_id uuid,
  p_set_id uuid
)
returns void language plpgsql set search_path = pg_temp as $$
declare
  v_expected numeric;
  v_component_count bigint;
  v_component_total numeric;
begin
  select source_amount_cents::numeric into v_expected
  from finance.budget_allocation_sets
  where household_id = p_household_id and id = p_set_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'budget_invalid: allocation set not found';
  end if;
  select count(*), coalesce(sum(amount_cents), 0)::numeric
  into v_component_count, v_component_total
  from finance.budget_allocations
  where household_id = p_household_id and set_id = p_set_id;
  if v_component_count < 1 then
    raise exception using errcode = 'P0001', message = 'budget_incomplete: allocation split requires at least one component';
  end if;
  if v_component_total <> v_expected then
    raise exception using errcode = 'P0001', message = 'budget_invalid: allocation split does not equal source amount';
  end if;
end;
$$;

create or replace function finance.budget_check_allocation_split()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  if tg_table_name = 'budget_allocation_sets' then
    if tg_op <> 'DELETE' then
      perform finance.budget_check_allocation_split_for_set(new.household_id, new.id);
    end if;
  elsif tg_op = 'INSERT' then
    perform finance.budget_check_allocation_split_for_set(new.household_id, new.set_id);
  elsif tg_op = 'DELETE' then
    perform finance.budget_check_allocation_split_for_set(old.household_id, old.set_id);
  else
    perform finance.budget_check_allocation_split_for_set(old.household_id, old.set_id);
    if (new.household_id, new.set_id) is distinct from (old.household_id, old.set_id) then
      perform finance.budget_check_allocation_split_for_set(new.household_id, new.set_id);
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function finance.budget_validate_allocation_set()
returns trigger language plpgsql set search_path = pg_temp as $$
declare
  v_previous record;
  v_transaction_id text;
begin
  if new.supersedes_id is not null then
    select * into v_previous from finance.budget_allocation_sets
    where household_id = new.household_id and id = new.supersedes_id;
    if not found or v_previous.transaction_id is distinct from new.transaction_id
       or v_previous.utility_entry_id is distinct from new.utility_entry_id
       or v_previous.revision_number >= new.revision_number then
      raise exception using errcode = 'P0001', message = 'budget_invalid: supersession must retain source and advance revision';
    end if;
  end if;
  if new.classification_id is not null then
    select transaction_id into v_transaction_id from finance.transaction_classifications
    where household_id = new.household_id and id = new.classification_id;
    if v_transaction_id is distinct from new.transaction_id then
      raise exception using errcode = 'P0001', message = 'budget_invalid: classification source mismatch';
    end if;
  end if;
  if new.treatment_id is not null then
    select transaction_id into v_transaction_id from finance.transaction_treatments
    where household_id = new.household_id and id = new.treatment_id;
    if v_transaction_id is distinct from new.transaction_id then
      raise exception using errcode = 'P0001', message = 'budget_invalid: treatment source mismatch';
    end if;
  end if;
  return new;
end;
$$;

create or replace function finance.budget_validate_allocation_insert()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  if exists (
    select 1 from finance.budget_allocation_sets as allocation_set
    join finance.budget_commands as command
      on command.household_id = allocation_set.household_id
     and command.command_id = allocation_set.command_id
    where allocation_set.household_id = new.household_id and allocation_set.id = new.set_id
  ) then
    raise exception using errcode = 'P0001', message = 'budget_forbidden: completed allocation sets cannot receive components';
  end if;
  return new;
end;
$$;

create or replace function finance.budget_validate_refund()
returns trigger language plpgsql set search_path = pg_temp as $$
declare
  v_original record;
begin
  if new.effect_kind <> 'refund' then return new; end if;
  if new.original_refund_allocation_id is null then
    if btrim(coalesce(new.opening_refund_reason, '')) = '' then
      raise exception using errcode = 'P0001', message = 'budget_invalid: opening refund requires a reason';
    end if;
    return new;
  end if;
  select * into v_original from finance.budget_allocations
  where household_id = new.household_id and id = new.original_refund_allocation_id;
  if not found or v_original.fund_id is distinct from new.fund_id
     or v_original.amount_cents >= 0
     or v_original.effect_kind not in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment') then
    raise exception using errcode = 'P0001', message = 'budget_invalid: refund must link same fund negative purpose outflow';
  end if;
  return new;
end;
$$;

create or replace function finance.budget_validate_movement()
returns trigger language plpgsql set search_path = pg_temp as $$
declare
  v_original record;
  v_expected_kind text;
begin
  if (new.correction_of is null) <> (new.correction_role is null) then
    raise exception using errcode = 'P0001', message = 'budget_invalid: correction reference and role must be supplied together';
  end if;
  if new.correction_of is null then return new; end if;
  select * into v_original from finance.fund_movements
  where household_id = new.household_id and id = new.correction_of;
  if not found or v_original.correction_of is not null or v_original.id = new.id then
    raise exception using errcode = 'P0001', message = 'budget_invalid: correction must reference an original movement';
  end if;
  if new.correction_role = 'reversal' then
    v_expected_kind := case v_original.kind
      when 'opening' then 'release'
      when 'assign' then 'release'
      when 'release' then 'assign'
      when 'reallocate' then 'reallocate'
    end;
    if new.amount_cents <> v_original.amount_cents
       or new.kind <> v_expected_kind
       or new.effective_on <> v_original.effective_on
       or new.from_fund_id is distinct from v_original.to_fund_id
       or new.to_fund_id is distinct from v_original.from_fund_id then
      raise exception using errcode = 'P0001', message = 'budget_invalid: reversal must exactly oppose its original movement';
    end if;
  end if;
  return new;
end;
$$;

create or replace function finance.budget_validate_movement_replacement()
returns trigger language plpgsql set search_path = pg_temp as $$
begin
  if new.correction_role = 'replacement' and not exists (
    select 1 from finance.fund_movements as reversal
    where reversal.household_id = new.household_id
      and reversal.correction_of = new.correction_of
      and reversal.correction_role = 'reversal'
      and reversal.command_id = new.command_id
  ) then
    raise exception using errcode = 'P0001', message = 'budget_incomplete: replacement requires a reversal in the same command';
  end if;
  return new;
end;
$$;

create table finance.funds (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  name text not null check (btrim(name) <> ''),
  beneficiary_scope text not null check (beneficiary_scope in ('shared', 'member')),
  beneficiary_member_id uuid,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  unique (household_id, id),
  foreign key (household_id, beneficiary_member_id) references finance.household_members(household_id, id),
  foreign key (household_id, created_by) references finance.household_members(household_id, id),
  check ((beneficiary_scope = 'shared' and beneficiary_member_id is null) or (beneficiary_scope = 'member' and beneficiary_member_id is not null))
);

create table finance.budget_versions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  version_number bigint,
  parent_version_id uuid,
  state text not null default 'draft' check (state in ('draft', 'published')),
  draft_revision bigint not null default 1 check (draft_revision > 0),
  starts_on_cycle date not null check (extract(day from starts_on_cycle) = 23),
  published_at timestamptz,
  actor_id uuid not null,
  reason text not null default '',
  calculation_version text not null default 'household-budget-v1',
  income_assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(income_assumptions) = 'array'),
  source_references jsonb not null default '[]'::jsonb check (jsonb_typeof(source_references) = 'array'),
  created_at timestamptz not null default now(),
  unique (household_id, id),
  foreign key (household_id, parent_version_id) references finance.budget_versions(household_id, id),
  foreign key (household_id, actor_id) references finance.household_members(household_id, id),
  check ((state = 'draft' and version_number is null and published_at is null) or (state = 'published' and version_number is not null and version_number > 0 and published_at is not null and btrim(reason) <> ''))
);
create unique index budget_versions_published_number_key on finance.budget_versions (household_id, version_number) where state = 'published';

create table finance.budget_lines (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references finance.households(id), version_id uuid not null,
  stable_line_id uuid not null, fund_id uuid not null, name text not null check (btrim(name) <> ''), category_id uuid,
  category_name_snapshot text, group_name_snapshot text, beneficiary_scope text not null check (beneficiary_scope in ('shared', 'member')),
  beneficiary_member_id uuid, planned_payer_member_id uuid, kind text not null check (kind in ('consumption', 'contribution', 'debt_commitment')),
  contribution_cents bigint not null default 0 check (contribution_cents >= 0), funding_behaviour text not null check (funding_behaviour in ('cycle_allowance', 'accumulating', 'target_by_date', 'reserve_target')),
  target_cents bigint check (target_cents is null or target_cents >= 0), due_on date, recurrence text not null check (recurrence in ('cycle', 'annual', 'once')),
  rollover_policy text not null check (rollover_policy in ('carry', 'release_explicit')), expected_payment_on date, expected_payment_account_id uuid, match_category_id uuid,
  unique (household_id, id), unique (version_id, stable_line_id), unique (version_id, fund_id),
  foreign key (household_id, version_id) references finance.budget_versions(household_id, id), foreign key (household_id, fund_id) references finance.funds(household_id, id),
  foreign key (household_id, category_id) references finance.categories(household_id, id), foreign key (household_id, beneficiary_member_id) references finance.household_members(household_id, id),
  foreign key (household_id, planned_payer_member_id) references finance.household_members(household_id, id), foreign key (household_id, expected_payment_account_id) references public.accounts(household_id, account_id),
  foreign key (household_id, match_category_id) references finance.categories(household_id, id),
  check ((beneficiary_scope = 'shared' and beneficiary_member_id is null) or (beneficiary_scope = 'member' and beneficiary_member_id is not null)),
  check (funding_behaviour <> 'target_by_date' or (target_cents is not null and due_on is not null)), check (funding_behaviour <> 'reserve_target' or target_cents is not null)
);

create table finance.budget_commands (
  household_id uuid not null references finance.households(id), command_id uuid not null, kind text not null check (btrim(kind) <> ''),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'), actor_id uuid not null, result jsonb not null check (jsonb_typeof(result) = 'object'),
  completed_at timestamptz not null default now(), primary key (household_id, command_id),
  foreign key (household_id, actor_id) references finance.household_members(household_id, id)
);

create table finance.budget_allocation_sets (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references finance.households(id), transaction_id text, utility_entry_id uuid,
  source_snapshot jsonb not null check (jsonb_typeof(source_snapshot) = 'object'), source_fingerprint text not null check (btrim(source_fingerprint) <> ''),
  source_amount_cents bigint not null, occurred_on date not null, revision_number bigint not null check (revision_number > 0), supersedes_id uuid,
  status text not null default 'current' check (status in ('current', 'needs_review', 'superseded')), actor_id uuid not null, recorded_at timestamptz not null default now(),
  command_id uuid not null, classification_id uuid, treatment_id uuid, evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  unique (household_id, id), unique (household_id, transaction_id, revision_number), unique (household_id, utility_entry_id, revision_number),
  foreign key (household_id, transaction_id) references public.transactions(household_id, id), foreign key (utility_entry_id) references consumption.ledger_entries(id),
  foreign key (household_id, supersedes_id) references finance.budget_allocation_sets(household_id, id), foreign key (household_id, actor_id) references finance.household_members(household_id, id),
  foreign key (household_id, command_id) references finance.budget_commands(household_id, command_id) deferrable initially deferred,
  foreign key (household_id, classification_id) references finance.transaction_classifications(household_id, id), foreign key (household_id, treatment_id) references finance.transaction_treatments(household_id, id),
  check ((transaction_id is not null) <> (utility_entry_id is not null)),
  check ((revision_number = 1 and supersedes_id is null) or (revision_number > 1 and supersedes_id is not null)),
  check (utility_entry_id is null)
);
create unique index budget_allocation_sets_live_transaction_key on finance.budget_allocation_sets (household_id, transaction_id) where transaction_id is not null and status in ('current', 'needs_review');
create unique index budget_allocation_sets_live_utility_key on finance.budget_allocation_sets (household_id, utility_entry_id) where utility_entry_id is not null and status in ('current', 'needs_review');

create table finance.budget_allocations (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references finance.households(id), set_id uuid not null,
  ordinal integer not null check (ordinal >= 0), amount_cents bigint not null, fund_id uuid, category_id uuid, category_name_snapshot text,
  beneficiary_scope text not null check (beneficiary_scope in ('shared', 'member')), beneficiary_member_id uuid, paid_by_member_id uuid, payment_account_id uuid,
  effect_kind text not null check (effect_kind in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment', 'refund', 'income', 'financing', 'movement', 'unresolved')),
  original_refund_allocation_id uuid, opening_refund_reason text, financial_event_id uuid,
  unique (household_id, id), unique (set_id, ordinal), foreign key (household_id, set_id) references finance.budget_allocation_sets(household_id, id),
  foreign key (household_id, fund_id) references finance.funds(household_id, id), foreign key (household_id, category_id) references finance.categories(household_id, id),
  foreign key (household_id, beneficiary_member_id) references finance.household_members(household_id, id), foreign key (household_id, paid_by_member_id) references finance.household_members(household_id, id),
  foreign key (household_id, payment_account_id) references public.accounts(household_id, account_id),
  foreign key (household_id, original_refund_allocation_id) references finance.budget_allocations(household_id, id),
  foreign key (household_id, financial_event_id) references finance.financial_events(household_id, id),
  check ((beneficiary_scope = 'shared' and beneficiary_member_id is null) or (beneficiary_scope = 'member' and beneficiary_member_id is not null)),
  check (amount_cents <> 0 or effect_kind in ('income', 'financing', 'movement', 'unresolved')),
  check (effect_kind not in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment') or (amount_cents < 0 and fund_id is not null)),
  check (effect_kind <> 'refund' or (amount_cents > 0 and fund_id is not null and (original_refund_allocation_id is not null or btrim(coalesce(opening_refund_reason, '')) <> '')))
);

create table finance.budget_reconciliations (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references finance.households(id), as_of timestamptz not null, actor_id uuid not null,
  status text not null check (status in ('complete', 'incomplete')), coverage_snapshot jsonb not null check (jsonb_typeof(coverage_snapshot) = 'object'),
  opening_fund_cutover date, notes text not null, recorded_at timestamptz not null default now(), unique (household_id, id),
  foreign key (household_id, actor_id) references finance.household_members(household_id, id)
);

create table finance.fund_movements (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references finance.households(id), from_fund_id uuid, to_fund_id uuid,
  amount_cents bigint not null check (amount_cents > 0), kind text not null check (kind in ('opening', 'assign', 'release', 'reallocate')),
  effective_on date not null, recorded_at timestamptz not null default now(), actor_id uuid not null, command_id uuid not null,
  budget_version_id uuid, reconciliation_id uuid, correction_of uuid, reason text not null check (btrim(reason) <> ''),
  funding_occurrence_key text, correction_role text check (correction_role is null or correction_role in ('reversal', 'replacement')),
  unique (household_id, id), foreign key (household_id, from_fund_id) references finance.funds(household_id, id),
  foreign key (household_id, to_fund_id) references finance.funds(household_id, id), foreign key (household_id, actor_id) references finance.household_members(household_id, id),
  foreign key (household_id, command_id) references finance.budget_commands(household_id, command_id) deferrable initially deferred,
  foreign key (household_id, budget_version_id) references finance.budget_versions(household_id, id),
  foreign key (household_id, reconciliation_id) references finance.budget_reconciliations(household_id, id),
  foreign key (household_id, correction_of) references finance.fund_movements(household_id, id),
  check ((kind in ('opening', 'assign') and from_fund_id is null and to_fund_id is not null) or (kind = 'release' and from_fund_id is not null and to_fund_id is null) or (kind = 'reallocate' and from_fund_id is not null and to_fund_id is not null and from_fund_id <> to_fund_id)),
  check ((correction_of is null) = (correction_role is null)), check (correction_of is null or correction_of <> id)
);
create unique index fund_movements_occurrence_key on finance.fund_movements (household_id, funding_occurrence_key) where funding_occurrence_key is not null and correction_role is null;
create unique index fund_movements_reversal_key on finance.fund_movements (household_id, correction_of) where correction_role = 'reversal';
create unique index fund_movements_replacement_key on finance.fund_movements (household_id, correction_of) where correction_role = 'replacement';

create table finance.budget_account_settings (
  household_id uuid not null references finance.households(id), account_id uuid not null, owner_scope text not null check (owner_scope in ('shared', 'member')), owner_member_id uuid,
  included boolean not null, exclusion_reason text, resource_class text not null check (resource_class in ('liquid', 'restricted', 'mortgage', 'card', 'tracking_only')),
  settlement_account_id uuid, usual_due_day integer check (usual_due_day between 1 and 31), freshness_hours integer not null check (freshness_hours > 0),
  transaction_sign_convention text not null check (transaction_sign_convention in ('outflow_negative', 'outflow_positive', 'unknown')),
  sign_evidence text, utility_device_id uuid, updated_at timestamptz not null default now(), actor_id uuid not null,
  primary key (household_id, account_id), foreign key (household_id, account_id) references public.accounts(household_id, account_id),
  foreign key (household_id, owner_member_id) references finance.household_members(household_id, id),
  foreign key (household_id, settlement_account_id) references public.accounts(household_id, account_id),
  foreign key (household_id, actor_id) references finance.household_members(household_id, id),
  check ((owner_scope = 'shared' and owner_member_id is null) or (owner_scope = 'member' and owner_member_id is not null)),
  check (included or btrim(coalesce(exclusion_reason, '')) <> ''), check (not included or resource_class <> 'tracking_only'),
  check (transaction_sign_convention = 'unknown' or btrim(coalesce(sign_evidence, '')) <> ''), check (utility_device_id is null)
);

create table finance.fund_earmarks (
  id uuid primary key default gen_random_uuid(), household_id uuid not null references finance.households(id), fund_id uuid not null,
  restricted_account_id uuid not null, amount_cents bigint not null check (amount_cents <> 0), effective_on date not null,
  recorded_at timestamptz not null default now(), actor_id uuid not null, command_id uuid not null, fund_movement_id uuid,
  allocation_id uuid, financial_event_id uuid, reconciliation_id uuid, correction_of uuid, reason text not null check (btrim(reason) <> ''),
  unique (household_id, id), foreign key (household_id, fund_id) references finance.funds(household_id, id),
  foreign key (household_id, restricted_account_id) references public.accounts(household_id, account_id),
  foreign key (household_id, actor_id) references finance.household_members(household_id, id),
  foreign key (household_id, command_id) references finance.budget_commands(household_id, command_id) deferrable initially deferred,
  foreign key (household_id, fund_movement_id) references finance.fund_movements(household_id, id),
  foreign key (household_id, allocation_id) references finance.budget_allocations(household_id, id),
  foreign key (household_id, financial_event_id) references finance.financial_events(household_id, id),
  foreign key (household_id, reconciliation_id) references finance.budget_reconciliations(household_id, id),
  foreign key (household_id, correction_of) references finance.fund_earmarks(household_id, id),
  check (((fund_movement_id is not null)::integer + (allocation_id is not null)::integer + (financial_event_id is not null)::integer + (reconciliation_id is not null)::integer) = 1)
);

create index budget_funds_household_idx on finance.funds (household_id);
create index budget_versions_cycle_publish_idx on finance.budget_versions (household_id, starts_on_cycle, state, version_number, published_at desc);
create index budget_lines_household_version_idx on finance.budget_lines (household_id, version_id);
create index budget_allocations_set_idx on finance.budget_allocations (household_id, set_id);
create index budget_allocations_fund_set_idx on finance.budget_allocations (household_id, fund_id, set_id) where fund_id is not null;
create index budget_movements_to_fund_effective_idx on finance.fund_movements (household_id, to_fund_id, effective_on);
create index budget_movements_from_fund_effective_idx on finance.fund_movements (household_id, from_fund_id, effective_on);
create index budget_earmarks_account_idx on finance.fund_earmarks (household_id, restricted_account_id, effective_on);
create index budget_earmarks_fund_effective_idx on finance.fund_earmarks (household_id, fund_id, effective_on);

create trigger budget_versions_validate before insert or update on finance.budget_versions for each row execute function finance.budget_validate_version();
create trigger budget_versions_immutable_published before update or delete on finance.budget_versions for each row when (old.state = 'published') execute function finance.budget_immutable_row();
create trigger budget_lines_immutable_published before insert or update or delete on finance.budget_lines for each row execute function finance.budget_published_line_guard();
create trigger budget_commands_immutable before update or delete on finance.budget_commands for each row execute function finance.budget_immutable_row();
create trigger budget_allocation_sets_lifecycle before update or delete on finance.budget_allocation_sets for each row execute function finance.budget_allocation_set_lifecycle();
create trigger budget_allocation_sets_validate before insert or update on finance.budget_allocation_sets for each row execute function finance.budget_validate_allocation_set();
create trigger budget_allocation_sets_utility_disabled before insert or update on finance.budget_allocation_sets for each row when (new.utility_entry_id is not null) execute function finance.budget_utility_source_disabled();
create trigger budget_allocations_immutable before update or delete on finance.budget_allocations for each row execute function finance.budget_immutable_row();
create trigger budget_allocations_completed_set_guard before insert on finance.budget_allocations for each row execute function finance.budget_validate_allocation_insert();
create trigger budget_allocations_validate_refund before insert or update on finance.budget_allocations for each row execute function finance.budget_validate_refund();
create constraint trigger budget_allocations_split_check after insert or update or delete on finance.budget_allocations deferrable initially deferred for each row execute function finance.budget_check_allocation_split();
create constraint trigger budget_allocation_sets_split_check after insert or update or delete on finance.budget_allocation_sets deferrable initially deferred for each row execute function finance.budget_check_allocation_split();
create trigger fund_movements_immutable before update or delete on finance.fund_movements for each row execute function finance.budget_immutable_row();
create trigger fund_movements_validate before insert or update on finance.fund_movements for each row execute function finance.budget_validate_movement();
create constraint trigger fund_movements_replacement_check after insert or update on finance.fund_movements deferrable initially deferred for each row execute function finance.budget_validate_movement_replacement();
create trigger reconciliations_immutable before update or delete on finance.budget_reconciliations for each row execute function finance.budget_immutable_row();
create trigger budget_earmarks_disabled before insert or update on finance.fund_earmarks for each row execute function finance.budget_earmark_disabled();
create trigger earmarks_immutable before update or delete on finance.fund_earmarks for each row execute function finance.budget_immutable_row();

do $$
declare
  v_table text;
begin
  foreach v_table in array array['funds', 'budget_versions', 'budget_lines', 'budget_commands', 'budget_allocation_sets', 'budget_allocations', 'fund_movements', 'budget_account_settings', 'budget_reconciliations', 'fund_earmarks'] loop
    execute format('alter table finance.%I enable row level security', v_table);
    execute format('create policy %I on finance.%I for select to authenticated using (finance.is_household_member(household_id))', 'budget_member_read_' || v_table, v_table);
    execute format('revoke all on table finance.%I from public, anon, authenticated, service_role', v_table);
    execute format('grant select on table finance.%I to authenticated', v_table);
  end loop;
end;
$$;

revoke all on function finance.budget_immutable_row() from public, anon, authenticated, service_role;
revoke all on function finance.budget_utility_source_disabled() from public, anon, authenticated, service_role;
revoke all on function finance.budget_earmark_disabled() from public, anon, authenticated, service_role;
revoke all on function finance.budget_validate_version() from public, anon, authenticated, service_role;
revoke all on function finance.budget_allocation_set_lifecycle() from public, anon, authenticated, service_role;
revoke all on function finance.budget_published_line_guard() from public, anon, authenticated, service_role;
revoke all on function finance.budget_check_allocation_split_for_set(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function finance.budget_check_allocation_split() from public, anon, authenticated, service_role;
revoke all on function finance.budget_validate_allocation_set() from public, anon, authenticated, service_role;
revoke all on function finance.budget_validate_allocation_insert() from public, anon, authenticated, service_role;
revoke all on function finance.budget_validate_refund() from public, anon, authenticated, service_role;
revoke all on function finance.budget_validate_movement() from public, anon, authenticated, service_role;
revoke all on function finance.budget_validate_movement_replacement() from public, anon, authenticated, service_role;
