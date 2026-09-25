create table if not exists public.classifier_category_events (
  id uuid primary key default gen_random_uuid(),
  transaction_id text not null,
  observed_at timestamptz not null,
  category_id text,
  category_name text,
  previous_category_id text,
  merchant_id text,
  account_id text,
  description_fingerprint text,
  source text not null,
  created_at timestamptz not null default now()
);

create index if not exists classifier_category_events_transaction_idx
  on public.classifier_category_events (transaction_id, observed_at);

alter table public.classifier_category_events enable row level security;

revoke all on public.classifier_category_events from anon, authenticated;
grant all on public.classifier_category_events to service_role;
