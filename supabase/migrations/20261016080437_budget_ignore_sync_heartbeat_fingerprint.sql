-- Ignore sync observation heartbeat when deciding whether an allocated source changed.
CREATE OR REPLACE FUNCTION finance.budget_source_snapshot(p_household_id uuid, p_transaction_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
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
  return body || jsonb_build_object('source_fingerprint', finance.budget_hash(body - 'source_last_seen_at'));
end
$function$
;
