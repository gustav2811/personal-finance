-- Test-only prerequisites for migrations that evolve the original public model.
-- This file is never part of the production migration directory.
create extension if not exists pgcrypto with schema extensions;

-- The local image ships PostgREST/GraphQL DDL observers without their service
-- schemas. They are irrelevant to migration replay and otherwise abort valid
-- DDL while trying to increment a missing graphql schema sequence.
do $$
declare
  trigger_name text;
begin
  for trigger_name in
    select evtname
    from pg_event_trigger
    where evtenabled <> 'D'
      and evtname in (
        'issue_graphql_placeholder', 'pgrst_ddl_watch', 'pgrst_drop_watch',
        'issue_pg_cron_access', 'issue_pg_net_access', 'issue_pg_graphql_access'
      )
  loop
    execute format('alter event trigger %I disable', trigger_name);
  end loop;
end;
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

alter table auth.users
  add column if not exists email_confirmed_at timestamptz;

create table if not exists public.accounts (
  account_id uuid primary key default gen_random_uuid(),
  source_platform text not null default '22seven',
  source_account_id text not null,
  name text not null,
  type text,
  constraint accounts_source_identity_key
    unique (source_platform, source_account_id)
);

create table if not exists public.transactions (
  id text primary key,
  account_id uuid not null references public.accounts(account_id),
  date timestamptz not null,
  details jsonb not null
);

create table if not exists public.snapshots (
  account_id uuid not null references public.accounts(account_id),
  date date not null,
  amount_cents numeric not null,
  currency_code text,
  created_at timestamptz default now(),
  primary key (account_id, date)
);

create table if not exists public.dlq_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null,
  message_id text not null,
  bank text not null,
  payload jsonb not null,
  error text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.processed_transactions (
  external_id text primary key,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.snapshots enable row level security;
alter table public.dlq_ingest_jobs enable row level security;
alter table public.processed_transactions enable row level security;
