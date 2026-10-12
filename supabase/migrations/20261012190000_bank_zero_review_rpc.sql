create or replace function public.bank_zero_list_review_v1(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'bank_zero_forbidden: sign in required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then raise exception 'bank_zero_invalid: limit must be 1 to 100'; end if;
  select coalesce(jsonb_agg(queue_row.item order by queue_row.created_at desc), '[]'::jsonb)
    into v_result
  from (
    select observation.created_at,
      jsonb_build_object(
        'observation_id', observation.id,
        'received_email_id', email.id,
        'household_id', observation.household_id,
        'route_key', email.route_key,
        'status', observation.status,
        'kind', observation.observation_kind,
        'reason', coalesce(observation.review_reason, publication_issue.last_error),
        'received_at', email.received_at,
        'source_expired_at', email.source_expired_at,
        'raw_values', observation.raw_values,
        'parsed_values', observation.parsed_values,
        'candidate_movements', coalesce(candidates.items, '[]'::jsonb)
      ) as item
    from finance.bank_zero_observations observation
    join finance.bank_zero_received_emails email
      on email.household_id = observation.household_id
     and email.id = observation.received_email_id
    left join lateral (
      select outbox.last_error
      from finance.bank_zero_evidence_links link
      join finance.bank_zero_publication_outbox outbox
        on outbox.household_id = link.household_id and outbox.movement_id = link.movement_id
      where link.household_id = observation.household_id
        and link.observation_id = observation.id
        and outbox.state in ('outcome_unknown', 'terminal_failure', 'needs_review')
      order by outbox.updated_at desc
      limit 1
    ) publication_issue on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
        'movement_id', candidate.id,
        'account_id', candidate.account_id,
        'amount', candidate.amount,
        'currency_code', candidate.currency_code,
        'occurred_at', candidate.occurred_at,
        'posted_on', candidate.posted_on,
        'description', candidate.display_description,
        'reconciliation_state', candidate.reconciliation_state,
        'publication_state', candidate.publication_state,
        'finwise_transaction_id', candidate.finwise_transaction_id
      ) order by candidate.created_at desc) as items
      from finance.bank_zero_movements candidate
      where candidate.household_id = observation.household_id
        and (observation.parsed_values->>'accountId' is null or candidate.account_id = (observation.parsed_values->>'accountId')::uuid)
        and candidate.currency_code = coalesce(observation.parsed_values->>'currency', 'ZAR')
        and candidate.amount = case observation.parsed_values->>'direction'
          when 'credit' then nullif(observation.parsed_values->>'amountMinor', '')::numeric / 100
          when 'debit' then -nullif(observation.parsed_values->>'amountMinor', '')::numeric / 100
          else candidate.amount
        end
        and candidate.reconciliation_state <> 'needs_review'
        and (
          nullif(observation.parsed_values->>'reference', '') is not null
            and lower(candidate.payment_reference) = lower(observation.parsed_values->>'reference')
          or nullif(observation.parsed_values->>'counterparty', '') is not null
            and lower(candidate.counterparty) = lower(observation.parsed_values->>'counterparty')
        )
        and coalesce(candidate.occurred_at::date, candidate.posted_on) between
          coalesce(observation.occurred_at::date, observation.posted_on) -
            case when observation.parsed_values->>'messageClass' in ('card_purchase', 'card_refund') then 7 else 1 end
          and coalesce(observation.occurred_at::date, observation.posted_on) +
            case when observation.parsed_values->>'messageClass' in ('card_purchase', 'card_refund') then 7 else 1 end
      limit 5
    ) candidates on true
    where (observation.status in ('needs_review', 'deferred') or exists (
        select 1
        from finance.bank_zero_evidence_links link
        join finance.bank_zero_publication_outbox outbox
          on outbox.household_id = link.household_id and outbox.movement_id = link.movement_id
        where link.household_id = observation.household_id
          and link.observation_id = observation.id
          and outbox.state in ('outcome_unknown', 'terminal_failure', 'needs_review')
      ))
      and finance.is_household_member(observation.household_id)
    order by observation.created_at desc
    limit p_limit
  ) queue_row;
  return jsonb_build_object('items', v_result);
end;
$$;

create or replace function public.bank_zero_review_observation_v1(
  p_observation_id uuid,
  p_action text,
  p_movement_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_observation finance.bank_zero_observations%rowtype;
  v_email finance.bank_zero_received_emails%rowtype;
  v_actor uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'bank_zero_forbidden: sign in required'; end if;
  if p_action not in ('associate', 'dismiss', 'replay') then raise exception 'bank_zero_invalid: unsupported review action'; end if;
  select observation.* into v_observation
  from finance.bank_zero_observations observation
  where observation.id = p_observation_id
  for update;
  if not found or not finance.is_household_member(v_observation.household_id) then
    raise exception 'bank_zero_forbidden: observation is not in your household';
  end if;
  select email.* into v_email
  from finance.bank_zero_received_emails email
  where email.id = v_observation.received_email_id
    and email.household_id = v_observation.household_id
  for update;
  select member.id into v_actor
  from finance.household_members member
  where member.household_id = v_observation.household_id
    and (member.auth_user_id = auth.uid() or (
      member.auth_user_id is null and finance.caller_is_verified_google()
      and lower(member.email) = lower(coalesce(auth.jwt()->>'email', ''))
    ))
  order by (member.auth_user_id = auth.uid()) desc nulls last
  limit 1;

  if p_action = 'associate' then
    if p_movement_id is null or not exists (
      select 1 from finance.bank_zero_movements movement
      where movement.id = p_movement_id and movement.household_id = v_observation.household_id
    ) then raise exception 'bank_zero_invalid: choose a movement in this household'; end if;
    insert into finance.bank_zero_evidence_links (
      household_id, observation_id, movement_id, relation, matching_method,
      decision_reason, reviewed_by, reviewed_at
    ) values (
      v_observation.household_id, v_observation.id, p_movement_id,
      case when v_observation.observation_kind = 'statement' then 'confirms' else 'supports' end,
      'household_member_review_v1', 'Associated from the Bank Zero review queue', v_actor, now()
    ) on conflict (household_id, observation_id, movement_id) do update set
      relation = excluded.relation,
      matching_method = excluded.matching_method,
      decision_reason = excluded.decision_reason,
      reviewed_by = excluded.reviewed_by,
      reviewed_at = excluded.reviewed_at;
    update finance.bank_zero_observations
    set status = 'matched', review_reason = null
    where id = v_observation.id;
    if v_observation.observation_kind = 'statement' then
      update finance.bank_zero_movements
      set reconciliation_state = 'statement_confirmed',
          posted_on = coalesce(v_observation.posted_on, posted_on), updated_at = now()
      where id = p_movement_id;
    end if;
    update finance.bank_zero_received_emails
    set processing_outcome = 'processed', outcome_reason = null, updated_at = now()
    where id = v_email.id;
  elsif p_action = 'dismiss' then
    update finance.bank_zero_observations
    set status = 'ignored', review_reason = null
    where id = v_observation.id;
    update finance.bank_zero_received_emails
    set processing_outcome = 'ignored', outcome_reason = 'Dismissed by a household member', updated_at = now()
    where id = v_email.id;
  else
    if v_email.source_expired_at is not null then
      raise exception 'bank_zero_source_expired: the original email source has expired';
    end if;
    v_result := public.bank_zero_record_observation_v1(
      v_email.route_key,
      'manual-replay:' || gen_random_uuid()::text,
      v_email.original_message_id,
      v_email.raw_r2_key,
      v_email.raw_sha256,
      v_email.received_at,
      v_email.receipt_metadata || jsonb_build_object('manualReplay', true),
      jsonb_build_object(
        'evidenceKey', v_observation.evidence_key,
        'messageClass', coalesce(v_observation.parsed_values->>'messageClass', case v_observation.observation_kind when 'statement' then 'statement' when 'proof' then 'proof_of_payment' when 'balance_snapshot' then 'banking_status' when 'non_transaction' then 'non_transaction' else 'unknown' end),
        'outcome', v_observation.parsed_values->>'outcome',
        'parserVersion', v_observation.parser_version,
        'rawValues', v_observation.raw_values,
        'parsedValues', v_observation.parsed_values,
        'fieldProvenance', v_observation.field_provenance,
        'reason', null
      )
    );
    insert into finance.bank_zero_observation_audit (
      household_id, observation_id, actor_member_id, action, details
    ) values (
      v_observation.household_id, v_observation.id, v_actor, 'manual_replay_requested',
      jsonb_build_object('result', v_result)
    );
    return jsonb_build_object('action', p_action, 'result', v_result);
  end if;

  insert into finance.bank_zero_observation_audit (
    household_id, observation_id, movement_id, actor_member_id, action, details
  ) values (
    v_observation.household_id, v_observation.id, p_movement_id, v_actor,
    case when p_action = 'associate' then 'manual_association' else 'manual_dismissal' end,
    jsonb_build_object('previous_status', v_observation.status, 'reason', v_observation.review_reason)
  );
  return jsonb_build_object('action', p_action, 'observation_id', v_observation.id, 'status', case when p_action = 'associate' then 'matched' else 'ignored' end);
end;
$$;

revoke all on function public.bank_zero_list_review_v1(integer) from public, anon;
revoke all on function public.bank_zero_review_observation_v1(uuid, text, uuid) from public, anon;
grant execute on function public.bank_zero_list_review_v1(integer) to authenticated;
grant execute on function public.bank_zero_review_observation_v1(uuid, text, uuid) to authenticated;
