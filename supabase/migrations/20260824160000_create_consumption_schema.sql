create schema if not exists consumption;

create table if not exists consumption.devices (
  id uuid primary key default gen_random_uuid(),
  parent_device_id uuid references consumption.devices(id) on delete restrict,
  source text not null,
  external_id text not null,
  kind text not null,
  name text not null,
  utility_type text,
  location text,
  timezone text not null default 'Africa/Johannesburg',
  active_from timestamptz,
  active_to timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_utility_type_check
    check (utility_type is null or utility_type in (
      'electricity', 'water', 'gas', 'sanitation', 'wallet'
    )),
  constraint devices_active_window_check
    check (active_to is null or active_from is null or active_to > active_from),
  constraint devices_source_external_id_key unique (source, external_id)
);

comment on table consumption.devices is
  'Physical or logical household meters, plugs, appliances, and utility assets.';

create table if not exists consumption.raw_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_record_id text not null,
  event_type text not null,
  event_at timestamptz,
  fetched_at timestamptz not null default now(),
  payload_hash text not null,
  payload jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  constraint raw_events_source_record_key unique (source, source_record_id)
);

comment on table consumption.raw_events is
  'Immutable source payloads retained for audit, replay, and remapping.';

create index if not exists raw_events_source_fetched_at_idx
  on consumption.raw_events (source, fetched_at desc);

create index if not exists raw_events_payload_hash_idx
  on consumption.raw_events (source, payload_hash);

create table if not exists consumption.readings (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references consumption.devices(id) on delete restrict,
  source text not null,
  source_record_id text not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  metric text not null,
  value numeric(20, 6) not null,
  unit text not null,
  quality text not null default 'measured',
  raw_event_id uuid references consumption.raw_events(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint readings_period_check check (period_end > period_start),
  constraint readings_quality_check check (
    quality in ('measured', 'estimated', 'inferred', 'corrected')
  ),
  constraint readings_source_record_metric_key
    unique (source, source_record_id, metric)
);

comment on table consumption.readings is
  'Native-resolution measurements. Daily and weekly reporting is derived later.';

create index if not exists readings_device_period_idx
  on consumption.readings (device_id, period_start);

create index if not exists readings_utility_period_idx
  on consumption.readings (period_start);

create table if not exists consumption.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_record_id text not null,
  device_id uuid references consumption.devices(id) on delete restrict,
  utility_type text not null,
  entry_type text not null,
  direction text not null,
  amount numeric(20, 4) not null,
  currency text not null default 'ZAR',
  quantity numeric(20, 6),
  quantity_unit text,
  rate numeric(20, 8),
  occurred_at timestamptz,
  posted_at timestamptz,
  description text,
  reference text,
  raw_event_id uuid references consumption.raw_events(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint ledger_entries_utility_type_check
    check (utility_type in (
      'electricity', 'water', 'gas', 'sanitation', 'wallet'
    )),
  constraint ledger_entries_type_check
    check (entry_type in (
      'usage_charge', 'fee', 'deposit', 'correction', 'invoice', 'other'
    )),
  constraint ledger_entries_direction_check
    check (direction in ('debit', 'credit')),
  constraint ledger_entries_amount_check check (amount >= 0),
  constraint ledger_entries_source_record_key unique (source, source_record_id)
);

comment on table consumption.ledger_entries is
  'Wallet and utility money movements, separate from physical measurements.';

create index if not exists ledger_entries_utility_posted_at_idx
  on consumption.ledger_entries (utility_type, posted_at);

create index if not exists ledger_entries_occurred_at_idx
  on consumption.ledger_entries (occurred_at);

create table if not exists consumption.documents (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_record_id text not null,
  document_type text not null,
  document_number text,
  document_date date,
  total numeric(20, 4),
  currency text not null default 'ZAR',
  file_name text,
  storage_path text,
  raw_event_id uuid references consumption.raw_events(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint documents_source_record_key unique (source, source_record_id)
);

comment on table consumption.documents is
  'Invoice and payment-document metadata; binary documents belong in object storage.';

create index if not exists documents_document_date_idx
  on consumption.documents (document_date desc);

create table if not exists consumption.context_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references consumption.devices(id) on delete restrict,
  event_type text not null,
  source text not null,
  start_at timestamptz not null,
  end_at timestamptz,
  value jsonb not null default '{}'::jsonb,
  confidence numeric(4, 3),
  notes text,
  created_at timestamptz not null default now(),
  constraint context_events_window_check
    check (end_at is null or end_at > start_at),
  constraint context_events_confidence_check
    check (confidence is null or confidence between 0 and 1)
);

comment on table consumption.context_events is
  'Human, provider, and inferred explanations for unusual consumption.';

create index if not exists context_events_start_at_idx
  on consumption.context_events (start_at);

create table if not exists consumption.ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  runner text not null,
  status text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  rows_fetched integer not null default 0,
  rows_written integer not null default 0,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  constraint ingestion_runs_status_check
    check (status in ('running', 'succeeded', 'failed')),
  constraint ingestion_runs_finished_check
    check (finished_at is null or finished_at >= started_at)
);

comment on table consumption.ingestion_runs is
  'Operational audit trail for scheduled source adapters and backfills.';

create index if not exists ingestion_runs_source_started_at_idx
  on consumption.ingestion_runs (source, started_at desc);

alter table consumption.devices enable row level security;
alter table consumption.raw_events enable row level security;
alter table consumption.readings enable row level security;
alter table consumption.ledger_entries enable row level security;
alter table consumption.documents enable row level security;
alter table consumption.context_events enable row level security;
alter table consumption.ingestion_runs enable row level security;

revoke all on schema consumption from anon, authenticated;
revoke all on all tables in schema consumption from anon, authenticated;
grant usage on schema consumption to service_role;
grant all privileges on all tables in schema consumption to service_role;

