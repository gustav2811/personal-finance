create schema if not exists classifier;

create table if not exists classifier.account_semantics (
  id uuid primary key default gen_random_uuid(),
  finwise_account_id text not null,
  display_name text not null,
  role text not null,
  owner_scope text not null default 'household',
  context text not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint account_semantics_role_check check (
    role in (
      'current',
      'credit_card',
      'mortgage',
      'savings',
      'investment',
      'expense_reserve',
      'other'
    )
  ),
  constraint account_semantics_scope_check check (owner_scope in ('household', 'external')),
  constraint account_semantics_period_check check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists account_semantics_current_idx
  on classifier.account_semantics (finwise_account_id)
  where effective_to is null;

create table if not exists classifier.relationship_semantics (
  id uuid primary key default gen_random_uuid(),
  source_finwise_account_id text not null,
  destination_finwise_account_id text,
  counterparty_key text,
  context text not null,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint relationship_semantics_endpoint_check check (
    destination_finwise_account_id is not null or counterparty_key is not null
  ),
  constraint relationship_semantics_period_check check (
    effective_to is null or effective_to > effective_from
  )
);

create unique index if not exists relationship_semantics_current_idx
  on classifier.relationship_semantics (
    source_finwise_account_id,
    coalesce(destination_finwise_account_id, ''),
    coalesce(counterparty_key, '')
  )
  where effective_to is null;

create table if not exists classifier.observations (
  id uuid primary key default gen_random_uuid(),
  finwise_transaction_id text not null,
  observed_at timestamptz not null,
  category_name text,
  previous_category_name text,
  finwise_account_id text,
  merchant_id text,
  counterparty_key text,
  source text not null,
  created_at timestamptz not null default now(),
  constraint observations_source_check check (source in ('poll', 'user', 'import'))
);

create index if not exists observations_transaction_idx
  on classifier.observations (finwise_transaction_id, observed_at);

alter table classifier.account_semantics enable row level security;
alter table classifier.relationship_semantics enable row level security;
alter table classifier.observations enable row level security;

revoke all on schema classifier from anon, authenticated;
revoke all on all tables in schema classifier from anon, authenticated;
grant usage on schema classifier to service_role;
grant all on all tables in schema classifier to service_role;

create or replace function public.classifier_current_account_semantics()
returns table (
  finwise_account_id text,
  display_name text,
  role text,
  owner_scope text,
  context text
)
language sql
stable
security definer
set search_path = classifier, public
as $$
  select finwise_account_id, display_name, role, owner_scope, context
  from classifier.account_semantics
  where effective_to is null;
$$;

revoke all on function public.classifier_current_account_semantics() from public, anon, authenticated;
grant execute on function public.classifier_current_account_semantics() to service_role;
