alter table finance.bank_zero_received_emails
  add column if not exists source_expiration_claimed_at timestamptz;

create or replace function public.bank_zero_claim_source_expiration_v1(p_limit integer default 20)
returns setof jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_email finance.bank_zero_received_emails%rowtype;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'expiration limit must be from 1 to 100';
  end if;
  for v_email in
    select email.*
    from finance.bank_zero_received_emails email
    where email.received_at <= now() - interval '180 days'
      and email.source_expired_at is null
      and (email.source_expiration_claimed_at is null
        or email.source_expiration_claimed_at < now() - interval '10 minutes')
      and email.processing_outcome in ('processed', 'ignored')
      and not exists (
        select 1 from finance.bank_zero_observations observation
        where observation.household_id = email.household_id
          and observation.received_email_id = email.id
          and (
            observation.status in ('needs_review', 'deferred', 'invalid')
            or (observation.status = 'observed'
              and observation.parsed_values->>'outcome' in ('movement_candidate', 'evidence')
              and not exists (
                select 1 from finance.bank_zero_evidence_links link
                where link.household_id = observation.household_id
                  and link.observation_id = observation.id
              ))
          )
      )
      and not exists (
        select 1
        from finance.bank_zero_evidence_links link
        join finance.bank_zero_publication_outbox outbox
          on outbox.household_id = link.household_id and outbox.movement_id = link.movement_id
        where link.household_id = email.household_id
          and exists (
            select 1 from finance.bank_zero_observations observation
            where observation.household_id = link.household_id
              and observation.id = link.observation_id
              and observation.received_email_id = email.id
          )
          and outbox.state in ('pending', 'in_progress', 'retryable_failure', 'outcome_unknown', 'terminal_failure', 'needs_review')
      )
      and not exists (
        select 1
        from finance.bank_zero_delivery_attempts attempt
        join public.dlq_ingest_jobs recovery
          on recovery.status = 'open'
         and recovery.recovery_id = 'cloudflare-email:' || email.route_key || ':' || attempt.transport_id
        where attempt.household_id = email.household_id
          and attempt.received_email_id = email.id
      )
      and not exists (
        select 1 from finance.bank_zero_replay_requests request
        where request.household_id = email.household_id
          and request.received_email_id = email.id
          and request.status in ('pending', 'in_progress', 'retryable_failure')
      )
    order by email.received_at, email.id
    for update skip locked
    limit p_limit
  loop
    update finance.bank_zero_received_emails
    set source_expiration_claimed_at = now(), updated_at = now()
    where id = v_email.id;
    return next jsonb_build_object(
      'received_email_id', v_email.id,
      'raw_r2_key', v_email.raw_r2_key,
      'attachment_pointers', coalesce(v_email.receipt_metadata->'attachmentPointers', '[]'::jsonb)
    );
  end loop;
end;
$$;

create or replace function public.bank_zero_finish_source_expiration_v1(
  p_received_email_id uuid,
  p_deleted boolean
) returns void
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
begin
  update finance.bank_zero_received_emails
  set source_expired_at = case when p_deleted then now() else null end,
      source_expiration_claimed_at = null,
      updated_at = now()
  where id = p_received_email_id
    and source_expiration_claimed_at is not null
    and source_expired_at is null;
  if not found then raise exception 'source expiration claim is missing or already completed'; end if;
end;
$$;

revoke all on function public.bank_zero_claim_source_expiration_v1(integer) from public, anon, authenticated;
revoke all on function public.bank_zero_finish_source_expiration_v1(uuid, boolean) from public, anon, authenticated;
grant execute on function public.bank_zero_claim_source_expiration_v1(integer) to service_role;
grant execute on function public.bank_zero_finish_source_expiration_v1(uuid, boolean) to service_role;
