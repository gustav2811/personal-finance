alter table finance.source_categories
  add column if not exists owned_category_id uuid references finance.categories(id);

create or replace function public.finance_start_sync_run(
  p_household_id uuid,
  p_source_system text
) returns uuid
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_source_system is distinct from 'finwise' then
    raise exception 'unsupported source system';
  end if;
  if not exists (select 1 from finance.households where id = p_household_id) then
    raise exception 'unknown household';
  end if;
  insert into finance.sync_runs (household_id, source_system)
  values (p_household_id, p_source_system)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.finance_finish_sync_run(
  p_sync_run_id uuid,
  p_status text,
  p_error text
) returns text
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
begin
  if p_status not in ('succeeded', 'failed') then
    raise exception 'sync run status must be succeeded or failed';
  end if;
  update finance.sync_runs
  set
    status = p_status,
    error = nullif(p_error, ''),
    completed_at = now()
  where id = p_sync_run_id;
  if not found then
    raise exception 'sync run not found';
  end if;
  return p_status;
end;
$$;

create or replace function public.finance_upsert_source_account(
  p_household_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_id text;
  v_account_id uuid;
begin
  if not exists (select 1 from finance.households where id = p_household_id) then
    raise exception 'unknown household';
  end if;
  v_id := nullif(btrim(p_payload->>'id'), '');
  if v_id is null or v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'finwise account id must be a uuid';
  end if;
  v_account_id := v_id::uuid;
  insert into public.accounts (
    account_id,
    source_platform,
    source_account_id,
    name,
    type,
    household_id,
    source_system,
    account_type,
    currency_code,
    finwise_account_id,
    raw_payload,
    raw_payload_hash,
    first_seen_at,
    last_seen_at,
    updated_at
  ) values (
    v_account_id,
    'finwise',
    v_id,
    coalesce(nullif(btrim(p_payload->>'name'), ''), v_id),
    nullif(p_payload->>'type', ''),
    p_household_id,
    'finwise',
    nullif(p_payload->>'type', ''),
    nullif(p_payload->>'currencyCode', ''),
    v_id,
    p_payload,
    nullif(p_payload->>'rawPayloadHash', ''),
    now(),
    now(),
    now()
  )
  on conflict (account_id) do update set
    name = excluded.name,
    type = excluded.type,
    account_type = excluded.account_type,
    currency_code = coalesce(excluded.currency_code, public.accounts.currency_code),
    finwise_account_id = excluded.finwise_account_id,
    source_account_id = excluded.source_account_id,
    source_platform = 'finwise',
    source_system = 'finwise',
    household_id = excluded.household_id,
    raw_payload = excluded.raw_payload,
    raw_payload_hash = excluded.raw_payload_hash,
    last_seen_at = now(),
    updated_at = now();
  return v_account_id;
end;
$$;

create or replace function public.finance_upsert_source_accounts(
  p_household_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_row jsonb;
  v_upserted integer := 0;
  v_failed integer := 0;
  v_error text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'accounts payload must be an array';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      perform public.finance_upsert_source_account(p_household_id, v_row);
      v_upserted := v_upserted + 1;
    exception when others then
      v_failed := v_failed + 1;
      if v_error is null then
        v_error := sqlerrm;
      end if;
    end;
  end loop;
  return jsonb_build_object('upserted', v_upserted, 'failed', v_failed, 'error', v_error);
end;
$$;

create or replace function public.finance_upsert_source_category(
  p_household_id uuid,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_source_id text;
  v_name text;
  v_slug text;
  v_owned uuid;
  v_existing uuid;
begin
  if not exists (select 1 from finance.households where id = p_household_id) then
    raise exception 'unknown household';
  end if;
  v_source_id := nullif(btrim(p_payload->>'id'), '');
  v_name := nullif(btrim(p_payload->>'name'), '');
  v_slug := nullif(btrim(p_payload->>'slug'), '');
  if v_source_id is null or v_name is null or v_slug is null then
    raise exception 'category id, name, and slug are required';
  end if;
  select owned_category_id into v_existing
  from finance.source_categories
  where household_id = p_household_id
    and source_system = 'finwise'
    and source_category_id = v_source_id;
  if v_existing is not null then
    v_owned := v_existing;
  else
    insert into finance.categories (household_id, name, slug, group_name)
    values (p_household_id, v_name, v_slug, nullif(p_payload->>'groupName', ''))
    on conflict (household_id, slug) do nothing;
    select id into v_owned
    from finance.categories
    where household_id = p_household_id and slug = v_slug;
  end if;
  if v_owned is null then
    raise exception 'owned category was not created';
  end if;
  insert into finance.source_categories (
    household_id,
    source_system,
    source_category_id,
    name,
    group_name,
    raw_payload,
    raw_payload_hash,
    owned_category_id,
    observed_at
  ) values (
    p_household_id,
    'finwise',
    v_source_id,
    v_name,
    nullif(p_payload->>'groupName', ''),
    p_payload,
    nullif(p_payload->>'rawPayloadHash', ''),
    v_owned,
    now()
  )
  on conflict (household_id, source_system, source_category_id) do update set
    name = excluded.name,
    group_name = excluded.group_name,
    raw_payload = excluded.raw_payload,
    raw_payload_hash = excluded.raw_payload_hash,
    observed_at = now(),
    owned_category_id = coalesce(finance.source_categories.owned_category_id, excluded.owned_category_id);
  return v_owned;
end;
$$;

create or replace function public.finance_upsert_source_categories(
  p_household_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_row jsonb;
  v_owned uuid;
  v_mapped jsonb := '[]'::jsonb;
  v_failed integer := 0;
  v_error text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'categories payload must be an array';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_owned := public.finance_upsert_source_category(p_household_id, v_row);
      v_mapped := v_mapped || jsonb_build_array(jsonb_build_object(
        'name', v_row->>'name',
        'ownedCategoryId', v_owned
      ));
    exception when others then
      v_failed := v_failed + 1;
      if v_error is null then
        v_error := sqlerrm;
      end if;
    end;
  end loop;
  return jsonb_build_object('mapped', v_mapped, 'failed', v_failed, 'error', v_error);
end;
$$;

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
  if v_id is null then
    raise exception 'missing transaction id';
  end if;
  if nullif(p_payload->>'accountId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'account id must be a uuid';
  end if;
  v_account_id := (p_payload->>'accountId')::uuid;
  if not exists (
    select 1 from public.accounts
    where account_id = v_account_id
      and household_id = p_household_id
      and source_system = 'finwise'
  ) then
    raise exception 'finwise account is not in this household';
  end if;
  v_parent := nullif(p_payload->>'parentTransactionId', '');
  if v_parent is not null and not exists (select 1 from public.transactions where id = v_parent) then
    v_parent := null;
  end if;
  v_archived := coalesce((p_payload->>'archived')::boolean, false);
  v_hash := nullif(p_payload->>'rawPayloadHash', '');
  if v_hash is null then
    raise exception 'missing payload hash';
  end if;
  insert into public.transactions (
    id,
    account_id,
    date,
    details,
    household_id,
    source_system,
    source_transaction_id,
    amount,
    currency_code,
    occurred_on,
    description,
    lifecycle_status,
    original_description,
    source_category_id,
    source_category_name_snapshot,
    source_updated_at,
    source_first_seen_at,
    source_last_seen_at,
    source_is_pending,
    source_is_transfer,
    source_is_archived,
    raw_payload_hash,
    finwise_transaction_id,
    publication_status,
    effective_at,
    notes,
    merchant_name,
    merchant_source_id,
    parent_transaction_id
  ) values (
    v_id,
    v_account_id,
    (p_payload->>'date')::timestamptz,
    p_payload,
    p_household_id,
    'finwise',
    v_id,
    nullif(p_payload->>'amount', '')::numeric,
    nullif(p_payload->>'currencyCode', ''),
    (p_payload->>'occurredOn')::date,
    coalesce(p_payload->>'description', ''),
    case when v_archived then 'archived' else 'imported' end,
    nullif(p_payload->>'originalDescription', ''),
    nullif(p_payload->>'transactionCategoryId', ''),
    nullif(p_payload->>'categoryName', ''),
    nullif(p_payload->>'updatedAt', '')::timestamptz,
    now(),
    now(),
    case when p_payload->>'isPending' is null then null else (p_payload->>'isPending')::boolean end,
    case when p_payload->>'isTransfer' is null then null else (p_payload->>'isTransfer')::boolean end,
    v_archived,
    v_hash,
    v_id,
    'source',
    nullif(p_payload->>'effectiveDate', '')::timestamptz,
    nullif(p_payload->>'notes', ''),
    nullif(p_payload->>'merchantName', ''),
    nullif(p_payload->>'merchantId', ''),
    v_parent
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
    description = excluded.description,
    lifecycle_status = case
      when excluded.source_is_archived then 'archived'
      else public.transactions.lifecycle_status
    end,
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
    notes = excluded.notes,
    merchant_name = excluded.merchant_name,
    merchant_source_id = excluded.merchant_source_id,
    parent_transaction_id = coalesce(excluded.parent_transaction_id, public.transactions.parent_transaction_id),
    updated_at = now();
  insert into finance.transaction_source_observations (
    household_id,
    transaction_id,
    sync_run_id,
    source_updated_at,
    raw_payload,
    raw_payload_hash
  ) values (
    p_household_id,
    v_id,
    p_sync_run_id,
    nullif(p_payload->>'updatedAt', '')::timestamptz,
    p_payload,
    v_hash
  )
  on conflict (transaction_id, raw_payload_hash) do nothing;
  return v_id;
end;
$$;

create or replace function public.finance_upsert_source_transactions(
  p_household_id uuid,
  p_sync_run_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_row jsonb;
  v_id text;
  v_ids jsonb := '[]'::jsonb;
  v_failed integer := 0;
  v_error text;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'transactions payload must be an array';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    begin
      v_id := public.finance_upsert_source_transaction(p_household_id, p_sync_run_id, v_row);
      v_ids := v_ids || jsonb_build_array(v_id);
    exception when others then
      v_failed := v_failed + 1;
      if v_error is null then
        v_error := sqlerrm;
      end if;
    end;
  end loop;
  return jsonb_build_object('ids', v_ids, 'failed', v_failed, 'error', v_error);
end;
$$;

create or replace function public.finance_record_classification_run(
  p_household_id uuid,
  p_transaction_id text,
  p_classifier_version text,
  p_model_id text,
  p_input_token_count integer,
  p_result jsonb,
  p_owned_category_id uuid,
  p_confidence numeric,
  p_is_transfer boolean,
  p_exclude_from_spend boolean,
  p_nature text
) returns uuid
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_run_id uuid;
  v_household uuid;
begin
  select household_id into v_household
  from public.transactions
  where id = p_transaction_id;
  if v_household is null or v_household <> p_household_id then
    raise exception 'transaction is not in this household';
  end if;
  if p_confidence is not null and (p_confidence < 0 or p_confidence > 1) then
    raise exception 'confidence must be between 0 and 1';
  end if;
  if p_owned_category_id is not null and not exists (
    select 1 from finance.categories
    where id = p_owned_category_id and household_id = p_household_id
  ) then
    raise exception 'owned category is not in this household';
  end if;
  insert into finance.classification_runs (
    household_id,
    transaction_id,
    classifier,
    classifier_version,
    model_id,
    completed_at,
    status,
    input_token_count,
    result
  ) values (
    p_household_id,
    p_transaction_id,
    'jev',
    p_classifier_version,
    nullif(p_model_id, ''),
    now(),
    'succeeded',
    p_input_token_count,
    p_result
  )
  returning id into v_run_id;
  if p_owned_category_id is null then
    return v_run_id;
  end if;
  if p_is_transfer is null or p_exclude_from_spend is null or nullif(p_nature, '') is null then
    raise exception 'a proposal needs a treatment';
  end if;
  if not exists (
    select 1 from finance.transaction_classifications
    where transaction_id = p_transaction_id and status = 'confirmed'
  ) then
    update finance.transaction_classifications
    set status = 'superseded', superseded_at = now()
    where transaction_id = p_transaction_id
      and household_id = p_household_id
      and status = 'proposed';
    insert into finance.transaction_classifications (
      household_id,
      transaction_id,
      category_id,
      decision_source,
      status,
      confidence,
      run_id,
      reason
    ) values (
      p_household_id,
      p_transaction_id,
      p_owned_category_id,
      'jev',
      'proposed',
      p_confidence,
      v_run_id,
      'shadow proposal'
    );
  end if;
  if not exists (
    select 1 from finance.transaction_treatments
    where transaction_id = p_transaction_id and status = 'confirmed'
  ) then
    update finance.transaction_treatments
    set status = 'superseded', superseded_at = now()
    where transaction_id = p_transaction_id
      and household_id = p_household_id
      and status = 'proposed';
    insert into finance.transaction_treatments (
      household_id,
      transaction_id,
      is_transfer,
      exclude_from_spend,
      nature,
      decision_source,
      status
    ) values (
      p_household_id,
      p_transaction_id,
      p_is_transfer,
      p_exclude_from_spend,
      p_nature,
      'jev',
      'proposed'
    );
  end if;
  return v_run_id;
end;
$$;

revoke all on function public.finance_start_sync_run(uuid, text) from public, anon, authenticated;
revoke all on function public.finance_finish_sync_run(uuid, text, text) from public, anon, authenticated;
revoke all on function public.finance_upsert_source_account(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_upsert_source_accounts(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_upsert_source_category(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_upsert_source_categories(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_upsert_source_transaction(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_upsert_source_transactions(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.finance_record_classification_run(uuid, text, text, text, integer, jsonb, uuid, numeric, boolean, boolean, text) from public, anon, authenticated;

grant execute on function public.finance_start_sync_run(uuid, text) to service_role;
grant execute on function public.finance_finish_sync_run(uuid, text, text) to service_role;
grant execute on function public.finance_upsert_source_account(uuid, jsonb) to service_role;
grant execute on function public.finance_upsert_source_accounts(uuid, jsonb) to service_role;
grant execute on function public.finance_upsert_source_category(uuid, jsonb) to service_role;
grant execute on function public.finance_upsert_source_categories(uuid, jsonb) to service_role;
grant execute on function public.finance_upsert_source_transaction(uuid, uuid, jsonb) to service_role;
grant execute on function public.finance_upsert_source_transactions(uuid, uuid, jsonb) to service_role;
grant execute on function public.finance_record_classification_run(uuid, text, text, text, integer, jsonb, uuid, numeric, boolean, boolean, text) to service_role;

notify pgrst, 'reload schema';
