-- Runs against an activated Bank Zero baseline and rolls back all fixture writes.
begin;
do $test$
declare
  v_before integer;
  v_after integer;
  v_movement finance.bank_zero_movements%rowtype;
  v_alias finance.bank_zero_account_aliases%rowtype;
  v_result jsonb;
  v_delivery text := 'matched-baseline-regression-' || gen_random_uuid()::text;
begin
  select movement.* into strict v_movement
  from finance.bank_zero_movements movement
  join finance.bank_zero_routes route using (household_id, route_key)
  where route.status = 'active'
    and movement.finwise_transaction_id is not null
    and movement.counterparty = 'Dormancy fee'
    and movement.amount = -5
    and movement.posted_on is not null
    and not exists (
      select 1 from finance.bank_zero_publication_outbox outbox
      where outbox.movement_id = movement.id
    )
  order by movement.posted_on limit 1;
  select * into strict v_alias from finance.bank_zero_account_aliases
  where household_id = v_movement.household_id and account_id = v_movement.account_id
    and route_key = v_movement.route_key and status = 'active' limit 1;
  select count(*) into v_before from finance.bank_zero_publication_outbox;
  v_result := public.bank_zero_record_observation_v1(
    v_movement.route_key, v_delivery, v_delivery, 'ingest/00000000-0000-4000-8000-000000000000/email.raw',
    repeat('0', 64), now(), '{}'::jsonb,
    jsonb_build_object(
      'evidenceKey', 'statement:regression', 'messageClass', 'statement',
      'outcome', 'movement_candidate', 'parserVersion', 'regression',
      'rawValues', '{}'::jsonb,
      'parsedValues', jsonb_build_object(
        'messageClass', 'statement', 'outcome', 'movement_candidate',
        'movementType', 'fee', 'direction', 'debit', 'amountMinor', 500,
        'currency', 'ZAR', 'accountAlias', v_alias.alias_display,
        'accountNumber', v_alias.account_number,
        'counterparty', v_movement.counterparty,
        'displayDescription', v_movement.display_description,
        'postedOn', v_movement.posted_on, 'eventPrecision', 'day'
      )
    )
  );
  select count(*) into v_after from finance.bank_zero_publication_outbox;
  if v_after <> v_before then
    raise exception 'Matching a published baseline movement enqueued remote work';
  end if;
  if not exists (
    select 1 from finance.bank_zero_movements
    where id = v_movement.id and finwise_transaction_id = v_movement.finwise_transaction_id
  ) then raise exception 'Historical FinWise identity changed'; end if;
  if not exists (
    select 1 from finance.bank_zero_evidence_links link
    join finance.bank_zero_observations observation on observation.id = link.observation_id
    where link.movement_id = v_movement.id
      and observation.evidence_key = 'statement:regression'
      and link.relation = 'confirms'
  ) then raise exception 'Statement did not confirm the existing movement: %', v_result; end if;
end;
$test$;
rollback;
