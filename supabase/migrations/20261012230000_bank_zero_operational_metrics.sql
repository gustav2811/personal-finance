alter table finance.bank_zero_received_emails
  add column if not exists initial_processing_completed_at timestamptz;

create or replace function finance.bank_zero_mark_initial_processing_complete()
returns trigger
language plpgsql
set search_path = public, finance, pg_temp
as $$
begin
  if old.initial_processing_completed_at is null
     and new.processing_outcome in ('processed', 'deferred', 'ignored', 'needs_review', 'terminal_failure') then
    new.initial_processing_completed_at := now();
  end if;
  return new;
end;
$$;

create trigger bank_zero_initial_processing_completed
  before update of processing_outcome on finance.bank_zero_received_emails
  for each row execute function finance.bank_zero_mark_initial_processing_complete();

create or replace function public.bank_zero_ops_summary_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_household_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'bank_zero_forbidden: sign in required'; end if;
  select member.household_id into v_household_id
  from finance.household_members member
  where member.auth_user_id = auth.uid();
  if v_household_id is null then raise exception 'bank_zero_forbidden: household membership required'; end if;

  select jsonb_build_object(
    'receipt_processing_p95_seconds', (
      select percentile_cont(0.95) within group (
        order by extract(epoch from (email.initial_processing_completed_at - email.received_at))
      )
      from finance.bank_zero_received_emails email
      where email.household_id = v_household_id
        and email.initial_processing_completed_at >= now() - interval '7 days'
    ),
    'unclassified_templates', (
      select count(*) from finance.bank_zero_observations observation
      where observation.household_id = v_household_id and observation.observation_kind = 'unknown'
        and observation.status <> 'ignored'
    ),
    'unresolved_account_routes', (
      select count(*) from finance.bank_zero_observations observation
      where observation.household_id = v_household_id
        and observation.status in ('needs_review', 'deferred')
        and observation.parsed_values->>'outcome' = 'movement_candidate'
        and observation.parsed_values->>'accountId' is null
    ),
    'match_outcomes', jsonb_build_object(
      'matched', (select count(*) from finance.bank_zero_observations observation where observation.household_id = v_household_id and observation.status = 'matched'),
      'needs_review', (select count(*) from finance.bank_zero_observations observation where observation.household_id = v_household_id and observation.status = 'needs_review'),
      'deferred', (select count(*) from finance.bank_zero_observations observation where observation.household_id = v_household_id and observation.status = 'deferred')
    ),
    'reconciliation_older_than_24h', (
      select count(*) from finance.bank_zero_movements movement
      where movement.household_id = v_household_id and movement.reconciliation_state = 'alert_observed'
        and coalesce(movement.occurred_at, movement.created_at) < now() - interval '24 hours'
    ),
    'publication_backlog', (
      select count(*) from finance.bank_zero_publication_outbox outbox
      where outbox.household_id = v_household_id and outbox.state in ('pending', 'in_progress', 'retryable_failure')
    ),
    'unknown_publication_outcomes', (
      select count(*) from finance.bank_zero_publication_outbox outbox
      where outbox.household_id = v_household_id and outbox.state = 'outcome_unknown'
    ),
    'exhausted_publication_retries', (
      select count(*) from finance.bank_zero_publication_outbox outbox
      where outbox.household_id = v_household_id
        and outbox.attempt_count >= 5 and outbox.state in ('retryable_failure', 'terminal_failure')
    ),
    'statement_balance_gaps', null,
    'routes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route_key', route.route_key,
        'status', route.status,
        'unresolved_observations', (
          select count(*) from finance.bank_zero_observations observation
          join finance.bank_zero_received_emails email
            on email.household_id = observation.household_id and email.id = observation.received_email_id
          where observation.household_id = route.household_id and email.route_key = route.route_key
            and observation.status in ('needs_review', 'deferred')
        )
      ) order by route.route_key)
      from finance.bank_zero_routes route
      where route.household_id = v_household_id and route.route_key <> 'unverified'
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.bank_zero_ops_summary_v1() from public, anon;
grant execute on function public.bank_zero_ops_summary_v1() to authenticated, service_role;
