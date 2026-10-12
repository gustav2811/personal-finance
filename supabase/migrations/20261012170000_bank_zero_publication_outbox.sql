create or replace function public.bank_zero_claim_publication_v1(
  p_worker_id text,
  p_limit integer default 5
) returns setof jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_row finance.bank_zero_publication_outbox%rowtype;
begin
  if nullif(btrim(p_worker_id), '') is null or p_limit < 1 or p_limit > 20 then
    raise exception 'worker id and a limit from 1 to 20 are required';
  end if;
  update finance.bank_zero_publication_outbox
  set state = 'outcome_unknown', lease_owner = null, lease_expires_at = null,
      last_error = 'Create lease expired before the remote outcome was recorded', updated_at = now()
  where operation = 'create' and state = 'in_progress' and lease_expires_at < now();
  update finance.bank_zero_movements movement
  set publication_state = 'outcome_unknown', updated_at = now()
  from finance.bank_zero_publication_outbox outbox
  where outbox.movement_id = movement.id and outbox.operation = 'create'
    and outbox.state = 'outcome_unknown'
    and outbox.last_error = 'Create lease expired before the remote outcome was recorded';
  update finance.bank_zero_publication_outbox
  set state = 'retryable_failure', lease_owner = null, lease_expires_at = null,
      next_attempt_at = now(), updated_at = now()
  where operation = 'project' and state = 'in_progress' and lease_expires_at < now();
  for v_row in
    select outbox.* from finance.bank_zero_publication_outbox outbox
    where outbox.state in ('pending', 'retryable_failure') and outbox.next_attempt_at <= now()
    order by outbox.next_attempt_at, outbox.created_at
    for update skip locked limit p_limit
  loop
    update finance.bank_zero_publication_outbox
    set state = 'in_progress', lease_owner = p_worker_id,
        lease_expires_at = now() + interval '2 minutes',
        attempt_count = attempt_count + 1, updated_at = now()
    where id = v_row.id;
    return next jsonb_build_object(
      'outbox_id', v_row.id, 'operation_id', v_row.operation_id,
      'operation', v_row.operation, 'household_id', v_row.household_id,
      'movement_id', v_row.movement_id,
      'finwise_transaction_id', v_row.finwise_transaction_id,
      'exact_request', v_row.exact_request,
      'attempt_count', v_row.attempt_count + 1
    );
  end loop;
end;
$$;

create or replace function public.bank_zero_record_finwise_create_v1(
  p_operation_id uuid,
  p_finwise_transaction_id text,
  p_normalized_transaction jsonb
) returns void
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_outbox finance.bank_zero_publication_outbox%rowtype;
begin
  if nullif(btrim(p_finwise_transaction_id), '') is null
     or jsonb_typeof(p_normalized_transaction) <> 'object'
     or p_normalized_transaction->>'id' is distinct from p_finwise_transaction_id then
    raise exception 'FinWise transaction identity and normalized response are required';
  end if;
  select * into v_outbox from finance.bank_zero_publication_outbox
  where operation_id = p_operation_id for update;
  if not found or v_outbox.operation <> 'create' or v_outbox.state <> 'in_progress' then
    raise exception 'publication create operation is not in progress';
  end if;
  update finance.bank_zero_movements
  set finwise_transaction_id = p_finwise_transaction_id,
      publication_state = 'published', updated_at = now()
  where id = v_outbox.movement_id and household_id = v_outbox.household_id;
  if not found then raise exception 'Bank Zero movement no longer exists'; end if;
  update finance.bank_zero_publication_outbox
  set operation = 'project', state = 'pending', exact_request = p_normalized_transaction,
      finwise_transaction_id = p_finwise_transaction_id,
      lease_owner = null, lease_expires_at = null, last_error = null,
      next_attempt_at = now(), updated_at = now()
  where id = v_outbox.id;
end;
$$;

create or replace function public.bank_zero_finish_publication_v1(
  p_operation_id uuid,
  p_state text,
  p_error text,
  p_retry_delay_seconds integer default 0
) returns void
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_outbox finance.bank_zero_publication_outbox%rowtype;
begin
  if p_state not in ('retryable_failure', 'outcome_unknown', 'terminal_failure', 'needs_review') then
    raise exception 'unsupported publication failure state';
  end if;
  if p_retry_delay_seconds < 0 or p_retry_delay_seconds > 3600 then
    raise exception 'retry delay must be between 0 and 3600 seconds';
  end if;
  select * into v_outbox from finance.bank_zero_publication_outbox
  where operation_id = p_operation_id for update;
  if not found or v_outbox.state <> 'in_progress' then
    raise exception 'publication operation is not in progress';
  end if;
  update finance.bank_zero_publication_outbox
  set state = p_state,
      last_error = left(coalesce(p_error, ''), 2000),
      next_attempt_at = now() + make_interval(secs => p_retry_delay_seconds),
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = v_outbox.id;
  update finance.bank_zero_movements
  set publication_state = p_state, updated_at = now()
  where id = v_outbox.movement_id and v_outbox.operation in ('create', 'update');
end;
$$;

create or replace function public.bank_zero_record_finwise_update_v1(
  p_operation_id uuid,
  p_finwise_transaction_id text,
  p_normalized_transaction jsonb
) returns void
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_outbox finance.bank_zero_publication_outbox%rowtype;
begin
  if nullif(btrim(p_finwise_transaction_id), '') is null
     or jsonb_typeof(p_normalized_transaction) <> 'object'
     or p_normalized_transaction->>'id' is distinct from p_finwise_transaction_id then
    raise exception 'FinWise transaction identity and normalized response are required';
  end if;
  select * into v_outbox from finance.bank_zero_publication_outbox
  where operation_id = p_operation_id for update;
  if not found or v_outbox.operation <> 'update' or v_outbox.state <> 'in_progress'
     or v_outbox.finwise_transaction_id is distinct from p_finwise_transaction_id then
    raise exception 'publication update operation is not in progress for this FinWise transaction';
  end if;
  update finance.bank_zero_movements
  set publication_state = 'published', updated_at = now()
  where id = v_outbox.movement_id and household_id = v_outbox.household_id
    and finwise_transaction_id = p_finwise_transaction_id;
  if not found then raise exception 'Bank Zero movement identity changed during FinWise update'; end if;
  update finance.bank_zero_publication_outbox
  set operation = 'project', state = 'pending', exact_request = p_normalized_transaction,
      lease_owner = null, lease_expires_at = null, last_error = null,
      next_attempt_at = now(), updated_at = now()
  where id = v_outbox.id;
end;
$$;

create or replace function public.bank_zero_finish_projection_v1(
  p_operation_id uuid,
  p_succeeded boolean,
  p_error text default null,
  p_retry_delay_seconds integer default 0
) returns void
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_outbox finance.bank_zero_publication_outbox%rowtype;
begin
  if p_retry_delay_seconds < 0 or p_retry_delay_seconds > 3600 then
    raise exception 'retry delay must be between 0 and 3600 seconds';
  end if;
  select * into v_outbox from finance.bank_zero_publication_outbox
  where operation_id = p_operation_id for update;
  if not found or v_outbox.operation <> 'project' or v_outbox.state <> 'in_progress' then
    raise exception 'projection operation is not in progress';
  end if;
  update finance.bank_zero_publication_outbox
  set state = case when p_succeeded then 'published' else 'retryable_failure' end,
      last_error = case when p_succeeded then null else left(coalesce(p_error, 'Projection failed'), 2000) end,
      next_attempt_at = now() + make_interval(secs => p_retry_delay_seconds),
      lease_owner = null, lease_expires_at = null, updated_at = now()
  where id = v_outbox.id;
end;
$$;

revoke all on function public.bank_zero_claim_publication_v1(text, integer) from public, anon, authenticated;
revoke all on function public.bank_zero_record_finwise_create_v1(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.bank_zero_record_finwise_update_v1(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.bank_zero_finish_publication_v1(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.bank_zero_finish_projection_v1(uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.bank_zero_claim_publication_v1(text, integer) to service_role;
grant execute on function public.bank_zero_record_finwise_create_v1(uuid, text, jsonb) to service_role;
grant execute on function public.bank_zero_record_finwise_update_v1(uuid, text, jsonb) to service_role;
grant execute on function public.bank_zero_finish_publication_v1(uuid, text, text, integer) to service_role;
grant execute on function public.bank_zero_finish_projection_v1(uuid, boolean, text, integer) to service_role;
