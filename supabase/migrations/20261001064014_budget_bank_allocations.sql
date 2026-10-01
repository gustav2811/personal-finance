-- PR2 E: normalized bank facts and the immutable reviewed allocation journal.
create or replace function finance.budget_source_snapshot(
  p_household_id uuid,
  p_transaction_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  t public.transactions%rowtype;
  a public.accounts%rowtype;
  s finance.budget_account_settings%rowtype;
  c finance.transaction_classifications%rowtype;
  tr finance.transaction_treatments%rowtype;
  e record;
  o uuid;
  cents numeric;
  amount text;
  reasons jsonb := '[]'::jsonb;
  body jsonb;
begin
  select * into t from public.transactions
  where id = p_transaction_id and household_id = p_household_id;
  if not found then perform finance.budget_fail('budget_forbidden', 'source transaction'); end if;

  select * into a from public.accounts
  where account_id = t.account_id and household_id = p_household_id;
  if not found then perform finance.budget_fail('budget_forbidden', 'source account'); end if;

  select * into s from finance.budget_account_settings
  where household_id = p_household_id and account_id = t.account_id;
  if not found then reasons := reasons || jsonb_build_array('settings_missing'); end if;
  if a.currency_code is distinct from 'ZAR' then reasons := reasons || jsonb_build_array('account_currency_invalid'); end if;
  if t.currency_code is distinct from 'ZAR' then reasons := reasons || jsonb_build_array('currency_invalid'); end if;

  if t.amount is null or t.amount::text in ('NaN', 'Infinity', '-Infinity')
     or t.amount * 100 <> trunc(t.amount * 100) then
    reasons := reasons || jsonb_build_array('amount_invalid');
    cents := null;
  else
    cents := t.amount * 100;
    if s.transaction_sign_convention = 'outflow_positive' then cents := -cents; end if;
    if cents < -9223372036854775808::numeric or cents > 9223372036854775807::numeric then
      reasons := reasons || jsonb_build_array('amount_invalid');
      cents := null;
    end if;
  end if;

  if t.occurred_on is null then reasons := reasons || jsonb_build_array('occurred_on_missing'); end if;
  if s.transaction_sign_convention is null or s.transaction_sign_convention = 'unknown'
     or nullif(btrim(s.sign_evidence), '') is null then
    reasons := reasons || jsonb_build_array('sign_evidence_missing');
  end if;
  if a.currency_code is distinct from 'ZAR' or t.currency_code is distinct from 'ZAR'
     or s.transaction_sign_convention is null or s.transaction_sign_convention = 'unknown'
     or nullif(btrim(s.sign_evidence), '') is null then
    cents := null;
  end if;

  select * into c from finance.transaction_classifications
  where household_id = p_household_id and transaction_id = t.id and status = 'confirmed';
  select * into tr from finance.transaction_treatments
  where household_id = p_household_id and transaction_id = t.id and status = 'confirmed';
  select o2.id into o from finance.transaction_source_observations o2
  where o2.household_id = p_household_id and o2.transaction_id = t.id
    and o2.raw_payload_hash is not distinct from t.raw_payload_hash
  order by o2.observed_at desc, o2.id desc limit 1;
  select ev.id as event_id, ev.event_type, ev.status as event_status,
         l.id as leg_id, l.leg_role, l.status as leg_status
  into e
  from finance.financial_event_legs l
  join finance.financial_events ev on ev.id = l.event_id and ev.household_id = p_household_id
  where l.household_id = p_household_id and l.transaction_id = t.id
    and l.status = 'active' and ev.status = 'confirmed'
  limit 1;

  if (tr.event_id is not null and tr.event_id is distinct from e.event_id)
     or (tr.leg_role is not null and tr.leg_role is distinct from e.leg_role) then
    reasons := reasons || jsonb_build_array('event_decision_mismatch');
  end if;

  amount := case when cents is null then null else cents::bigint::text end;
  body := jsonb_build_object(
    'transaction_id', t.id, 'account_id', a.account_id::text, 'household_id', p_household_id::text,
    'amount_cents', amount, 'occurred_on', t.occurred_on::text, 'original_amount', t.amount::text,
    'source_system', t.source_system, 'currency_code', t.currency_code, 'account_currency_code', a.currency_code,
    'sign_convention', s.transaction_sign_convention,
    'settings_fingerprint', finance.budget_settings_fingerprint(p_household_id, a.account_id),
    'owner_scope', s.owner_scope, 'owner_member_id', s.owner_member_id::text,
    'source_updated_at', t.source_updated_at, 'source_first_seen_at', t.source_first_seen_at,
    'source_last_seen_at', t.source_last_seen_at, 'effective_at', t.effective_at, 'posted_at', t.posted_at,
    'date', t.date, 'raw_payload_hash', t.raw_payload_hash, 'source_observation_id', o::text,
    'pending', t.source_is_pending, 'archived', t.source_is_archived,
    'classification_id', c.id::text, 'treatment_id', tr.id::text,
    'classification', jsonb_build_object('id', c.id::text, 'category_id', c.category_id::text,
      'status', c.status, 'decision_source', c.decision_source),
    'treatment', jsonb_build_object('id', tr.id::text, 'is_transfer', tr.is_transfer,
      'exclude_from_spend', tr.exclude_from_spend, 'nature', tr.nature, 'event_id', tr.event_id::text,
      'leg_role', tr.leg_role, 'status', tr.status),
    'event', jsonb_build_object('id', e.event_id::text, 'type', e.event_type, 'status', e.event_status,
      'leg_id', e.leg_id::text, 'leg_role', e.leg_role, 'leg_status', e.leg_status),
    'complete', jsonb_array_length(reasons) = 0, 'reasons', reasons
  );
  return body || jsonb_build_object('source_fingerprint', finance.budget_hash(body));
end
$$;

create or replace function finance.budget_allocation_payload(p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  c jsonb;
  d jsonb;
  e jsonb;
  effect text;
  scope text;
  amount bigint;
  fund uuid;
  beneficiary uuid;
  transaction_id text;
  utility_entry_id uuid;
  has_negative boolean := false;
  has_positive boolean := false;
  out_components jsonb := '[]'::jsonb;
begin
  perform finance.budget_validate_object(
    p_input,
    array['components'],
    array['transaction_id', 'utility_entry_id', 'expected_source_fingerprint', 'expected_current_set_id', 'evidence', 'decision_update', 'classification_id', 'treatment_id']
  );
  transaction_id := finance.budget_text(p_input, 'transaction_id', true);
  utility_entry_id := finance.budget_uuid(p_input, 'utility_entry_id', true);
  if transaction_id is not null and utility_entry_id is not null then
    perform finance.budget_fail('budget_invalid', 'exactly one source');
  end if;
  if utility_entry_id is not null then
    perform finance.budget_fail('budget_incomplete', 'utility allocations are unavailable until PR4');
  end if;
  if transaction_id is null then
    perform finance.budget_fail('budget_invalid', 'exactly one source');
  end if;
  perform finance.budget_text(p_input, 'expected_source_fingerprint');
  if jsonb_typeof(p_input->'components') <> 'array' or jsonb_array_length(p_input->'components') = 0 then
    perform finance.budget_fail('budget_invalid', 'components');
  end if;

  e := coalesce(nullif(p_input->'evidence', 'null'::jsonb), '{}'::jsonb);
  perform finance.budget_validate_object(e, array[]::text[], array['receipt_reference', 'split_review_reason', 'review_reason']);
  perform finance.budget_text(e, 'receipt_reference', true);
  perform finance.budget_text(e, 'split_review_reason', true);
  perform finance.budget_text(e, 'review_reason', true);

  for c in select value from jsonb_array_elements(p_input->'components') loop
    perform finance.budget_validate_object(
      c,
      array['amount_cents', 'beneficiary_scope', 'effect_kind'],
      array['fund_id', 'category_id', 'category_name_snapshot', 'beneficiary_member_id',
        'paid_by_member_id', 'payment_account_id', 'original_refund_allocation_id',
        'opening_refund_reason', 'financial_event_id']
    );
    amount := finance.budget_cents(c, 'amount_cents');
    has_negative := has_negative or amount < 0;
    has_positive := has_positive or amount > 0;
    scope := finance.budget_text(c, 'beneficiary_scope');
    effect := finance.budget_text(c, 'effect_kind');
    fund := finance.budget_uuid(c, 'fund_id', true);
    beneficiary := finance.budget_uuid(c, 'beneficiary_member_id', true);

    if effect not in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment',
      'refund', 'income', 'financing', 'movement', 'unresolved') then
      perform finance.budget_fail('budget_invalid', 'effect kind');
    end if;
    if scope not in ('shared', 'member') then perform finance.budget_fail('budget_invalid', 'beneficiary scope'); end if;
    if (scope = 'member' and beneficiary is null) or (scope = 'shared' and beneficiary is not null) then
      perform finance.budget_fail('budget_invalid', 'beneficiary');
    end if;
    if effect in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment') and (amount >= 0 or fund is null) then
      perform finance.budget_fail('budget_invalid', 'outflow');
    end if;
    if effect = 'refund' and (amount <= 0 or fund is null) then perform finance.budget_fail('budget_invalid', 'refund'); end if;
    if effect in ('income', 'financing', 'movement', 'unresolved') and fund is not null then
      perform finance.budget_fail('budget_invalid', 'fund');
    end if;

    perform finance.budget_uuid(c, 'category_id', true);
    perform finance.budget_text(c, 'category_name_snapshot', true);
    perform finance.budget_uuid(c, 'paid_by_member_id', true);
    perform finance.budget_uuid(c, 'payment_account_id', true);
    perform finance.budget_uuid(c, 'original_refund_allocation_id', true);
    perform finance.budget_text(c, 'opening_refund_reason', true);
    perform finance.budget_uuid(c, 'financial_event_id', true);
    if effect = 'refund'
       and finance.budget_uuid(c, 'original_refund_allocation_id', true) is null
       and finance.budget_text(c, 'opening_refund_reason', true) is null then
      perform finance.budget_fail('budget_invalid', 'refund reason');
    end if;

    out_components := out_components || jsonb_build_array(jsonb_build_object(
      'amount_cents', amount::text, 'beneficiary_scope', scope, 'effect_kind', effect,
      'fund_id', fund::text, 'category_id', finance.budget_uuid(c, 'category_id', true)::text,
      'category_name_snapshot', finance.budget_text(c, 'category_name_snapshot', true),
      'beneficiary_member_id', beneficiary::text,
      'paid_by_member_id', finance.budget_uuid(c, 'paid_by_member_id', true)::text,
      'payment_account_id', finance.budget_uuid(c, 'payment_account_id', true)::text,
      'original_refund_allocation_id', finance.budget_uuid(c, 'original_refund_allocation_id', true)::text,
      'opening_refund_reason', finance.budget_text(c, 'opening_refund_reason', true),
      'financial_event_id', finance.budget_uuid(c, 'financial_event_id', true)::text
    ));
  end loop;

  if has_negative and has_positive and finance.budget_text(e, 'receipt_reference', true) is null then
    perform finance.budget_fail('budget_invalid', 'mixed split receipt');
  end if;

  d := coalesce(p_input->'decision_update', 'null'::jsonb);
  if d <> 'null'::jsonb then
    perform finance.budget_validate_object(d, array['category_id', 'is_transfer', 'exclude_from_spend'], array['nature']);
    perform finance.budget_uuid(d, 'category_id');
    perform finance.budget_boolean(d, 'is_transfer');
    perform finance.budget_boolean(d, 'exclude_from_spend');
    perform finance.budget_text(d, 'nature', true);
    if d ? 'nature' and d->'nature' <> 'null'::jsonb and length(finance.budget_text(d, 'nature', true)) > 80 then
      perform finance.budget_fail('budget_invalid', 'nature');
    end if;
    if p_input->'classification_id' <> 'null'::jsonb or p_input->'treatment_id' <> 'null'::jsonb then
      perform finance.budget_fail('budget_invalid', 'decision references');
    end if;
    d := jsonb_build_object(
      'category_id', finance.budget_uuid(d, 'category_id')::text,
      'is_transfer', finance.budget_boolean(d, 'is_transfer'),
      'exclude_from_spend', finance.budget_boolean(d, 'exclude_from_spend'),
      'nature', finance.budget_text(d, 'nature', true)
    );
  end if;

  return jsonb_build_object(
    'transaction_id', transaction_id,
    'utility_entry_id', utility_entry_id::text,
    'expected_source_fingerprint', finance.budget_text(p_input, 'expected_source_fingerprint'),
    'expected_current_set_id', finance.budget_uuid(p_input, 'expected_current_set_id', true)::text,
    'classification_id', finance.budget_uuid(p_input, 'classification_id', true)::text,
    'treatment_id', finance.budget_uuid(p_input, 'treatment_id', true)::text,
    'components', out_components,
    'evidence', jsonb_build_object('receipt_reference', finance.budget_text(e, 'receipt_reference', true),
      'split_review_reason', finance.budget_text(e, 'split_review_reason', true),
      'review_reason', finance.budget_text(e, 'review_reason', true)),
    'decision_update', d
  );
end
$$;

create or replace function public.budget_review_allocation_v1(p_command_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_temp
set timezone = 'UTC'
as $$
declare
  h uuid;
  actor uuid;
  p_input jsonb;
  payload jsonb;
  replay jsonb;
  tx text;
  expected text;
  snap jsonb;
  setrow finance.budget_allocation_sets%rowtype;
  component jsonb;
  evidence jsonb;
  sum_cents numeric := 0;
  v_amount bigint;
  ord integer := 0;
  ids jsonb := '[]'::jsonb;
  new_set uuid;
  new_id uuid;
  decision jsonb;
  result jsonb;
  prior uuid;
  rev bigint;
  payer uuid;
  account uuid;
  category uuid;
  fund uuid;
  effect text;
  expected_set uuid;
begin
  p_input := finance.budget_allocation_payload(p_payload);
  tx := finance.budget_text(p_input, 'transaction_id');
  expected := finance.budget_text(p_input, 'expected_source_fingerprint');
  expected_set := finance.budget_uuid(p_input, 'expected_current_set_id', true);
  evidence := p_input->'evidence';
  payload := jsonb_build_object(
    'transaction_id', tx, 'expected_source_fingerprint', expected,
    'utility_entry_id', p_input->'utility_entry_id',
    'expected_current_set_id', p_input->'expected_current_set_id', 'components', p_input->'components',
    'evidence', evidence, 'decision_update', p_input->'decision_update',
    'classification_id', p_input->'classification_id', 'treatment_id', p_input->'treatment_id'
  );
  replay := finance.budget_begin_command(p_command_id, 'budget_review_allocation_v1', payload);
  if replay is not null then return replay; end if;

  h := finance.resolve_caller_household();
  actor := finance.budget_actor_member(h);
  select account_id into account from public.transactions where id = tx and household_id = h;
  if account is null then perform finance.budget_fail('budget_forbidden', 'source transaction'); end if;
  perform 1 from public.accounts where account_id = account and household_id = h for update;
  if not found then perform finance.budget_fail('budget_forbidden', 'source account'); end if;
  perform 1 from public.transactions where id = tx and household_id = h and account_id = account for update;
  if not found then perform finance.budget_fail('budget_stale', 'source account'); end if;

  snap := finance.budget_source_snapshot(h, tx);
  if snap->>'source_fingerprint' <> expected then perform finance.budget_fail('budget_stale', 'source fingerprint'); end if;
  if not coalesce((snap->>'complete')::boolean, false) or snap->>'pending' is distinct from 'false'
     or snap->>'archived' is distinct from 'false' then
    perform finance.budget_fail('budget_incomplete', 'source');
  end if;
  if payload->'decision_update' = 'null'::jsonb and (
    (payload->'classification_id' <> 'null'::jsonb and (payload->'classification_id')::text is distinct from coalesce(to_jsonb((snap->>'classification_id')::uuid), 'null'::jsonb)::text)
    or (payload->'treatment_id' <> 'null'::jsonb and (payload->'treatment_id')::text is distinct from coalesce(to_jsonb((snap->>'treatment_id')::uuid), 'null'::jsonb)::text)
  ) then
    perform finance.budget_fail('budget_stale', 'decision');
  end if;

  if payload->'decision_update' <> 'null'::jsonb then
    if exists (
      select 1 from finance.financial_event_legs l
      join finance.financial_events ev on ev.id = l.event_id and ev.household_id = h
      where l.household_id = h and l.transaction_id = tx and l.status = 'active'
    ) then
      perform finance.budget_fail('budget_incomplete', 'event review');
    end if;
    decision := payload->'decision_update';
    select public.finance_set_transaction_category_v1(
      tx, finance.budget_uuid(decision, 'category_id'), (snap->>'classification_id')::uuid,
      (select id from finance.transaction_classifications where transaction_id = tx and status = 'proposed' limit 1),
      p_command_id::text || ':budget:category'
    ) into result;
    if coalesce((result->>'conflict')::boolean, false) then perform finance.budget_fail('budget_stale', 'decision'); end if;
    select public.finance_set_transaction_treatment_v1(
      tx, finance.budget_boolean(decision, 'is_transfer'), finance.budget_boolean(decision, 'exclude_from_spend'),
      finance.budget_text(decision, 'nature', true), (snap->>'treatment_id')::uuid,
      (select id from finance.transaction_treatments where transaction_id = tx and status = 'proposed' limit 1),
      p_command_id::text || ':budget:treatment'
    ) into result;
    if coalesce((result->>'conflict')::boolean, false) then perform finance.budget_fail('budget_stale', 'decision'); end if;
    snap := finance.budget_source_snapshot(h, tx);
  end if;

  select * into setrow from finance.budget_allocation_sets
  where household_id = h and transaction_id = tx and status in ('current', 'needs_review')
  for update;
  if expected_set is distinct from setrow.id then perform finance.budget_fail('budget_stale', 'current allocation'); end if;
  set constraints all deferred;
  prior := setrow.id;
  rev := coalesce(setrow.revision_number, 0) + 1;
  if rev > 9007199254740991 then perform finance.budget_fail('budget_invalid', 'revision'); end if;
  if prior is not null then update finance.budget_allocation_sets set status = 'superseded' where id = prior; end if;
  insert into finance.budget_allocation_sets(
    household_id, transaction_id, source_snapshot, source_fingerprint, source_amount_cents, occurred_on,
    revision_number, supersedes_id, actor_id, command_id, classification_id, treatment_id, evidence
  ) values (
    h, tx, snap, snap->>'source_fingerprint', (snap->>'amount_cents')::bigint, (snap->>'occurred_on')::date,
    rev, prior, actor, p_command_id, (snap->>'classification_id')::uuid, (snap->>'treatment_id')::uuid, evidence
  ) returning id into new_set;

  for component in select value from jsonb_array_elements(p_input->'components') loop
    v_amount := finance.budget_cents(component, 'amount_cents');
    sum_cents := sum_cents + v_amount;
    effect := finance.budget_text(component, 'effect_kind');
    fund := finance.budget_uuid(component, 'fund_id', true);
    category := finance.budget_uuid(component, 'category_id', true);
    if category is not null
       and not exists (select 1 from finance.categories where id = category and household_id = h) then
      perform finance.budget_fail('budget_forbidden', 'category');
    end if;
    if fund is not null and not exists (select 1 from finance.funds where id = fund and household_id = h) then
      perform finance.budget_fail('budget_forbidden', 'fund');
    end if;
    if fund is not null and exists (select 1 from finance.fund_earmarks where household_id = h and fund_id = fund) then
      perform finance.budget_fail('budget_incomplete', 'earmarked fund');
    end if;
    if effect in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment')
       and exists (select 1 from finance.funds where id = fund and household_id = h and status = 'retired')
       and not exists (
         select 1 from finance.budget_allocations a
         where a.household_id = h and a.set_id = prior and a.fund_id = fund
       ) then
      perform finance.budget_fail('budget_incomplete', 'retired fund');
    end if;
    if finance.budget_uuid(component, 'beneficiary_member_id', true) is not null and not exists (
      select 1 from finance.household_members where household_id = h and id = finance.budget_uuid(component, 'beneficiary_member_id', true)
    ) then
      perform finance.budget_fail('budget_forbidden', 'beneficiary member');
    end if;
    payer := finance.budget_uuid(component, 'paid_by_member_id', true);
    if snap->>'owner_scope' = 'member' then
      payer := coalesce(payer, (snap->>'owner_member_id')::uuid);
      if payer is distinct from (snap->>'owner_member_id')::uuid then perform finance.budget_fail('budget_invalid', 'payer'); end if;
    end if;
    if payer is not null and not exists (select 1 from finance.household_members where household_id = h and id = payer) then
      perform finance.budget_fail('budget_forbidden', 'payer');
    end if;
    if finance.budget_uuid(component, 'payment_account_id', true) is not null
       and finance.budget_uuid(component, 'payment_account_id', true) <> account then
      perform finance.budget_fail('budget_invalid', 'payment account');
    end if;
    if effect in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment', 'refund')
       and ((snap->>'classification_id') is null or (snap->>'treatment_id') is null) then
      perform finance.budget_fail('budget_incomplete', 'confirmed decisions');
    end if;
    if effect in ('income', 'financing', 'movement') and (snap->>'treatment_id') is null then
      perform finance.budget_fail('budget_incomplete', 'confirmed treatment');
    end if;
    if (snap->'treatment'->>'is_transfer') = 'true' or (snap->'treatment'->>'exclude_from_spend') = 'true'
       or coalesce(snap->'event'->>'type', '') in ('internal_movement', 'settlement', 'internal_conversion')
       or coalesce(snap->'event'->>'leg_role', '') in ('mirror', 'staging', 'settlement', 'reserve_funding', 'internal_conversion') then
      if fund is not null or effect not in ('movement', 'income', 'financing', 'unresolved') then
        perform finance.budget_fail('budget_incomplete', 'non-economic source');
      end if;
    end if;
    if effect = 'refund' and finance.budget_uuid(component, 'original_refund_allocation_id', true) is not null
       and not exists (
         select 1 from finance.budget_allocations a
         where a.id = finance.budget_uuid(component, 'original_refund_allocation_id', true)
           and a.household_id = h and a.fund_id = fund and a.amount_cents < 0
           and a.effect_kind in ('consumption', 'contribution', 'required_debt_payment', 'extra_debt_payment')
       ) then
      perform finance.budget_fail('budget_invalid', 'refund original');
    end if;
    if finance.budget_uuid(component, 'financial_event_id', true) is not null
       and finance.budget_uuid(component, 'financial_event_id', true) is distinct from nullif(snap->'event'->>'id', '')::uuid then
      perform finance.budget_fail('budget_invalid', 'financial event');
    end if;
    if category is null then
      category := (snap->'classification'->>'category_id')::uuid;
    elsif category is distinct from (snap->'classification'->>'category_id')::uuid
       and finance.budget_text(evidence, 'split_review_reason', true) is null then
      perform finance.budget_fail('budget_invalid', 'category split');
    end if;
    if category is not null and not exists (select 1 from finance.categories where id = category and household_id = h) then
      perform finance.budget_fail('budget_forbidden', 'category');
    end if;
    insert into finance.budget_allocations(
      household_id, set_id, ordinal, amount_cents, fund_id, category_id, category_name_snapshot,
      beneficiary_scope, beneficiary_member_id, paid_by_member_id, payment_account_id, effect_kind,
      original_refund_allocation_id, opening_refund_reason, financial_event_id
    ) values (
      h, new_set, ord, v_amount, fund, category,
      coalesce(finance.budget_text(component, 'category_name_snapshot', true), (select name from finance.categories where id = category)),
      finance.budget_text(component, 'beneficiary_scope'), finance.budget_uuid(component, 'beneficiary_member_id', true),
      payer, account, effect, finance.budget_uuid(component, 'original_refund_allocation_id', true),
      finance.budget_text(component, 'opening_refund_reason', true), finance.budget_uuid(component, 'financial_event_id', true)
    ) returning id into new_id;
    ids := ids || to_jsonb(new_id::text);
    ord := ord + 1;
  end loop;

  if sum_cents <> (snap->>'amount_cents')::numeric then perform finance.budget_fail('budget_invalid', 'component sum'); end if;
  result := jsonb_build_object('set_id', new_set::text, 'revision_number', rev,
    'allocation_ids', ids, 'source_fingerprint', snap->>'source_fingerprint');
  perform finance.budget_finish_command(p_command_id, 'budget_review_allocation_v1', payload, result);
  set constraints all immediate;
  return result;
end
$$;

revoke all on function finance.budget_source_snapshot(uuid, text) from public, anon, authenticated, service_role;
revoke all on function finance.budget_allocation_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.budget_review_allocation_v1(uuid, jsonb) from public, anon, service_role;
grant execute on function public.budget_review_allocation_v1(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
