-- Remember the latest value authored by the remote source. If a household
-- member changes the displayed description or notes, later syncs preserve it.
alter table public.transactions
  add column if not exists source_managed_description text,
  add column if not exists source_managed_notes text;

create or replace function public.finance_upsert_source_transaction(
  p_household_id uuid,
  p_sync_run_id uuid,
  p_payload jsonb
) returns text
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_id text;
  v_account_id uuid;
  v_parent text;
  v_archived boolean;
  v_hash text;
begin
  if not exists (
    select 1 from finance.sync_runs
    where id = p_sync_run_id and household_id = p_household_id
  ) then
    raise exception 'sync run is not in this household';
  end if;
  v_id := nullif(btrim(p_payload->>'id'), '');
  if v_id is null then raise exception 'missing transaction id'; end if;
  if nullif(p_payload->>'accountId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'account id must be a uuid';
  end if;
  v_account_id := (p_payload->>'accountId')::uuid;
  if not exists (
    select 1 from public.accounts
    where account_id = v_account_id and household_id = p_household_id and source_system = 'finwise'
  ) then raise exception 'finwise account is not in this household'; end if;
  v_parent := nullif(p_payload->>'parentTransactionId', '');
  if v_parent is not null and not exists (select 1 from public.transactions where id = v_parent) then v_parent := null; end if;
  v_archived := coalesce((p_payload->>'archived')::boolean, false);
  v_hash := nullif(p_payload->>'rawPayloadHash', '');
  if v_hash is null then raise exception 'missing payload hash'; end if;

  insert into public.transactions (
    id, account_id, date, details, household_id, source_system, source_transaction_id,
    amount, currency_code, occurred_on, description, lifecycle_status, original_description,
    source_category_id, source_category_name_snapshot, source_updated_at, source_first_seen_at,
    source_last_seen_at, source_is_pending, source_is_transfer, source_is_archived,
    raw_payload_hash, finwise_transaction_id, publication_status, effective_at, notes,
    merchant_name, merchant_source_id, parent_transaction_id,
    source_managed_description, source_managed_notes
  ) values (
    v_id, v_account_id, (p_payload->>'date')::timestamptz, p_payload, p_household_id,
    'finwise', v_id, nullif(p_payload->>'amount', '')::numeric,
    nullif(p_payload->>'currencyCode', ''), (p_payload->>'occurredOn')::date,
    coalesce(p_payload->>'description', ''), case when v_archived then 'archived' else 'imported' end,
    nullif(p_payload->>'originalDescription', ''), nullif(p_payload->>'transactionCategoryId', ''),
    nullif(p_payload->>'categoryName', ''), nullif(p_payload->>'updatedAt', '')::timestamptz,
    now(), now(), case when p_payload->>'isPending' is null then null else (p_payload->>'isPending')::boolean end,
    case when p_payload->>'isTransfer' is null then null else (p_payload->>'isTransfer')::boolean end,
    v_archived, v_hash, v_id, 'source', nullif(p_payload->>'effectiveDate', '')::timestamptz,
    nullif(p_payload->>'notes', ''), nullif(p_payload->>'merchantName', ''),
    nullif(p_payload->>'merchantId', ''), v_parent,
    coalesce(p_payload->>'description', ''), nullif(p_payload->>'notes', '')
  )
  on conflict (id) do update set
    account_id = excluded.account_id,
    date = excluded.date,
    details = excluded.details,
    household_id = excluded.household_id,
    source_system = 'finwise',
    source_transaction_id = excluded.source_transaction_id,
    amount = excluded.amount,
    currency_code = excluded.currency_code,
    occurred_on = excluded.occurred_on,
    description = case
      when public.transactions.description is not distinct from public.transactions.source_managed_description
        then excluded.description
      else public.transactions.description
    end,
    lifecycle_status = case when excluded.source_is_archived then 'archived' else public.transactions.lifecycle_status end,
    original_description = excluded.original_description,
    source_category_id = excluded.source_category_id,
    source_category_name_snapshot = excluded.source_category_name_snapshot,
    source_updated_at = excluded.source_updated_at,
    source_first_seen_at = coalesce(public.transactions.source_first_seen_at, excluded.source_first_seen_at),
    source_last_seen_at = now(),
    source_is_pending = excluded.source_is_pending,
    source_is_transfer = excluded.source_is_transfer,
    source_is_archived = excluded.source_is_archived,
    raw_payload_hash = excluded.raw_payload_hash,
    finwise_transaction_id = excluded.finwise_transaction_id,
    effective_at = excluded.effective_at,
    notes = case
      when public.transactions.notes is not distinct from public.transactions.source_managed_notes
        then excluded.notes
      else public.transactions.notes
    end,
    merchant_name = excluded.merchant_name,
    merchant_source_id = excluded.merchant_source_id,
    parent_transaction_id = coalesce(excluded.parent_transaction_id, public.transactions.parent_transaction_id),
    source_managed_description = excluded.source_managed_description,
    source_managed_notes = excluded.source_managed_notes,
    updated_at = now();

  insert into finance.transaction_source_observations (
    household_id, transaction_id, sync_run_id, source_updated_at, raw_payload, raw_payload_hash
  ) values (
    p_household_id, v_id, p_sync_run_id, nullif(p_payload->>'updatedAt', '')::timestamptz, p_payload, v_hash
  ) on conflict (transaction_id, raw_payload_hash) do nothing;
  return v_id;
end;
$$;

revoke all on function public.finance_upsert_source_transaction(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finance_upsert_source_transaction(uuid, uuid, jsonb) to service_role;
