create or replace function public.bank_zero_adopt_uncertain_create_v1(
  p_observation_id uuid,
  p_finwise_transaction_id text
) returns jsonb
language plpgsql
security definer
set search_path = public, finance, pg_temp
as $$
declare
  v_observation finance.bank_zero_observations%rowtype;
  v_movement finance.bank_zero_movements%rowtype;
  v_outbox finance.bank_zero_publication_outbox%rowtype;
  v_transaction public.transactions%rowtype;
  v_actor uuid;
begin
  if auth.uid() is null then raise exception 'bank_zero_forbidden: sign in required'; end if;
  if nullif(btrim(p_finwise_transaction_id), '') is null then
    raise exception 'bank_zero_invalid: FinWise transaction id is required';
  end if;
  select * into v_observation
  from finance.bank_zero_observations
  where id = p_observation_id
  for update;
  if not found or not finance.is_household_member(v_observation.household_id) then
    raise exception 'bank_zero_forbidden: observation is not in your household';
  end if;
  select member.id into v_actor
  from finance.household_members member
  where member.household_id = v_observation.household_id
    and (member.auth_user_id = auth.uid() or (
      member.auth_user_id is null and finance.caller_is_verified_google()
      and lower(member.email) = lower(coalesce(auth.jwt()->>'email', ''))
    ))
  order by (member.auth_user_id = auth.uid()) desc nulls last
  limit 1;
  select movement.* into v_movement
  from finance.bank_zero_evidence_links link
  join finance.bank_zero_movements movement
    on movement.id = link.movement_id and movement.household_id = link.household_id
  where link.household_id = v_observation.household_id
    and link.observation_id = v_observation.id
    and link.relation = 'created_from'
  order by movement.created_at desc
  limit 1
  for update of movement;
  if not found then
    raise exception 'bank_zero_invalid: no movement created from this observation';
  end if;
  select * into v_outbox
  from finance.bank_zero_publication_outbox
  where household_id = v_observation.household_id
    and movement_id = v_movement.id
    and operation = 'create'
    and state = 'outcome_unknown'
  order by desired_revision desc
  limit 1
  for update;
  if not found then
    raise exception 'bank_zero_invalid: there is no uncertain create to recover';
  end if;
  select * into v_transaction
  from public.transactions transaction_row
  where transaction_row.id = p_finwise_transaction_id
    and transaction_row.household_id = v_observation.household_id
    and transaction_row.source_system = 'finwise'
    and transaction_row.source_is_archived is not true
  for update;
  if not found then
    raise exception 'bank_zero_invalid: FinWise transaction is not an active household transaction';
  end if;
  if v_transaction.account_id <> v_movement.account_id
     or v_transaction.amount <> v_movement.amount
     or v_transaction.currency_code <> v_movement.currency_code then
    raise exception 'bank_zero_conflict: FinWise transaction account, amount, or currency does not match';
  end if;
  if (v_movement.movement_type in ('card_purchase', 'card_refund') and
      coalesce(v_transaction.occurred_on, (v_transaction.date at time zone 'Africa/Johannesburg')::date)
        not between coalesce((v_movement.occurred_at at time zone 'Africa/Johannesburg')::date, v_movement.posted_on) - 7
            and coalesce((v_movement.occurred_at at time zone 'Africa/Johannesburg')::date, v_movement.posted_on) + 7)
     or (v_movement.movement_type not in ('card_purchase', 'card_refund') and v_movement.occurred_at is not null
       and date_trunc('minute', v_transaction.date) <> date_trunc('minute', v_movement.occurred_at))
     or (v_movement.movement_type not in ('card_purchase', 'card_refund') and v_movement.occurred_at is null
       and v_movement.posted_on is not null
       and coalesce(v_transaction.occurred_on, (v_transaction.date at time zone 'Africa/Johannesburg')::date)
         not between v_movement.posted_on - 1 and v_movement.posted_on + 1) then
    raise exception 'bank_zero_conflict: FinWise transaction date does not match';
  end if;
  if (v_movement.counterparty is not null and
      position(lower(v_movement.counterparty) in lower(coalesce(v_transaction.original_description, v_transaction.description, v_transaction.details->>'description', ''))) = 0)
     or (v_movement.payment_reference is not null and
      lower(coalesce(v_transaction.notes, v_transaction.details->>'notes', '')) <> lower(v_movement.payment_reference)) then
    raise exception 'bank_zero_conflict: FinWise transaction counterparty or reference does not match';
  end if;
  if exists (
    select 1 from finance.bank_zero_movements other_movement
    where other_movement.household_id = v_observation.household_id
      and other_movement.finwise_transaction_id = p_finwise_transaction_id
      and other_movement.id <> v_movement.id
  ) then
    raise exception 'bank_zero_conflict: FinWise transaction is already adopted by another movement';
  end if;
  if v_movement.finwise_transaction_id is not null
     and v_movement.finwise_transaction_id <> p_finwise_transaction_id then
    raise exception 'bank_zero_conflict: movement already has a different FinWise identity';
  end if;
  update finance.bank_zero_movements
  set finwise_transaction_id = p_finwise_transaction_id,
      publication_state = 'pending', updated_at = now()
  where id = v_movement.id and household_id = v_observation.household_id;
  update finance.bank_zero_publication_outbox
  set operation = 'project', state = 'pending',
      exact_request = v_transaction.details,
      finwise_transaction_id = p_finwise_transaction_id,
      lease_owner = null, lease_expires_at = null, last_error = null,
      next_attempt_at = now(), updated_at = now()
  where id = v_outbox.id;
  update finance.bank_zero_observations
  set status = 'matched', review_reason = null
  where id = v_observation.id;
  insert into finance.bank_zero_observation_audit (
    household_id, observation_id, movement_id, actor_member_id, action, details
  ) values (
    v_observation.household_id, v_observation.id, v_movement.id, v_actor,
    'uncertain_create_adopted', jsonb_build_object(
      'finwise_transaction_id', p_finwise_transaction_id,
      'outbox_id', v_outbox.id
    )
  );
  return jsonb_build_object(
    'observation_id', v_observation.id,
    'movement_id', v_movement.id,
    'finwise_transaction_id', p_finwise_transaction_id,
    'status', 'projection_pending'
  );
end;
$$;

revoke all on function public.bank_zero_adopt_uncertain_create_v1(uuid, text) from public, anon;
grant execute on function public.bank_zero_adopt_uncertain_create_v1(uuid, text) to authenticated;
