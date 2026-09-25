create table if not exists finance.sync_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  source_system text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  error text
);

create table if not exists finance.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  name text not null,
  slug text not null,
  group_name text,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (household_id, slug)
);

create table if not exists finance.source_categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  source_system text not null,
  source_category_id text not null,
  name text not null,
  group_name text,
  lifecycle_status text not null default 'active',
  observed_at timestamptz not null default now(),
  raw_payload jsonb,
  raw_payload_hash text,
  unique (household_id, source_system, source_category_id)
);

alter table public.transactions
  drop constraint if exists transactions_owned_category_id_fkey;
alter table public.transactions
  add constraint transactions_owned_category_id_fkey
  foreign key (owned_category_id) references finance.categories(id);

create table if not exists finance.transaction_source_observations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  transaction_id text not null references public.transactions(id),
  sync_run_id uuid references finance.sync_runs(id),
  observed_at timestamptz not null default now(),
  source_updated_at timestamptz,
  raw_payload jsonb not null,
  raw_payload_hash text not null,
  unique (transaction_id, raw_payload_hash)
);

create table if not exists finance.financial_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  event_type text not null check (event_type in (
    'internal_movement', 'reserve_funding', 'internal_conversion', 'settlement', 'purchase', 'income'
  )),
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'superseded')),
  created_at timestamptz not null default now()
);

create table if not exists finance.financial_event_legs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  event_id uuid not null references finance.financial_events(id),
  transaction_id text not null references public.transactions(id),
  leg_role text not null check (leg_role in (
    'economic_recognition', 'mirror', 'staging', 'reserve_funding', 'internal_conversion', 'settlement'
  )),
  status text not null default 'active' check (status in ('active', 'superseded')),
  created_at timestamptz not null default now()
);

create unique index if not exists financial_event_legs_one_active
  on finance.financial_event_legs (transaction_id)
  where status = 'active';

create table if not exists finance.transaction_classifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  transaction_id text not null references public.transactions(id),
  category_id uuid not null references finance.categories(id),
  decision_source text not null check (decision_source in ('imported', 'rule', 'jev', 'agent', 'user', 'policy')),
  status text not null check (status in ('proposed', 'confirmed', 'rejected', 'superseded')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  actor_id uuid,
  run_id uuid,
  reason text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  superseded_at timestamptz
);

create unique index if not exists transaction_classifications_one_confirmed
  on finance.transaction_classifications (transaction_id)
  where status = 'confirmed';

create table if not exists finance.transaction_treatments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  transaction_id text not null references public.transactions(id),
  is_transfer boolean not null,
  exclude_from_spend boolean not null,
  nature text,
  event_id uuid references finance.financial_events(id),
  leg_role text check (leg_role is null or leg_role in (
    'economic_recognition', 'mirror', 'staging', 'reserve_funding', 'internal_conversion', 'settlement'
  )),
  decision_source text not null check (decision_source in ('imported', 'rule', 'jev', 'agent', 'user', 'policy')),
  status text not null check (status in ('proposed', 'confirmed', 'rejected', 'superseded')),
  created_at timestamptz not null default now(),
  superseded_at timestamptz
);

create unique index if not exists transaction_treatments_one_confirmed
  on finance.transaction_treatments (transaction_id)
  where status = 'confirmed';

create table if not exists finance.classification_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  transaction_id text references public.transactions(id),
  classifier text not null check (classifier in ('jev', 'agent', 'optimizer')),
  classifier_version text not null,
  model_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  input_token_count integer,
  output_token_count integer,
  error text,
  result jsonb
);

alter table finance.transaction_classifications
  drop constraint if exists transaction_classifications_run_id_fkey;
alter table finance.transaction_classifications
  add constraint transaction_classifications_run_id_fkey
  foreign key (run_id) references finance.classification_runs(id);

create table if not exists finance.classification_proposals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  transaction_id text not null references public.transactions(id),
  run_id uuid references finance.classification_runs(id),
  proposed_category_id uuid references finance.categories(id),
  confidence numeric,
  needs_review boolean not null default true,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'corrected', 'expired')),
  evidence_transaction_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid
);

create table if not exists finance.classification_feedback (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  transaction_id text not null references public.transactions(id),
  proposal_id uuid references finance.classification_proposals(id),
  review_command_id text not null,
  reviewer_id uuid not null,
  action text not null check (action in ('approved', 'rejected', 'corrected')),
  selected_category_id uuid references finance.categories(id),
  note text,
  created_at timestamptz not null default now(),
  unique (household_id, review_command_id)
);

create table if not exists finance.account_semantics (
  account_id uuid primary key references public.accounts(account_id),
  household_id uuid not null references finance.households(id),
  role text not null,
  owner_scope text not null check (owner_scope in ('household', 'external')),
  context text,
  updated_at timestamptz not null default now()
);

create table if not exists finance.relationship_semantics (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  source_account_id uuid not null references public.accounts(account_id),
  destination_account_id uuid references public.accounts(account_id),
  counterparty_key text,
  direction text check (direction is null or direction in ('debit', 'credit')),
  event_type text,
  default_leg_role text,
  default_category_id uuid references finance.categories(id),
  default_is_transfer boolean,
  effective_from date,
  effective_to date,
  provenance text not null,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed', 'superseded')),
  context text,
  created_at timestamptz not null default now()
);

alter table finance.households enable row level security;
alter table finance.household_members enable row level security;
alter table finance.categories enable row level security;
alter table finance.transaction_classifications enable row level security;
alter table finance.transaction_treatments enable row level security;
alter table finance.financial_events enable row level security;
alter table finance.financial_event_legs enable row level security;

create policy finance_household_read on finance.households
  for select to authenticated
  using (finance.is_household_member(id));

create policy finance_member_read on finance.household_members
  for select to authenticated
  using (finance.is_household_member(household_id));

create policy finance_categories_read on finance.categories
  for select to authenticated
  using (finance.is_household_member(household_id));

create policy finance_classifications_read on finance.transaction_classifications
  for select to authenticated
  using (finance.is_household_member(household_id));

create policy finance_treatments_read on finance.transaction_treatments
  for select to authenticated
  using (finance.is_household_member(household_id));

create policy finance_events_read on finance.financial_events
  for select to authenticated
  using (finance.is_household_member(household_id));

create policy finance_legs_read on finance.financial_event_legs
  for select to authenticated
  using (finance.is_household_member(household_id));

grant usage on schema finance to authenticated, service_role;
grant select on all tables in schema finance to authenticated, service_role;
