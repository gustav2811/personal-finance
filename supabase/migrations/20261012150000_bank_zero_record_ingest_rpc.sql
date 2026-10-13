create or replace function public.bank_zero_record_observation_v1(
  p_route_key text,
  p_delivery_id text,
  p_message_id text,
  p_raw_r2_key text,
  p_raw_sha256 text,
  p_received_at timestamptz,
  p_receipt_metadata jsonb,
  p_observation jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_route finance.bank_zero_routes%rowtype;
  v_email_id uuid;
  v_observation_id uuid;
  v_dedupe_key text;
  v_evidence_key text;
  v_existing_hash text;
  v_alias text;
  v_account_number text;
  v_account_id uuid;
  v_account_count integer;
  v_kind text;
  v_status text;
  v_outcome text;
  v_conflict text;
  v_route_count integer;
  v_message_class text;
  v_amount_minor numeric;
  v_signed_amount numeric;
  v_direction text;
  v_movement_type text;
  v_payment_method text;
  v_counterparty text;
  v_reference text;
  v_event_at timestamptz;
  v_posted_on date;
  v_event_precision text;
  v_policy_enabled boolean;
  v_candidate_ids uuid[];
  v_candidate_count integer;
  v_history_candidate_count integer;
  v_existing_finwise_id text;
  v_plausible_count integer;
  v_original_candidate_ids uuid[];
  v_original_candidate_count integer;
  v_original_movement_id uuid;
  v_movement_id uuid;
  v_description text;
  v_notes text;
  v_finwise_date text;
  v_exact_request jsonb;
  v_link_relation text;
  v_existing_movement finance.bank_zero_movements%rowtype;
  v_next_revision integer;
  v_create_update_count integer;
begin
  if p_route_key is null or btrim(p_route_key) = '' then
    raise exception 'trusted route key is required';
  end if;
  if p_delivery_id is null or btrim(p_delivery_id) = '' then
    raise exception 'transport delivery id is required';
  end if;
  if p_raw_r2_key is null or p_raw_r2_key !~ '^ingest/[a-f0-9-]+/email\.raw$' then
    raise exception 'durable raw email pointer is required';
  end if;
  if p_raw_sha256 is null or p_raw_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'raw email sha256 is invalid';
  end if;
  if jsonb_typeof(coalesce(p_receipt_metadata, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_observation, '{}'::jsonb)) <> 'object' then
    raise exception 'receipt and observation must be JSON objects';
  end if;

  select count(*) into v_route_count
  from finance.bank_zero_routes
  where route_key = p_route_key;
  if v_route_count <> 1 then
    raise exception 'unknown or ambiguous Bank Zero receiving route';
  end if;

  select * into v_route
  from finance.bank_zero_routes
  where route_key = p_route_key;
  if not found or v_route.status = 'paused' then
    raise exception 'unknown or paused Bank Zero receiving route';
  end if;

  v_dedupe_key := case
    when nullif(btrim(p_message_id), '') is not null
      then 'message:' || lower(regexp_replace(btrim(p_message_id), '^<|>$', '', 'g'))
    else 'sha256:' || p_raw_sha256
  end;
  v_evidence_key := coalesce(nullif(p_observation->>'evidenceKey', ''), 'message');

  insert into finance.bank_zero_received_emails (
    household_id, route_key, original_message_id, dedupe_key,
    raw_r2_key, raw_sha256, receipt_metadata, received_at, processing_outcome
  ) values (
    v_route.household_id,
    p_route_key,
    nullif(btrim(p_message_id), ''),
    v_dedupe_key,
    p_raw_r2_key,
    p_raw_sha256,
    coalesce(p_receipt_metadata, '{}'::jsonb),
    coalesce(p_received_at, now()),
    'received'
  )
  on conflict (household_id, route_key, dedupe_key) do nothing
  returning id into v_email_id;

  if v_email_id is null then
    select id, raw_sha256 into v_email_id, v_existing_hash
    from finance.bank_zero_received_emails
    where household_id = v_route.household_id
      and route_key = p_route_key
      and dedupe_key = v_dedupe_key
    for update;
    if v_existing_hash is distinct from p_raw_sha256 then
      v_conflict := 'Original Message-ID was redelivered with different content';
      update finance.bank_zero_received_emails
      set processing_outcome = 'needs_review', outcome_reason = v_conflict, updated_at = now()
      where id = v_email_id;
      v_evidence_key := 'identity-conflict:' || p_delivery_id;
    end if;
  end if;

  insert into finance.bank_zero_delivery_attempts (
    household_id, route_key, received_email_id, transport_id, received_at, envelope
  ) values (
    v_route.household_id,
    p_route_key,
    v_email_id,
    p_delivery_id,
    coalesce(p_received_at, now()),
    coalesce(p_receipt_metadata->'envelope', '{}'::jsonb)
  ) on conflict (household_id, route_key, transport_id) do nothing;

  v_alias := lower(regexp_replace(
    btrim(coalesce(p_observation->'parsedValues'->>'accountAlias', '')),
    '\s+', ' ', 'g'
  ));
  v_account_number := nullif(regexp_replace(
    coalesce(p_observation->'parsedValues'->>'accountNumber', ''),
    '\D', '', 'g'
  ), '');

  if v_alias <> '' then
    select count(*), min(alias.account_id::text)::uuid
      into v_account_count, v_account_id
    from finance.bank_zero_account_aliases alias
    where alias.household_id = v_route.household_id
      and alias.route_key = p_route_key
      and alias.alias_normalized = v_alias
      and alias.status = 'active'
      and alias.valid_from <= coalesce((p_observation->'parsedValues'->>'eventAt')::timestamptz::date, current_date)
      and (alias.valid_to is null or alias.valid_to >= coalesce((p_observation->'parsedValues'->>'eventAt')::timestamptz::date, current_date))
      and (v_account_number is null or alias.account_number is null or alias.account_number = v_account_number);
  else
    v_account_count := 0;
  end if;
  if v_account_count <> 1 then v_account_id := null; end if;

  v_kind := case p_observation->>'messageClass'
    when 'statement' then 'statement'
    when 'proof_of_payment' then 'proof'
    when 'banking_status' then 'balance_snapshot'
    when 'non_transaction' then 'non_transaction'
    when 'unknown' then 'unknown'
    when null then 'unknown'
    else 'alert'
  end;
  v_message_class := coalesce(p_observation->>'messageClass', 'unknown');
  select coalesce(
    (select capability.enabled
     from finance.bank_zero_route_capabilities capability
     where capability.household_id = v_route.household_id
       and capability.route_key = p_route_key
       and capability.message_class = v_message_class),
    v_message_class = 'statement'
  ) into v_policy_enabled;
  v_outcome := p_observation->>'outcome';
  v_status := case
    when v_conflict is not null then 'needs_review'
    when v_route.status <> 'active' then 'deferred'
    when v_kind = 'unknown' or coalesce(p_observation->>'conflict', '') <> '' then 'needs_review'
    when v_kind = 'non_transaction' then 'ignored'
    when v_kind = 'proof' and v_account_id is null then 'needs_review'
    when v_outcome = 'movement_candidate' and v_account_id is null then 'needs_review'
    when v_outcome = 'movement_candidate' and not v_policy_enabled then 'deferred'
    when v_outcome = 'review' then 'needs_review'
    when v_kind = 'statement' then 'observed'
    when v_kind = 'balance_snapshot' then 'observed'
    else 'observed'
  end;

  insert into finance.bank_zero_observations (
    household_id, received_email_id, evidence_key, observation_kind,
    parser_version, raw_values, parsed_values, field_provenance,
    status, review_reason, occurred_at, posted_on
  ) values (
    v_route.household_id,
    v_email_id,
    v_evidence_key,
    v_kind,
    coalesce(nullif(p_observation->>'parserVersion', ''), 'bank-zero-email-v1'),
    jsonb_build_object(
      'subject', left(coalesce(p_observation->'rawValues'->>'subject', ''), 1000),
      'bodySnippet', left(coalesce(p_observation->'rawValues'->>'bodySnippet', ''), 4000),
      'attachments', coalesce(p_observation->'rawValues'->'attachments', '[]'::jsonb)
    ),
    coalesce(p_observation->'parsedValues', '{}'::jsonb) ||
      case when v_account_id is null then '{}'::jsonb else jsonb_build_object('accountId', v_account_id) end,
    coalesce(p_observation->'fieldProvenance', '{}'::jsonb),
    v_status,
    coalesce(v_conflict, nullif(p_observation->>'conflict', ''),
      case when v_account_id is null and v_kind in ('alert', 'proof') then 'No unique active account alias for this profile' else null end,
      nullif(p_observation->>'reason', '')),
    nullif(p_observation->'parsedValues'->>'eventAt', '')::timestamptz,
    nullif(p_observation->'parsedValues'->>'postedOn', '')::date
  )
  on conflict (household_id, received_email_id, evidence_key) do update set
    raw_values = excluded.raw_values,
    parsed_values = excluded.parsed_values,
    field_provenance = excluded.field_provenance,
    status = case
      when finance.bank_zero_observations.status = 'matched' then 'matched'
      else excluded.status
    end,
    review_reason = case
      when excluded.status in ('observed', 'matched') then excluded.review_reason
      else coalesce(excluded.review_reason, finance.bank_zero_observations.review_reason)
    end
  returning id into v_observation_id;

  if v_kind = 'balance_snapshot' and v_status = 'observed'
     and v_account_id is not null
     and nullif(p_observation->'parsedValues'->>'balanceMinor', '') is not null then
    insert into finance.bank_zero_balance_snapshots (
      household_id, route_key, account_id, amount, currency_code,
      observed_at, source_observation_id
    ) values (
      v_route.household_id, p_route_key, v_account_id,
      nullif(p_observation->'parsedValues'->>'balanceMinor', '')::numeric / 100,
      coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR'),
      coalesce(nullif(p_observation->'parsedValues'->>'eventAt', '')::timestamptz, p_received_at, now()),
      v_observation_id
    ) on conflict (household_id, source_observation_id, account_id) do update set
      amount = excluded.amount, observed_at = excluded.observed_at;
  end if;

  -- Each supported movement observation either attaches to one conservative
  -- candidate or creates a new internal identity. Date and amount alone never
  -- establish a match.
  if v_status = 'observed' and v_account_id is not null
     and v_outcome = 'movement_candidate'
     and v_message_class in ('money_received', 'paid', 'card_purchase', 'card_refund', 'payment_returned', 'fee', 'statement') then
    select link.movement_id into v_movement_id
    from finance.bank_zero_evidence_links link
    where link.household_id = v_route.household_id
      and link.observation_id = v_observation_id
    limit 1;

    if v_movement_id is null then
      v_amount_minor := nullif(p_observation->'parsedValues'->>'amountMinor', '')::numeric;
      v_direction := p_observation->'parsedValues'->>'direction';
      if v_amount_minor is null or v_amount_minor <= 0 or v_amount_minor <> trunc(v_amount_minor)
         or v_direction not in ('credit', 'debit') then
        v_status := 'needs_review';
        v_conflict := 'Movement amount or direction is missing or invalid';
      else
        v_signed_amount := case when v_direction = 'credit' then v_amount_minor / 100 else -v_amount_minor / 100 end;
        v_movement_type := coalesce(nullif(p_observation->'parsedValues'->>'movementType', ''), case v_message_class
          when 'money_received' then 'receipt'
          when 'paid' then 'payment'
          when 'card_purchase' then 'card_purchase'
          when 'card_refund' then 'card_refund'
          when 'payment_returned' then 'return'
          when 'fee' then 'fee'
          else 'statement_movement'
        end);
        if v_movement_type not in ('payment', 'receipt', 'card_purchase', 'card_refund', 'return', 'fee', 'transfer_leg', 'interest', 'statement_movement', 'other') then
          v_status := 'needs_review';
          v_conflict := 'Movement type is unsupported';
        else
          v_counterparty := nullif(btrim(p_observation->'parsedValues'->>'counterparty'), '');
          v_reference := nullif(btrim(p_observation->'parsedValues'->>'reference'), '');
          v_payment_method := nullif(p_observation->'parsedValues'->>'paymentMethod', '');
          v_notes := v_reference;
          v_event_at := nullif(p_observation->'parsedValues'->>'eventAt', '')::timestamptz;
          v_posted_on := nullif(p_observation->'parsedValues'->>'postedOn', '')::date;
          v_event_precision := coalesce(nullif(p_observation->'parsedValues'->>'eventPrecision', ''), case when v_event_at is null then 'day' else 'minute' end);
          v_description := coalesce(
            nullif(p_observation->'parsedValues'->>'displayDescription', ''),
            v_counterparty || case when v_reference is null then '' else ' — ' || v_reference end,
            v_reference, v_counterparty, initcap(replace(v_movement_type, '_', ' '))
          );

          -- Serialize reconciliation for one household account. This makes the
          -- candidate query and movement/outbox insert one account-scoped
          -- critical section across concurrent webhook deliveries.
          perform pg_advisory_xact_lock(
            hashtextextended(v_route.household_id::text || ':' || v_account_id::text, 0)
          );

          select coalesce(array_agg(candidate.id), '{}'::uuid[])
            into v_candidate_ids
          from finance.bank_zero_movements candidate
          where candidate.household_id = v_route.household_id
            and candidate.account_id = v_account_id
            and candidate.currency_code = coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR')
            and candidate.amount = v_signed_amount
            and (
              candidate.movement_type = v_movement_type
              or (v_message_class = 'statement' and (
                v_movement_type = 'payment' and candidate.movement_type in ('payment', 'statement_movement')
                or v_movement_type = 'receipt' and candidate.movement_type in ('receipt', 'statement_movement')
                or v_movement_type = 'card_purchase' and candidate.movement_type in ('card_purchase', 'statement_movement')
                or v_movement_type = 'card_refund' and candidate.movement_type in ('card_refund', 'statement_movement')
                or v_movement_type = 'fee' and candidate.movement_type in ('fee', 'statement_movement')
                or v_movement_type = 'interest' and candidate.movement_type in ('interest', 'statement_movement')
                or v_movement_type = 'transfer_leg' and candidate.movement_type in ('transfer_leg', 'statement_movement')
              ))
            )
            and candidate.reconciliation_state <> 'needs_review'
            and not (
              v_message_class = 'statement'
              and exists (
                select 1
                from finance.bank_zero_evidence_links prior_link
                join finance.bank_zero_observations prior_observation
                  on prior_observation.household_id = prior_link.household_id
                 and prior_observation.id = prior_link.observation_id
                where prior_link.household_id = candidate.household_id
                  and prior_link.movement_id = candidate.id
                  and prior_observation.observation_kind = 'statement'
                  and prior_observation.parsed_values->>'statementContentSha256' = p_observation->'parsedValues'->>'statementContentSha256'
                  and prior_observation.parsed_values->>'statementSheet' = p_observation->'parsedValues'->>'statementSheet'
                  and prior_observation.parsed_values->>'statementRow' <> p_observation->'parsedValues'->>'statementRow'
              )
            )
            and (v_reference is not null and candidate.payment_reference is not null
                 and lower(candidate.payment_reference) = lower(v_reference)
              or v_counterparty is not null and candidate.counterparty is not null
                 and lower(candidate.counterparty) = lower(v_counterparty))
            and (
              ((v_movement_type in ('card_purchase', 'card_refund')
                  or candidate.movement_type in ('card_purchase', 'card_refund'))
                and coalesce((candidate.occurred_at at time zone 'Africa/Johannesburg')::date, candidate.posted_on) between
                  coalesce(v_event_at::date, v_posted_on) - 7 and coalesce(v_event_at::date, v_posted_on) + 7)
              or (v_movement_type not in ('card_purchase', 'card_refund')
                and candidate.movement_type not in ('card_purchase', 'card_refund')
                and coalesce((candidate.occurred_at at time zone 'Africa/Johannesburg')::date, candidate.posted_on) between
                  coalesce(v_event_at::date, v_posted_on) - 1 and coalesce(v_event_at::date, v_posted_on) + 1)
            )
            and (v_event_at is null or candidate.occurred_at is null
              or ((v_movement_type in ('card_purchase', 'card_refund')
                    or candidate.movement_type in ('card_purchase', 'card_refund'))
                  and (candidate.occurred_at at time zone 'Africa/Johannesburg')::date between
                    (v_event_at at time zone 'Africa/Johannesburg')::date - 7
                    and (v_event_at at time zone 'Africa/Johannesburg')::date + 7)
              or (v_movement_type not in ('card_purchase', 'card_refund')
                  and candidate.movement_type not in ('card_purchase', 'card_refund')
                  and abs(extract(epoch from (candidate.occurred_at - v_event_at))) <= 120))
            and not (
              v_message_class in ('money_received', 'paid', 'card_purchase', 'card_refund', 'payment_returned', 'fee')
              and v_event_at is not null
              and exists (
                select 1
                from finance.bank_zero_evidence_links prior_link
                join finance.bank_zero_observations prior_observation
                  on prior_observation.household_id = prior_link.household_id
                 and prior_observation.id = prior_link.observation_id
                where prior_link.household_id = candidate.household_id
                  and prior_link.movement_id = candidate.id
                  and prior_link.relation = 'created_from'
                  and prior_observation.parsed_values->>'messageClass' = v_message_class
                  and nullif(prior_observation.parsed_values->>'eventAt', '') is not null
                  and (prior_observation.parsed_values->>'eventAt')::timestamptz <> v_event_at
              )
            );
          v_candidate_count := coalesce(cardinality(v_candidate_ids), 0);

          if v_candidate_count = 0 and v_message_class = 'statement'
             and v_movement_type in ('card_purchase', 'card_refund') then
            select count(*), coalesce(array_agg(candidate.id), '{}'::uuid[])
              into v_plausible_count, v_candidate_ids
            from finance.bank_zero_movements candidate
            where candidate.household_id = v_route.household_id
              and candidate.account_id = v_account_id
              and candidate.currency_code = coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR')
              and candidate.movement_type = v_movement_type
              and candidate.amount <> v_signed_amount
              and candidate.reconciliation_state <> 'needs_review'
              and (v_reference is not null and candidate.payment_reference is not null
                   and lower(candidate.payment_reference) = lower(v_reference)
                or v_counterparty is not null and candidate.counterparty is not null
                   and lower(candidate.counterparty) = lower(v_counterparty))
              and coalesce(candidate.occurred_at::date, candidate.posted_on) between
                coalesce(v_event_at::date, v_posted_on) - 7 and coalesce(v_event_at::date, v_posted_on) + 7;
            if v_plausible_count > 0 then
              v_status := 'needs_review';
              v_conflict := 'Card statement amount differs from a plausible alert; settlement reconciliation requires review';
              update finance.bank_zero_publication_outbox
              set state = 'needs_review', last_error = v_conflict,
                  lease_owner = null, lease_expires_at = null, updated_at = now()
              where movement_id = any(v_candidate_ids)
                and operation = 'create' and state in ('pending', 'retryable_failure');
              update finance.bank_zero_movements
              set publication_state = 'deferred', updated_at = now()
              where id = any(v_candidate_ids) and publication_state in ('pending', 'retryable_failure');
            end if;
          end if;

          -- Adopt an exact, unique match from existing FinWise history before
          -- creating a provisional movement. Ambiguous history is held for
          -- review; it must never become a second remote create.
          if v_candidate_count = 0 and v_status <> 'needs_review' then
            select count(*), min(transaction_row.id)
              into v_history_candidate_count, v_existing_finwise_id
            from public.transactions transaction_row
            where transaction_row.household_id = v_route.household_id
              and transaction_row.source_system = 'finwise'
              and transaction_row.account_id = v_account_id
              and transaction_row.amount = v_signed_amount
              and transaction_row.currency_code = coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR')
              and transaction_row.source_is_archived is not true
              and not exists (
                select 1 from finance.bank_zero_movements adopted
                where adopted.household_id = v_route.household_id
                  and adopted.finwise_transaction_id = transaction_row.id
              )
              and coalesce(transaction_row.occurred_on,
                    (transaction_row.date at time zone 'Africa/Johannesburg')::date) between
                coalesce((v_event_at at time zone 'Africa/Johannesburg')::date, v_posted_on) -
                  case when v_movement_type in ('card_purchase', 'card_refund') then 7 else 1 end
                and coalesce((v_event_at at time zone 'Africa/Johannesburg')::date, v_posted_on) +
                  case when v_movement_type in ('card_purchase', 'card_refund') then 7 else 1 end
              and (v_event_at is null or date_trunc('minute', transaction_row.date) = date_trunc('minute', v_event_at))
              and (
                (v_reference is not null and (
                  lower(coalesce(transaction_row.notes, transaction_row.details->>'notes', transaction_row.details->>'note', '')) = lower(v_reference)
                ))
                or (v_counterparty is not null and (
                  lower(coalesce(transaction_row.original_description, '')) = lower(v_counterparty)
                  or position(lower(v_counterparty) in lower(coalesce(transaction_row.description, transaction_row.details->>'description', ''))) > 0
                ))
              );
            if v_history_candidate_count > 1 then
              v_status := 'needs_review';
              v_conflict := 'Existing FinWise history has more than one compatible transaction';
              v_existing_finwise_id := null;
            end if;
          end if;

          if v_candidate_count > 1 then
            v_status := 'needs_review';
            v_conflict := 'More than one compatible movement candidate';
          elsif v_candidate_count = 1 then
            v_movement_id := v_candidate_ids[1];
            if v_message_class = 'statement' then
              update finance.bank_zero_movements
              set reconciliation_state = 'statement_confirmed',
                  posted_on = coalesce(v_posted_on, posted_on),
                  updated_at = now()
              where id = v_movement_id
              returning * into v_existing_movement;
              v_link_relation := 'confirms';
              if v_description is distinct from v_existing_movement.display_description then
                if v_existing_movement.finwise_transaction_id is null then
                  update finance.bank_zero_publication_outbox
                  set exact_request = jsonb_set(
                    jsonb_set(exact_request, '{description}', to_jsonb(v_description), true),
                    '{notes}', coalesce(to_jsonb(v_notes), 'null'::jsonb), true
                  ), updated_at = now()
                  where movement_id = v_movement_id and operation = 'create' and state = 'pending';
                  get diagnostics v_create_update_count = row_count;
                  if v_create_update_count > 0 then
                    update finance.bank_zero_movements
                    set display_description = v_description,
                        last_importer_values = jsonb_build_object('description', v_description, 'notes', v_notes),
                        updated_at = now()
                    where id = v_movement_id;
                  end if;
                elsif v_existing_movement.last_importer_values->>'description' is distinct from v_existing_movement.display_description then
                  v_status := 'needs_review';
                  v_conflict := 'Statement wording conflicts with a household-edited movement description';
                elsif exists (
                  select 1 from finance.bank_zero_publication_outbox outbox
                  where outbox.household_id = v_route.household_id
                    and outbox.movement_id = v_movement_id
                    and outbox.operation = 'project' and outbox.state = 'published'
                ) then
                  select coalesce(max(desired_revision), 0) + 1 into v_next_revision
                  from finance.bank_zero_publication_outbox
                  where household_id = v_route.household_id and movement_id = v_movement_id;
                  insert into finance.bank_zero_publication_outbox (
                    household_id, movement_id, desired_revision, operation, state, exact_request,
                    finwise_transaction_id
                  ) values (
                    v_route.household_id, v_movement_id, v_next_revision, 'update', 'pending',
                    jsonb_build_object(
                      'finwise_transaction_id', v_existing_movement.finwise_transaction_id,
                      'account_id', v_existing_movement.account_id,
                      'amount', v_existing_movement.amount,
                      'currency_code', v_existing_movement.currency_code,
                      'expected', jsonb_build_object('description', v_existing_movement.display_description,
                        'notes', v_existing_movement.last_importer_values->'notes'),
                      'patch', jsonb_build_object('description', v_description, 'notes', v_notes)
                    ),
                    v_existing_movement.finwise_transaction_id
                  ) on conflict (household_id, movement_id, desired_revision) do nothing;
                  update finance.bank_zero_movements
                  set display_description = v_description,
                      last_importer_values = jsonb_build_object('description', v_description, 'notes', v_notes),
                      updated_at = now()
                  where id = v_movement_id;
                end if;
              end if;
            else
              v_link_relation := 'supports';
            end if;
            insert into finance.bank_zero_evidence_links (
              household_id, observation_id, movement_id, relation, matching_method, decision_reason
            ) values (
              v_route.household_id, v_observation_id, v_movement_id, v_link_relation,
              'exact_amount_and_counterparty_or_reference_v1', 'Unique account-scoped candidate inside the class window'
            ) on conflict (household_id, observation_id, movement_id) do nothing;
          elsif v_status = 'needs_review' then
            null;
          else
            if v_message_class = 'statement' then
              v_movement_type := coalesce(nullif(p_observation->'parsedValues'->>'movementType', ''), 'statement_movement');
            end if;
            v_notes := v_reference;
            insert into finance.bank_zero_movements (
              household_id, route_key, member_id, account_id, movement_type, payment_method,
              amount, currency_code, occurred_at, event_precision, posted_on,
              counterparty, payment_reference, display_description, reconciliation_state,
              publication_state, finwise_transaction_id, last_importer_values
            ) values (
              v_route.household_id, p_route_key, v_route.member_id, v_account_id,
              v_movement_type, v_payment_method, v_signed_amount,
              coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR'),
              v_event_at, v_event_precision, v_posted_on, v_counterparty, v_reference,
              v_description, case when v_message_class = 'statement' then 'statement_confirmed' else 'alert_observed' end,
              case when v_existing_finwise_id is null then 'deferred' else 'published' end,
              v_existing_finwise_id, jsonb_build_object('description', v_description, 'notes', v_notes)
            ) returning id into v_movement_id;
            insert into finance.bank_zero_evidence_links (
              household_id, observation_id, movement_id, relation, matching_method, decision_reason
            ) values (
              v_route.household_id, v_observation_id, v_movement_id, 'created_from',
              case when v_existing_finwise_id is null then 'new_identity_no_compatible_candidate_v1' else 'existing_finwise_history_v1' end,
              case when v_existing_finwise_id is null then 'No compatible account-scoped movement exists'
                else 'Unique existing FinWise history transaction was adopted' end
            );
          end if;

          if v_movement_id is not null and v_movement_type in ('card_refund', 'return') then
            select count(*), coalesce(array_agg(candidate.id), '{}'::uuid[])
              into v_original_candidate_count, v_original_candidate_ids
            from finance.bank_zero_movements candidate
            where candidate.household_id = v_route.household_id
              and candidate.account_id = v_account_id
              and candidate.currency_code = coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR')
              and candidate.id <> v_movement_id
              and candidate.amount < 0
              and abs(candidate.amount) >= abs(v_signed_amount)
              and candidate.movement_type = case when v_movement_type = 'card_refund' then 'card_purchase' else 'payment' end
              and (v_reference is not null and candidate.payment_reference is not null
                   and lower(candidate.payment_reference) = lower(v_reference)
                or v_counterparty is not null and candidate.counterparty is not null
                   and lower(candidate.counterparty) = lower(v_counterparty))
              and coalesce((candidate.occurred_at at time zone 'Africa/Johannesburg')::date, candidate.posted_on)
                between coalesce(v_event_at::date, v_posted_on) - 365 and coalesce(v_event_at::date, v_posted_on);
            if v_original_candidate_count = 1 then
              v_original_movement_id := v_original_candidate_ids[1];
              update finance.bank_zero_movements
              set refund_of_movement_id = v_original_movement_id, updated_at = now()
              where id = v_movement_id and household_id = v_route.household_id
                and (refund_of_movement_id is null or refund_of_movement_id = v_original_movement_id);
              insert into finance.bank_zero_evidence_links (
                household_id, observation_id, movement_id, relation, matching_method, decision_reason
              ) values (
                v_route.household_id, v_observation_id, v_original_movement_id,
                case when v_movement_type = 'card_refund' then 'refund_of' else 'return_of' end,
                'unique_opposite_movement_and_counterparty_v1',
                'Unique earlier debit with matching account, amount coverage, and counterparty or reference'
              ) on conflict (household_id, observation_id, movement_id) do nothing;
            elsif v_original_candidate_count > 1 then
              v_status := 'needs_review';
              v_conflict := 'Refund or return has more than one plausible original movement';
            end if;
          end if;

          if v_status = 'observed' and v_movement_id is not null then
            if v_message_class = 'statement' then
              v_policy_enabled := true;
            end if;
            if v_policy_enabled and v_existing_finwise_id is null then
              v_finwise_date := case
                when v_event_at is not null then to_char(v_event_at at time zone 'Africa/Johannesburg', 'YYYY-MM-DD"T"HH24:MI:SS') || '+02:00'
                else coalesce(v_posted_on, v_event_at::date)::text
              end;
              v_description := coalesce(
                nullif(p_observation->'parsedValues'->>'displayDescription', ''),
                v_counterparty || case when v_reference is null then '' else ' — ' || v_reference end,
                v_reference, v_counterparty, initcap(replace(v_movement_type, '_', ' '))
              );
              v_exact_request := jsonb_build_object(
                'accountId', v_account_id::text,
                'date', v_finwise_date,
                'description', v_description,
                'amount', jsonb_build_object('amount', v_signed_amount, 'currencyCode', coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR')),
                'notes', v_notes
              );
              insert into finance.bank_zero_publication_outbox (
                household_id, movement_id, operation, state, exact_request
              ) values (
                v_route.household_id, v_movement_id, 'create', 'pending', v_exact_request
              ) on conflict (household_id, movement_id, desired_revision) do nothing;
              update finance.bank_zero_movements set publication_state = 'pending', updated_at = now()
              where id = v_movement_id and finwise_transaction_id is null;
            elsif v_existing_finwise_id is not null then
              null;
            else
              update finance.bank_zero_movements set publication_state = 'deferred', updated_at = now()
              where id = v_movement_id and finwise_transaction_id is null;
              v_status := 'deferred';
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  if v_status = 'observed' and v_kind = 'proof' then
    v_amount_minor := nullif(p_observation->'parsedValues'->>'amountMinor', '')::numeric;
    v_direction := p_observation->'parsedValues'->>'direction';
    v_event_at := nullif(p_observation->'parsedValues'->>'eventAt', '')::timestamptz;
    v_posted_on := nullif(p_observation->'parsedValues'->>'postedOn', '')::date;
    v_counterparty := nullif(btrim(p_observation->'parsedValues'->>'counterparty'), '');
    v_reference := nullif(btrim(p_observation->'parsedValues'->>'reference'), '');
    if v_amount_minor is null or v_amount_minor <= 0 or v_direction not in ('credit', 'debit') then
      v_status := 'needs_review';
      v_conflict := 'Proof amount or direction is missing or invalid';
    else
      v_signed_amount := case when v_direction = 'credit' then v_amount_minor / 100 else -v_amount_minor / 100 end;
      select coalesce(array_agg(candidate.id), '{}'::uuid[])
        into v_candidate_ids
      from finance.bank_zero_movements candidate
      where candidate.household_id = v_route.household_id
        and candidate.account_id = v_account_id
        and candidate.currency_code = coalesce(nullif(p_observation->'parsedValues'->>'currency', ''), 'ZAR')
        and candidate.amount = v_signed_amount
        and candidate.reconciliation_state <> 'needs_review'
        and (v_reference is not null and lower(candidate.payment_reference) = lower(v_reference)
          or v_counterparty is not null and lower(candidate.counterparty) = lower(v_counterparty))
        and coalesce(candidate.occurred_at::date, candidate.posted_on) between
          coalesce(v_event_at::date, v_posted_on) - 1 and coalesce(v_event_at::date, v_posted_on) + 1;
      v_candidate_count := coalesce(cardinality(v_candidate_ids), 0);
      if v_candidate_count = 1 then
        v_movement_id := v_candidate_ids[1];
        insert into finance.bank_zero_evidence_links (
          household_id, observation_id, movement_id, relation, matching_method, decision_reason
        ) values (
          v_route.household_id, v_observation_id, v_movement_id, 'supports',
          'exact_amount_and_counterparty_or_reference_v1', 'Unique existing movement matched to payment proof'
        ) on conflict (household_id, observation_id, movement_id) do nothing;
        update finance.bank_zero_observations set status = 'matched', review_reason = null where id = v_observation_id;
      elsif v_candidate_count > 1 then
        v_status := 'needs_review';
        v_conflict := 'Proof matches more than one compatible movement';
      else
        v_status := 'needs_review';
        v_conflict := 'Proof is waiting for a uniquely matching movement';
      end if;
    end if;
  end if;

  if v_status in ('needs_review', 'deferred') then
    update finance.bank_zero_observations
    set status = v_status,
        review_reason = coalesce(v_conflict, review_reason, case when v_status = 'deferred' then 'Message class or route is not enabled for automatic publication' end)
    where id = v_observation_id;
  end if;

  update finance.bank_zero_received_emails
  set processing_outcome = case
      when v_status = 'needs_review' then 'needs_review'
      when v_status = 'deferred' then 'deferred'
      when v_status = 'ignored' then 'ignored'
      else 'processed'
    end,
    outcome_reason = coalesce(v_conflict, nullif(p_observation->>'reason', ''), case when v_status = 'deferred' then 'Route or message class is not enabled' end),
    updated_at = now()
  where id = v_email_id
    and processing_outcome not in ('needs_review', 'terminal_failure');

  insert into finance.bank_zero_observation_audit (
    household_id, observation_id, action, details
  ) values (
    v_route.household_id,
    v_observation_id,
    'received_or_replayed',
    jsonb_build_object('delivery_id', p_delivery_id, 'status', v_status, 'account_id', v_account_id)
  );

  return jsonb_build_object(
    'received_email_id', v_email_id,
    'observation_id', v_observation_id,
    'household_id', v_route.household_id,
    'member_id', v_route.member_id,
    'account_id', v_account_id,
    'route_status', v_route.status,
    'status', v_status,
    'outcome', v_outcome
  );
end;
$$;

revoke all on function public.bank_zero_record_observation_v1(text,text,text,text,text,timestamptz,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.bank_zero_record_observation_v1(text,text,text,text,text,timestamptz,jsonb,jsonb) to service_role;
