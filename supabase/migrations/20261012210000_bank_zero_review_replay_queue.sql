create or replace function public.bank_zero_claim_review_replays_v1(
  p_worker_id text,
  p_limit integer default 2
) returns setof jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_request finance.bank_zero_replay_requests%rowtype;
  v_email finance.bank_zero_received_emails%rowtype;
begin
  if nullif(btrim(p_worker_id), '') is null or p_limit < 1 or p_limit > 10 then
    raise exception 'worker id and a limit from 1 to 10 are required';
  end if;

  update finance.bank_zero_replay_requests request
  set status = 'terminal_failure',
      last_error = 'Original source expired before replay could run',
      completed_at = now(), updated_at = now()
  from finance.bank_zero_received_emails email
  where email.id = request.received_email_id
    and email.household_id = request.household_id
    and email.source_expired_at is not null
    and request.status in ('pending', 'retryable_failure');

  update finance.bank_zero_replay_requests
  set status = 'retryable_failure', lease_owner = null, lease_expires_at = null,
      next_attempt_at = now(), last_error = 'Replay lease expired before completion', updated_at = now()
  where status = 'in_progress' and lease_expires_at < now();

  for v_request in
    select request.*
    from finance.bank_zero_replay_requests request
    join finance.bank_zero_received_emails email
      on email.household_id = request.household_id and email.id = request.received_email_id
    where request.status in ('pending', 'retryable_failure')
      and request.next_attempt_at <= now()
      and email.source_expired_at is null
      and email.source_expiration_claimed_at is null
    order by request.next_attempt_at, request.created_at
    for update of request skip locked
    limit p_limit
  loop
    select * into v_email
    from finance.bank_zero_received_emails email
    where email.household_id = v_request.household_id and email.id = v_request.received_email_id;
    update finance.bank_zero_replay_requests
    set status = 'in_progress', lease_owner = p_worker_id,
        lease_expires_at = now() + interval '15 minutes',
        attempt_count = attempt_count + 1, updated_at = now()
    where id = v_request.id;
    return next jsonb_build_object(
      'replay_request_id', v_request.id,
      'observation_id', v_request.observation_id,
      'received_email_id', v_email.id,
      'route_key', v_email.route_key,
      'original_message_id', v_email.original_message_id,
      'raw_r2_key', v_email.raw_r2_key,
      'raw_sha256', v_email.raw_sha256,
      'received_at', v_email.received_at,
      'receipt_metadata', v_email.receipt_metadata,
      'attempt_count', v_request.attempt_count + 1
    );
  end loop;
end;
$$;

create or replace function public.bank_zero_finish_review_replay_v1(
  p_replay_request_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_result jsonb default null,
  p_error text default null,
  p_retry_delay_seconds integer default 0,
  p_terminal boolean default false
) returns void
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
begin
  if p_retry_delay_seconds < 0 or p_retry_delay_seconds > 3600 then
    raise exception 'retry delay must be between 0 and 3600 seconds';
  end if;
  update finance.bank_zero_replay_requests
  set status = case
        when p_succeeded then 'completed'
        when p_terminal then 'terminal_failure'
        else 'retryable_failure'
      end,
      result = case when p_succeeded then coalesce(p_result, '{}'::jsonb) else result end,
      last_error = case when p_succeeded then null else left(coalesce(p_error, 'Replay failed'), 2000) end,
      next_attempt_at = now() + make_interval(secs => p_retry_delay_seconds),
      lease_owner = null, lease_expires_at = null,
      completed_at = case when p_succeeded or p_terminal then now() else null end,
      updated_at = now()
  where id = p_replay_request_id
    and status = 'in_progress'
    and lease_owner = p_worker_id;
  if not found then
    if p_succeeded and exists (
      select 1 from finance.bank_zero_replay_requests
      where id = p_replay_request_id and status = 'completed'
    ) then
      return;
    end if;
    raise exception 'replay request is not leased by this worker';
  end if;
end;
$$;

revoke all on function public.bank_zero_claim_review_replays_v1(text, integer) from public, anon, authenticated;
revoke all on function public.bank_zero_finish_review_replay_v1(uuid, text, boolean, jsonb, text, integer, boolean) from public, anon, authenticated;
grant execute on function public.bank_zero_claim_review_replays_v1(text, integer) to service_role;
grant execute on function public.bank_zero_finish_review_replay_v1(uuid, text, boolean, jsonb, text, integer, boolean) to service_role;
