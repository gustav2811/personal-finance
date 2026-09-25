do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.accounts'::regclass and contype = 'p'
  ) then
    alter table public.accounts add primary key (account_id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass and contype = 'p'
  ) then
    alter table public.transactions add primary key (id);
  end if;
end $$;

alter table public.accounts
  add column if not exists household_id uuid references finance.households(id),
  add column if not exists source_system text,
  add column if not exists account_type text,
  add column if not exists currency_code text,
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists finwise_account_id text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists first_seen_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists archived_at timestamptz,
  add column if not exists raw_payload jsonb,
  add column if not exists raw_payload_hash text;

alter table public.transactions
  add column if not exists household_id uuid references finance.households(id),
  add column if not exists source_system text,
  add column if not exists source_transaction_id text,
  add column if not exists amount numeric,
  add column if not exists currency_code text,
  add column if not exists occurred_on date,
  add column if not exists description text,
  add column if not exists lifecycle_status text not null default 'imported',
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists original_description text,
  add column if not exists source_category_id text,
  add column if not exists source_category_name_snapshot text,
  add column if not exists source_updated_at timestamptz,
  add column if not exists source_first_seen_at timestamptz,
  add column if not exists source_last_seen_at timestamptz,
  add column if not exists source_is_pending boolean,
  add column if not exists source_is_transfer boolean,
  add column if not exists source_is_archived boolean,
  add column if not exists raw_payload_hash text,
  add column if not exists finwise_transaction_id text,
  add column if not exists publication_status text,
  add column if not exists published_at timestamptz,
  add column if not exists publication_error text,
  add column if not exists posted_at timestamptz,
  add column if not exists effective_at timestamptz,
  add column if not exists notes text,
  add column if not exists merchant_name text,
  add column if not exists merchant_source_id text,
  add column if not exists parent_transaction_id text references public.transactions(id),
  add column if not exists owned_category_id uuid;

alter table public.snapshots
  add column if not exists household_id uuid references finance.households(id),
  add column if not exists source_system text,
  add column if not exists observed_at timestamptz,
  add column if not exists sync_run_id uuid;

update public.accounts
set
  household_id = '00000000-0000-4000-8000-000000000001',
  source_system = coalesce(source_system, lower(nullif(source_platform, '')), 'legacy'),
  account_type = coalesce(account_type, type),
  first_seen_at = coalesce(first_seen_at, created_at),
  last_seen_at = coalesce(last_seen_at, created_at)
where household_id is null
   or source_system is null
   or account_type is null;

update public.transactions as transaction_row
set
  household_id = account_row.household_id,
  source_system = coalesce(transaction_row.source_system, account_row.source_system, 'legacy'),
  source_transaction_id = coalesce(transaction_row.source_transaction_id, transaction_row.details->>'id', transaction_row.id),
  amount = coalesce(
    transaction_row.amount,
    case
      when transaction_row.details->>'amount' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (transaction_row.details->>'amount')::numeric
      else null
    end
  ),
  occurred_on = coalesce(transaction_row.occurred_on, transaction_row.date::date),
  description = coalesce(transaction_row.description, transaction_row.details->>'description', transaction_row.details->>'originalDescription'),
  original_description = coalesce(transaction_row.original_description, transaction_row.details->>'originalDescription'),
  source_category_id = coalesce(transaction_row.source_category_id, transaction_row.details->>'categoryId'),
  source_category_name_snapshot = coalesce(transaction_row.source_category_name_snapshot, transaction_row.details->>'categoryName'),
  merchant_name = coalesce(transaction_row.merchant_name, transaction_row.details->>'merchantName'),
  merchant_source_id = coalesce(transaction_row.merchant_source_id, transaction_row.details->>'merchantId'),
  notes = coalesce(transaction_row.notes, transaction_row.details->>'note'),
  source_is_archived = coalesce(
    transaction_row.source_is_archived,
    case
      when transaction_row.details->>'isArchived' in ('true', 'false')
        then (transaction_row.details->>'isArchived')::boolean
      else null
    end
  ),
  source_is_pending = coalesce(
    transaction_row.source_is_pending,
    case
      when transaction_row.details->>'isPendingTransaction' in ('true', 'false')
        then (transaction_row.details->>'isPendingTransaction')::boolean
      else null
    end
  )
from public.accounts as account_row
where transaction_row.account_id = account_row.account_id
  and transaction_row.household_id is null;

update public.snapshots as snapshot
set
  household_id = account_row.household_id,
  source_system = coalesce(snapshot.source_system, account_row.source_system, 'legacy'),
  observed_at = coalesce(snapshot.observed_at, snapshot.created_at)
from public.accounts as account_row
where snapshot.account_id = account_row.account_id
  and snapshot.household_id is null;

alter table public.accounts
  alter column household_id set not null,
  alter column source_system set not null;

create unique index if not exists accounts_household_source_identity
  on public.accounts (household_id, source_system, source_account_id)
  where source_account_id is not null;

create unique index if not exists accounts_finwise_account_id
  on public.accounts (household_id, finwise_account_id)
  where finwise_account_id is not null;

create index if not exists transactions_account_occurred_on
  on public.transactions (account_id, occurred_on);

create unique index if not exists transactions_source_identity
  on public.transactions (household_id, account_id, source_system, source_transaction_id)
  where source_transaction_id is not null;

create unique index if not exists transactions_finwise_transaction_id
  on public.transactions (household_id, finwise_transaction_id)
  where finwise_transaction_id is not null;
