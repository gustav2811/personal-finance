-- Bank Zero email evidence is separate from the existing FinWise transaction
-- projection. Internal movement UUIDs never enter the FinWise ID namespace.

create unique index if not exists accounts_household_account_id_key
  on public.accounts (household_id, account_id);

create table if not exists finance.bank_zero_routes (
  household_id uuid not null references finance.households(id),
  route_key text not null,
  member_id uuid,
  forwarding_address text not null,
  status text not null default 'pending_verification'
    check (status in ('pending_verification', 'active', 'paused')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, route_key),
  foreign key (household_id, member_id)
    references finance.household_members(household_id, id)
);

create table if not exists finance.bank_zero_account_aliases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  route_key text not null,
  account_id uuid not null references public.accounts(account_id),
  alias_normalized text not null,
  alias_display text not null,
  account_number text,
  valid_from date not null default date '1900-01-01',
  valid_to date,
  status text not null default 'pending_sample'
    check (status in ('pending_sample', 'active', 'retired')),
  evidence_note text,
  created_at timestamptz not null default now(),
  foreign key (household_id, route_key)
    references finance.bank_zero_routes(household_id, route_key),
  check (valid_to is null or valid_to >= valid_from)
);

-- Route-level rollout gates keep later message classes durably deferred until
-- their matching and publication behavior has been enabled and verified.
create table if not exists finance.bank_zero_route_capabilities (
  household_id uuid not null,
  route_key text not null,
  message_class text not null check (message_class in (
    'money_received', 'paid', 'card_purchase', 'card_refund', 'payment_returned',
    'fee', 'proof_of_payment', 'statement', 'banking_status'
  )),
  enabled boolean not null default false,
  enabled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (household_id, route_key, message_class),
  foreign key (household_id, route_key)
    references finance.bank_zero_routes(household_id, route_key)
);

create unique index if not exists bank_zero_account_alias_exact_identity
  on finance.bank_zero_account_aliases
    (household_id, route_key, alias_normalized, coalesce(account_number, ''), valid_from);
create index if not exists bank_zero_account_alias_lookup
  on finance.bank_zero_account_aliases
    (household_id, route_key, alias_normalized, account_number)
  where status = 'active';

create table if not exists finance.bank_zero_received_emails (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  route_key text not null,
  original_message_id text,
  dedupe_key text not null,
  raw_r2_key text not null,
  raw_sha256 text not null check (raw_sha256 ~ '^[0-9a-f]{64}$'),
  receipt_metadata jsonb not null default '{}'::jsonb,
  received_at timestamptz not null,
  processing_outcome text not null default 'received'
    check (processing_outcome in ('received', 'processed', 'deferred', 'ignored', 'needs_review', 'retryable_failure', 'terminal_failure')),
  outcome_reason text,
  source_expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, route_key, dedupe_key),
  foreign key (household_id, route_key)
    references finance.bank_zero_routes(household_id, route_key)
);
create unique index if not exists bank_zero_received_emails_household_id_key
  on finance.bank_zero_received_emails (household_id, id);

create table if not exists finance.bank_zero_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  route_key text not null,
  received_email_id uuid not null references finance.bank_zero_received_emails(id),
  transport_id text not null,
  received_at timestamptz not null,
  envelope jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (household_id, route_key, transport_id),
  foreign key (household_id, route_key)
    references finance.bank_zero_routes(household_id, route_key)
);

create table if not exists finance.bank_zero_observations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  received_email_id uuid not null references finance.bank_zero_received_emails(id),
  evidence_key text not null,
  observation_kind text not null check (observation_kind in (
    'alert', 'proof', 'statement', 'balance_snapshot', 'non_transaction', 'unknown'
  )),
  parser_version text not null,
  raw_values jsonb not null default '{}'::jsonb,
  parsed_values jsonb not null default '{}'::jsonb,
  field_provenance jsonb not null default '{}'::jsonb,
  status text not null default 'observed' check (status in (
    'observed', 'matched', 'needs_review', 'deferred', 'ignored', 'invalid'
  )),
  review_reason text,
  occurred_at timestamptz,
  posted_on date,
  created_at timestamptz not null default now(),
  unique (household_id, received_email_id, evidence_key),
  foreign key (household_id, received_email_id)
    references finance.bank_zero_received_emails(household_id, id)
);
create unique index if not exists bank_zero_observations_household_id_key
  on finance.bank_zero_observations (household_id, id);

create table if not exists finance.bank_zero_movements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  route_key text not null,
  member_id uuid not null,
  account_id uuid not null references public.accounts(account_id),
  movement_type text not null check (movement_type in (
    'payment', 'receipt', 'card_purchase', 'card_refund', 'return', 'fee',
    'transfer_leg', 'interest', 'statement_movement', 'other'
  )),
  payment_method text check (payment_method is null or payment_method in (
    'ordinary_payment', 'immediate_payment', 'card', 'fee', 'statement'
  )),
  amount numeric(20,2) not null check (amount <> 0),
  currency_code text not null,
  occurred_at timestamptz,
  event_precision text not null default 'unknown'
    check (event_precision in ('minute', 'day', 'unknown')),
  posted_on date,
  counterparty text,
  payment_reference text,
  display_description text,
  reconciliation_state text not null default 'alert_observed'
    check (reconciliation_state in ('alert_observed', 'statement_confirmed', 'needs_review')),
  publication_state text not null default 'deferred'
    check (publication_state in ('pending', 'in_progress', 'published', 'retryable_failure', 'outcome_unknown', 'terminal_failure', 'deferred')),
  statement_missing boolean not null default false,
  transfer_group_id uuid,
  refund_of_movement_id uuid references finance.bank_zero_movements(id),
  finwise_transaction_id text,
  last_importer_values jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (household_id, route_key)
    references finance.bank_zero_routes(household_id, route_key),
  foreign key (household_id, member_id)
    references finance.household_members(household_id, id),
  foreign key (household_id, account_id)
    references public.accounts(household_id, account_id),
  unique (household_id, finwise_transaction_id)
);
create unique index if not exists bank_zero_movements_household_id_key
  on finance.bank_zero_movements (household_id, id);

create index if not exists bank_zero_movements_candidates
  on finance.bank_zero_movements (household_id, account_id, occurred_at, amount, currency_code)
  where reconciliation_state <> 'needs_review';

create table if not exists finance.bank_zero_evidence_links (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  observation_id uuid not null references finance.bank_zero_observations(id),
  movement_id uuid not null references finance.bank_zero_movements(id),
  relation text not null check (relation in (
    'created_from', 'supports', 'confirms', 'refund_of', 'return_of', 'transfer_pair'
  )),
  matching_method text not null,
  decision_reason text,
  reviewed_by uuid references finance.household_members(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (household_id, observation_id, movement_id),
  foreign key (household_id, observation_id)
    references finance.bank_zero_observations(household_id, id),
  foreign key (household_id, movement_id)
    references finance.bank_zero_movements(household_id, id)
);

create table if not exists finance.bank_zero_publication_outbox (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  movement_id uuid not null references finance.bank_zero_movements(id),
  desired_revision integer not null default 1,
  operation_id uuid not null default gen_random_uuid(),
  operation text not null check (operation in ('create', 'update', 'project')),
  state text not null default 'pending' check (state in (
    'pending', 'in_progress', 'published', 'retryable_failure', 'outcome_unknown', 'terminal_failure', 'needs_review'
  )),
  exact_request jsonb not null,
  candidate_remote_ids text[] not null default '{}',
  finwise_transaction_id text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, movement_id, desired_revision),
  unique (operation_id),
  foreign key (household_id, movement_id)
    references finance.bank_zero_movements(household_id, id)
);

create index if not exists bank_zero_outbox_claim
  on finance.bank_zero_publication_outbox (next_attempt_at, created_at)
  where state in ('pending', 'retryable_failure');

create table if not exists finance.bank_zero_observation_audit (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  observation_id uuid references finance.bank_zero_observations(id),
  movement_id uuid references finance.bank_zero_movements(id),
  actor_member_id uuid references finance.household_members(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists finance.bank_zero_legacy_keys (
  household_id uuid not null references finance.households(id),
  account_id uuid not null references public.accounts(account_id),
  legacy_key text not null,
  movement_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (household_id, account_id, legacy_key),
  foreign key (household_id, movement_id)
    references finance.bank_zero_movements(household_id, id)
);

create table if not exists finance.bank_zero_balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  route_key text not null,
  account_id uuid not null references public.accounts(account_id),
  amount numeric(20,2) not null check (amount >= 0),
  currency_code text not null default 'ZAR',
  observed_at timestamptz not null,
  source_observation_id uuid not null references finance.bank_zero_observations(id),
  created_at timestamptz not null default now(),
  foreign key (household_id, route_key)
    references finance.bank_zero_routes(household_id, route_key),
  foreign key (household_id, account_id)
    references public.accounts(household_id, account_id),
  unique (household_id, source_observation_id, account_id)
);

-- Profiles and alias registrations are explicit and remain disabled until the
-- receiving route and each account alias pass the evidence checks in the PRD.
insert into finance.bank_zero_routes (
  household_id, route_key, member_id, forwarding_address, status
)
select member.household_id, seed.route_key, member.id, seed.forwarding_address,
       'pending_verification'
from (values
  ('gustav', 'gustav+bankzero@klingbiel.org'),
  ('cara', 'cara.finance@klingbiel.org')
) as seed(route_key, forwarding_address)
join finance.household_members member
  on lower(member.email) = case seed.route_key
    when 'gustav' then 'gustav@klingbiel.org'
    else 'cara@klingbiel.org'
  end
on conflict (household_id, route_key) do update set
  forwarding_address = excluded.forwarding_address,
  updated_at = now();

insert into finance.bank_zero_routes (
  household_id, route_key, member_id, forwarding_address, status
)
select id, 'unverified', null, 'unverified delivery identity', 'pending_verification'
from finance.households
where id = '00000000-0000-4000-8000-000000000001'
on conflict (household_id, route_key) do nothing;

insert into finance.bank_zero_account_aliases (
  household_id, route_key, account_id, alias_normalized, alias_display,
  account_number, status, evidence_note
)
select route.household_id, seed.route_key, seed.account_id,
       lower(regexp_replace(btrim(seed.alias_display), '\s+', ' ', 'g')),
       seed.alias_display, seed.account_number, 'pending_sample', seed.evidence_note
from (values
  ('gustav', '1660ce38-4b44-4812-8123-26f3514dbc49'::uuid, 'Transactional', '80204387707', 'Transactional account number verified in source records'),
  ('gustav', 'c5b35700-298e-4a9f-bbc2-95314a59b827'::uuid, 'Loft space', null, 'Alias mapping exists; require a genuine matching source sample'),
  ('gustav', 'c5b35700-298e-4a9f-bbc2-95314a59b827'::uuid, 'Bank Zero Savings', null, 'FinWise account name alias; require a genuine matching source sample'),
  ('gustav', '80d18c07-c69a-4354-bbb1-0773aef4b83a'::uuid, 'Euro Trip', null, 'Alias mapping exists; require a genuine matching source sample'),
  ('gustav', '80d18c07-c69a-4354-bbb1-0773aef4b83a'::uuid, 'Bank Zero Gustav 32 Day Notice', null, 'FinWise account name alias; require a genuine matching source sample'),
  ('cara', '258f9b35-a32a-4a6f-97cd-fba0d08d1aca'::uuid, 'Transactional', '80204621122', 'Transactional account number verified in source records'),
  ('cara', 'b2af8a9f-6d02-4878-abdc-b6064edbc22e'::uuid, 'Emergency Savings', null, 'Forwarded statement sample corroborated profile; require provider route verification'),
  ('cara', '0df59676-4a8a-4975-a263-af69687de2e8'::uuid, 'Wedding Gifts Savings', null, 'Forwarded statement sample corroborated profile; exact alias'),
  ('cara', '0df59676-4a8a-4975-a263-af69687de2e8'::uuid, 'Bank Zero Wedding/Home Account', null, 'FinWise account name alias; exact profile-scoped alias'),
  ('cara', 'e42ac63e-6246-45a7-8cea-bf7e57a14b64'::uuid, 'Travel Savings', null, 'Forwarded statement sample corroborated profile; require provider route verification'),
  ('cara', '43dc381f-4322-4702-b7df-2a9a67e97211'::uuid, 'Gifts', null, 'Alias mapping exists; exact profile-scoped alias'),
  ('cara', '43dc381f-4322-4702-b7df-2a9a67e97211'::uuid, 'Bank Zero Gifts', null, 'FinWise account name alias; exact profile-scoped alias'),
  ('cara', '2e606b26-df00-4298-b3f5-8b6feffcc16d'::uuid, 'Short-term Savings', null, 'Forwarded statement sample corroborated profile; require provider route verification'),
  ('cara', '68e0a2b8-2708-4600-bd04-218b295e27ea'::uuid, 'Coffee Machine Savings', null, 'Alias mapping exists; require a genuine matching source sample'),
  ('cara', 'a2aaf332-69d5-4c06-a91d-bfde03a5dd1a'::uuid, '32-day notice', null, 'Alias mapping exists; exact profile-scoped alias'),
  ('cara', '17619d86-3062-4f0a-a097-636b15f89f19'::uuid, 'Gods Money', null, 'Alias mapping exists; require a genuine matching source sample'),
  ('cara', '12eadee4-2b92-4642-9ae2-10fd3fd0a39d'::uuid, 'Personal Care', null, 'Alias mapping exists; require a genuine matching source sample')
) as seed(route_key, account_id, alias_display, account_number, evidence_note)
join finance.bank_zero_routes route on route.route_key = seed.route_key
join public.accounts account_row
  on account_row.account_id = seed.account_id
 and account_row.household_id = route.household_id
on conflict do nothing;

alter table finance.bank_zero_received_emails enable row level security;
alter table finance.bank_zero_delivery_attempts enable row level security;
alter table finance.bank_zero_observations enable row level security;
alter table finance.bank_zero_movements enable row level security;
alter table finance.bank_zero_evidence_links enable row level security;
alter table finance.bank_zero_publication_outbox enable row level security;
alter table finance.bank_zero_observation_audit enable row level security;
alter table finance.bank_zero_legacy_keys enable row level security;
alter table finance.bank_zero_balance_snapshots enable row level security;
alter table finance.bank_zero_routes enable row level security;
alter table finance.bank_zero_account_aliases enable row level security;
alter table finance.bank_zero_route_capabilities enable row level security;

create policy bank_zero_emails_household_read on finance.bank_zero_received_emails
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_delivery_household_read on finance.bank_zero_delivery_attempts
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_observations_household_read on finance.bank_zero_observations
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_movements_household_read on finance.bank_zero_movements
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_evidence_household_read on finance.bank_zero_evidence_links
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_outbox_household_read on finance.bank_zero_publication_outbox
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_audit_household_read on finance.bank_zero_observation_audit
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_legacy_household_read on finance.bank_zero_legacy_keys
  for select to authenticated using (finance.is_household_member(household_id));
create policy bank_zero_balances_household_read on finance.bank_zero_balance_snapshots
  for select to authenticated using (finance.is_household_member(household_id));

grant select on
  finance.bank_zero_received_emails,
  finance.bank_zero_delivery_attempts,
  finance.bank_zero_observations,
  finance.bank_zero_movements,
  finance.bank_zero_evidence_links,
  finance.bank_zero_publication_outbox,
  finance.bank_zero_observation_audit,
  finance.bank_zero_legacy_keys,
  finance.bank_zero_balance_snapshots
to authenticated;

grant all on
  finance.bank_zero_routes,
  finance.bank_zero_account_aliases,
  finance.bank_zero_route_capabilities,
  finance.bank_zero_received_emails,
  finance.bank_zero_delivery_attempts,
  finance.bank_zero_observations,
  finance.bank_zero_movements,
  finance.bank_zero_evidence_links,
  finance.bank_zero_publication_outbox,
  finance.bank_zero_observation_audit,
  finance.bank_zero_legacy_keys,
  finance.bank_zero_balance_snapshots,
  finance.bank_zero_routes,
  finance.bank_zero_account_aliases
to service_role;
