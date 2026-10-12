begin;

select plan(49);

insert into finance.households (id) values
  ('00000000-0000-4000-8000-00000000b201'),
  ('00000000-0000-4000-8000-00000000b202');
insert into finance.household_members (id, household_id, auth_user_id, email, role) values
  ('00000000-0000-4000-8000-00000000b211', '00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000b211', 'bz-a@test.invalid', 'member'),
  ('00000000-0000-4000-8000-00000000b212', '00000000-0000-4000-8000-00000000b202', '00000000-0000-4000-8000-00000000b212', 'bz-b@test.invalid', 'member');
insert into public.accounts (account_id, source_account_id, name, household_id, source_system, currency_code) values
  ('00000000-0000-4000-8000-00000000b221', 'bz-account-a', 'Transactional A', '00000000-0000-4000-8000-00000000b201', 'finwise', 'ZAR'),
  ('00000000-0000-4000-8000-00000000b222', 'bz-account-b', 'Transactional B', '00000000-0000-4000-8000-00000000b202', 'finwise', 'ZAR');
insert into finance.bank_zero_routes (household_id, route_key, member_id, forwarding_address) values
  ('00000000-0000-4000-8000-00000000b201', 'profile-a', '00000000-0000-4000-8000-00000000b211', 'profile-a@test.invalid'),
  ('00000000-0000-4000-8000-00000000b202', 'profile-b', '00000000-0000-4000-8000-00000000b212', 'profile-b@test.invalid');
update finance.bank_zero_routes set status = 'active'
where household_id = '00000000-0000-4000-8000-00000000b201' and route_key = 'profile-a';
insert into finance.bank_zero_route_capabilities (household_id, route_key, message_class, enabled)
values
  ('00000000-0000-4000-8000-00000000b201', 'profile-a', 'paid', true),
  ('00000000-0000-4000-8000-00000000b201', 'profile-a', 'card_purchase', true),
  ('00000000-0000-4000-8000-00000000b201', 'profile-a', 'payment_returned', true);
insert into finance.bank_zero_account_aliases (household_id, route_key, account_id, alias_normalized, alias_display, account_number, status) values
  ('00000000-0000-4000-8000-00000000b201', 'profile-a', '00000000-0000-4000-8000-00000000b221', 'transactional', 'Transactional', '80200000001', 'active'),
  ('00000000-0000-4000-8000-00000000b202', 'profile-b', '00000000-0000-4000-8000-00000000b222', 'transactional', 'Transactional', '80200000002', 'active'),
  ('00000000-0000-4000-8000-00000000b202', 'profile-b', '00000000-0000-4000-8000-00000000b222', 'wedding gifts savings', 'Wedding Gifts Savings', null, 'active'),
  ('00000000-0000-4000-8000-00000000b202', 'profile-b', '00000000-0000-4000-8000-00000000b222', 'gifts', 'Gifts', null, 'active');
insert into finance.bank_zero_received_emails (
  id, household_id, route_key, original_message_id, dedupe_key,
  raw_r2_key, raw_sha256, received_at
) values
  ('00000000-0000-4000-8000-00000000b231', '00000000-0000-4000-8000-00000000b201', 'profile-a', '<a@test.invalid>', 'msgid:<a@test.invalid>', 'ingest/a/email.raw', repeat('a', 64), now()),
  ('00000000-0000-4000-8000-00000000b232', '00000000-0000-4000-8000-00000000b202', 'profile-b', '<b@test.invalid>', 'msgid:<b@test.invalid>', 'ingest/b/email.raw', repeat('b', 64), now());
insert into finance.bank_zero_observations (
  id, household_id, received_email_id, evidence_key, observation_kind, parser_version
) values
  ('00000000-0000-4000-8000-00000000b241', '00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000b231', 'email', 'alert', 'test-v1'),
  ('00000000-0000-4000-8000-00000000b242', '00000000-0000-4000-8000-00000000b202', '00000000-0000-4000-8000-00000000b232', 'email', 'alert', 'test-v1');
insert into finance.bank_zero_movements (
  id, household_id, route_key, member_id, account_id, movement_type, amount, currency_code
) values
  ('00000000-0000-4000-8000-00000000b251', '00000000-0000-4000-8000-00000000b201', 'profile-a', '00000000-0000-4000-8000-00000000b211', '00000000-0000-4000-8000-00000000b221', 'payment', -1.00, 'ZAR'),
  ('00000000-0000-4000-8000-00000000b252', '00000000-0000-4000-8000-00000000b202', 'profile-b', '00000000-0000-4000-8000-00000000b212', '00000000-0000-4000-8000-00000000b222', 'payment', -1.00, 'ZAR');

select is(
  (select count(*)::integer from finance.bank_zero_account_aliases where alias_normalized = 'transactional'),
  2,
  'Transactional resolves independently within each person route'
);
select is(
  (select count(*)::integer from finance.bank_zero_account_aliases where route_key = 'profile-b' and alias_normalized in ('wedding gifts savings', 'gifts')),
  2,
  'overlapping-looking aliases remain exact, separate account identities'
);
select throws_ok(
  $$insert into finance.bank_zero_received_emails (household_id,route_key,original_message_id,dedupe_key,raw_r2_key,raw_sha256,received_at) values ('00000000-0000-4000-8000-00000000b201','profile-a','<a@test.invalid>','msgid:<a@test.invalid>','ingest/dup/email.raw',repeat('c',64),now())$$,
  '23505', null, 'same route and original message identity cannot create another email record'
);
select throws_ok(
  $$insert into finance.bank_zero_movements (household_id,route_key,member_id,account_id,movement_type,amount,currency_code) values ('00000000-0000-4000-8000-00000000b201','profile-b','00000000-0000-4000-8000-00000000b212','00000000-0000-4000-8000-00000000b222','payment',-1,'ZAR')$$,
  '23503', null, 'movement account and member cannot cross the configured household'
);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b211","role":"authenticated","email":"bz-a@test.invalid","email_verified":true,"app_metadata":{"provider":"google"}}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b211', true);
set local role authenticated;
select is((select count(*)::integer from finance.bank_zero_received_emails), 1, 'member reads only their household received email');
select is((select count(*)::integer from finance.bank_zero_observations), 1, 'member reads only their household observations');
select is((select count(*)::integer from finance.bank_zero_movements), 1, 'member reads only their household movements');
select throws_ok(
  $$insert into finance.bank_zero_movements (household_id,route_key,member_id,account_id,movement_type,amount,currency_code) values ('00000000-0000-4000-8000-00000000b201','profile-a','00000000-0000-4000-8000-00000000b211','00000000-0000-4000-8000-00000000b221','payment',-2,'ZAR')$$,
  '42501', null, 'member cannot write importer movement records directly'
);
select throws_ok(
  $$select count(*) from finance.bank_zero_routes$$,
  '42501', null, 'member cannot inspect private route configuration'
);
reset role;
select is((select count(*)::integer from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b202'), 1, 'service role can operate across households');

select public.bank_zero_record_observation_v1(
  'profile-a', 'delivery-1', '<paid-1@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b271/email.raw', repeat('a', 64), now(),
  jsonb_build_object('envelope', jsonb_build_object('to', 'not-used-for-routing')),
  jsonb_build_object(
    'evidenceKey', 'message', 'messageClass', 'paid', 'outcome', 'movement_candidate',
    'parserVersion', 'bank-zero-email-v1',
    'rawValues', jsonb_build_object('subject', 'Paid R25.00'),
    'parsedValues', jsonb_build_object(
      'amountMinor', 2500, 'direction', 'debit', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'currency', 'ZAR', 'eventAt', '2026-10-12T08:00:00+02:00',
      'counterparty', 'Test Merchant', 'reference', 'ref-1'
    ),
    'fieldProvenance', jsonb_build_object('amountMinor', 'body')
  )
) as first_result \gset
select is(:'first_result'::jsonb->>'status', 'observed', 'active routed alert is durably observed');
select is((:'first_result'::jsonb->>'account_id')::uuid, '00000000-0000-4000-8000-00000000b221'::uuid, 'exact alias and trusted profile select the matching account');
select is((select count(*)::integer from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b201' and amount = -25), 1, 'first enabled alert creates one internal movement identity');
select is((select count(*)::integer from finance.bank_zero_publication_outbox where household_id = '00000000-0000-4000-8000-00000000b201' and operation = 'create' and state = 'pending'), 1, 'movement and recoverable create intent commit together');

select public.bank_zero_record_observation_v1(
  'profile-a', 'statement-delivery', '<statement@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b275/email.raw', repeat('d', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'statement:' || repeat('e',64) || ':Transactions:2',
    'messageClass', 'statement', 'outcome', 'movement_candidate',
    'parserVersion', 'bank-zero-statement-v2',
    'parsedValues', jsonb_build_object(
      'messageClass', 'statement', 'outcome', 'movement_candidate', 'movementType', 'payment',
      'direction', 'debit', 'amountMinor', 2500, 'currency', 'ZAR', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'counterparty', 'Test Merchant', 'reference', 'ref-1',
      'postedOn', '2026-10-12', 'eventAt', '2026-10-12T08:00:00+02:00', 'eventPrecision', 'minute',
      'statementContentSha256', repeat('e',64), 'statementSheet', 'Transactions', 'statementRow', 2
    )
  )
) as statement_result \gset
select is(:'statement_result'::jsonb->>'status', 'observed', 'statement evidence is recorded');
select is((select count(*)::integer from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b201' and amount = -25), 1, 'statement row confirms the live alert without creating another movement');
select is((select reconciliation_state from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b201' and amount = -25), 'statement_confirmed', 'unique statement match confirms reconciliation');

select public.bank_zero_record_observation_v1(
  'profile-a', 'proof-delivery', '<proof@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b276/email.raw', repeat('f', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'message', 'messageClass', 'proof_of_payment', 'outcome', 'evidence',
    'parserVersion', 'bank-zero-email-v1',
    'parsedValues', jsonb_build_object(
      'messageClass', 'proof_of_payment', 'outcome', 'evidence', 'direction', 'debit',
      'amountMinor', 2500, 'currency', 'ZAR', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'counterparty', 'Test Merchant', 'reference', 'ref-1',
      'eventAt', '2026-10-12T08:00:00+02:00'
    )
  )
) as proof_result \gset
select is(:'proof_result'::jsonb->>'status', 'observed', 'matching proof remains a non-transaction evidence class');
select is((select count(*)::integer from finance.bank_zero_evidence_links where observation_id = (:'proof_result'::jsonb->>'observation_id')::uuid and relation = 'supports'), 1, 'proof enriches the unique matching movement');

select public.bank_zero_record_observation_v1(
  'profile-a', 'statement-duplicate-row', '<statement-duplicate@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b279/email.raw', repeat('3', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'statement:' || repeat('e',64) || ':Transactions:3',
    'messageClass', 'statement', 'outcome', 'movement_candidate', 'parserVersion', 'bank-zero-statement-v2',
    'parsedValues', jsonb_build_object(
      'messageClass', 'statement', 'outcome', 'movement_candidate', 'movementType', 'payment',
      'direction', 'debit', 'amountMinor', 2500, 'currency', 'ZAR', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'counterparty', 'Test Merchant', 'reference', 'ref-1',
      'postedOn', '2026-10-12', 'eventAt', '2026-10-12T08:00:00+02:00', 'eventPrecision', 'minute',
      'statementContentSha256', repeat('e',64), 'statementSheet', 'Transactions', 'statementRow', 3
    )
  )
);
select is((select count(*)::integer from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b201' and amount = -25), 2, 'identical statement occurrences on different rows remain separate movements');

select public.bank_zero_record_observation_v1(
  'profile-a', 'statement-resend', '<statement-resend@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b280/email.raw', repeat('4', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'statement:' || repeat('e',64) || ':Transactions:2',
    'messageClass', 'statement', 'outcome', 'movement_candidate', 'parserVersion', 'bank-zero-statement-v2',
    'parsedValues', jsonb_build_object(
      'messageClass', 'statement', 'outcome', 'movement_candidate', 'movementType', 'payment',
      'direction', 'debit', 'amountMinor', 2500, 'currency', 'ZAR', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'counterparty', 'Test Merchant', 'reference', 'ref-1',
      'postedOn', '2026-10-12', 'eventAt', '2026-10-12T08:00:00+02:00', 'eventPrecision', 'minute',
      'statementContentSha256', repeat('e',64), 'statementSheet', 'Transactions', 'statementRow', 2
    )
  )
);
select is((select count(*)::integer from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b201' and amount = -25), 2, 'resent document row reconciles to the same movement identity');

select public.bank_zero_record_observation_v1(
  'profile-a', 'status-delivery', '<status@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b277/email.raw', repeat('1', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'message', 'messageClass', 'banking_status', 'outcome', 'balance_snapshot',
    'parserVersion', 'bank-zero-email-v1',
    'parsedValues', jsonb_build_object(
      'messageClass', 'banking_status', 'outcome', 'balance_snapshot', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'currency', 'ZAR', 'balanceMinor', 123456,
      'eventAt', '2026-10-12T06:00:00+02:00'
    )
  )
) as balance_result \gset
select is(:'balance_result'::jsonb->>'status', 'observed', 'exact account balance snapshot is observed');
select is((select amount from finance.bank_zero_balance_snapshots where source_observation_id = (:'balance_result'::jsonb->>'observation_id')::uuid), 1234.56::numeric, 'balance snapshot is stored separately from transaction movements');

select public.bank_zero_record_observation_v1(
  'profile-a', 'delivery-2', 'paid-1@test.invalid',
  'ingest/00000000-0000-4000-8000-00000000b272/email.raw', repeat('a', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'message', 'messageClass', 'paid', 'outcome', 'movement_candidate',
    'parserVersion', 'bank-zero-email-v1',
    'parsedValues', jsonb_build_object('amountMinor', 2500, 'direction', 'debit', 'accountAlias', 'Transactional', 'accountNumber', '80200000001', 'currency', 'ZAR', 'eventAt', '2026-10-12T08:00:00+02:00')
  )
) as replay_result \gset
select is(:'replay_result'::jsonb->>'received_email_id', :'first_result'::jsonb->>'received_email_id', 'redelivery reuses the received email identity');
select is(:'replay_result'::jsonb->>'observation_id', :'first_result'::jsonb->>'observation_id', 'redelivery reuses the evidence observation');
select is((select count(*)::integer from finance.bank_zero_delivery_attempts where received_email_id = (:'first_result'::jsonb->>'received_email_id')::uuid), 2, 'separate transport attempts remain recorded');

select public.bank_zero_record_observation_v1(
  'profile-a', 'delivery-3', 'paid-1@test.invalid',
  'ingest/00000000-0000-4000-8000-00000000b273/email.raw', repeat('b', 64), now(), '{}'::jsonb,
  jsonb_build_object('evidenceKey', 'message', 'messageClass', 'paid', 'outcome', 'movement_candidate', 'parserVersion', 'bank-zero-email-v1', 'parsedValues', jsonb_build_object('amountMinor', 2500, 'accountAlias', 'Transactional', 'accountNumber', '80200000001'))
) as conflict_result \gset
select is(:'conflict_result'::jsonb->>'status', 'needs_review', 'same original message identity with changed content is held for review');
select is((select processing_outcome from finance.bank_zero_received_emails where id = (:'first_result'::jsonb->>'received_email_id')::uuid), 'needs_review', 'content conflict remains visible on the received email');
select is((select count(*)::integer from finance.bank_zero_observations where received_email_id = (:'first_result'::jsonb->>'received_email_id')::uuid), 2, 'conflicting delivery is retained as separate evidence');

select public.bank_zero_record_observation_v1(
  'profile-b', 'delivery-4', 'pending@test.invalid',
  'ingest/00000000-0000-4000-8000-00000000b274/email.raw', repeat('c', 64), now(), '{}'::jsonb,
  jsonb_build_object('evidenceKey', 'message', 'messageClass', 'paid', 'outcome', 'movement_candidate', 'parserVersion', 'bank-zero-email-v1', 'parsedValues', jsonb_build_object('amountMinor', 2500, 'accountAlias', 'Transactional', 'accountNumber', '80200000002'))
) as pending_result \gset
select is(:'pending_result'::jsonb->>'status', 'deferred', 'pending receiving route defers publication work');
select is((:'pending_result'::jsonb->>'account_id')::uuid, '00000000-0000-4000-8000-00000000b222'::uuid, 'deferred route still records its profile-scoped exact account resolution');

select public.bank_zero_record_observation_v1(
  'profile-a', 'card-alert', '<card-alert@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b280/email.raw', repeat('5', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'message', 'messageClass', 'card_purchase', 'outcome', 'movement_candidate',
    'parserVersion', 'bank-zero-email-v1',
    'parsedValues', jsonb_build_object(
      'amountMinor', 5000, 'direction', 'debit', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'currency', 'ZAR', 'eventAt', '2026-10-10T08:00:00+02:00',
      'counterparty', 'Test Cafe'
    )
  )
) as card_alert_result \gset
select is(:'card_alert_result'::jsonb->>'status', 'observed', 'enabled card alert creates a provisional bank movement');
select public.bank_zero_record_observation_v1(
  'profile-a', 'card-statement', '<card-statement@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b281/email.raw', repeat('6', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'statement:' || repeat('7',64) || ':Transactions:2',
    'messageClass', 'statement', 'outcome', 'movement_candidate', 'parserVersion', 'bank-zero-statement-v2',
    'parsedValues', jsonb_build_object(
      'messageClass', 'statement', 'outcome', 'movement_candidate', 'movementType', 'card_purchase',
      'direction', 'debit', 'amountMinor', 5500, 'currency', 'ZAR', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'counterparty', 'Test Cafe', 'postedOn', '2026-10-11',
      'statementContentSha256', repeat('7',64), 'statementSheet', 'Transactions', 'statementRow', 2
    )
  )
) as changed_card_settlement_result \gset
select is(:'changed_card_settlement_result'::jsonb->>'status', 'needs_review', 'amount-changing card settlement is held for review');
select is((select count(*)::integer from finance.bank_zero_movements where household_id = '00000000-0000-4000-8000-00000000b201' and movement_type = 'card_purchase' and counterparty = 'Test Cafe'), 1, 'amount-changing card settlement does not create a duplicate purchase');
select is((select state from finance.bank_zero_publication_outbox where movement_id = (select id from finance.bank_zero_movements where counterparty = 'Test Cafe') and operation = 'create'), 'needs_review', 'unpublished card purchase pauses before a changed settlement can be published');
select public.bank_zero_record_observation_v1(
  'profile-a', 'refund-statement', '<refund-statement@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b282/email.raw', repeat('8', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'statement:' || repeat('9',64) || ':Transactions:3',
    'messageClass', 'statement', 'outcome', 'movement_candidate', 'parserVersion', 'bank-zero-statement-v2',
    'parsedValues', jsonb_build_object(
      'messageClass', 'statement', 'outcome', 'movement_candidate', 'movementType', 'card_refund',
      'direction', 'credit', 'amountMinor', 5000, 'currency', 'ZAR', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'counterparty', 'Test Cafe', 'postedOn', '2026-10-12',
      'statementContentSha256', repeat('9',64), 'statementSheet', 'Transactions', 'statementRow', 3
    )
  )
) as refund_statement_result \gset
select is((select refund_of_movement_id from finance.bank_zero_movements where movement_type = 'card_refund' and counterparty = 'Test Cafe'), (select id from finance.bank_zero_movements where movement_type = 'card_purchase' and counterparty = 'Test Cafe'), 'uniquely supported refund links back to its purchase');
select is((select relation from finance.bank_zero_evidence_links where observation_id = (:'refund_statement_result'::jsonb->>'observation_id')::uuid and movement_id = (select id from finance.bank_zero_movements where movement_type = 'card_purchase' and counterparty = 'Test Cafe')), 'refund_of', 'refund evidence records its original-purchase relationship');
select is((select count(*)::integer from finance.bank_zero_movements where movement_type = 'card_refund' and counterparty = 'Test Cafe'), 1, 'statement refund remains its own credit movement');
select public.bank_zero_record_observation_v1(
  'profile-a', 'return-alert', '<return-alert@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b283/email.raw', repeat('a', 64), now(), '{}'::jsonb,
  jsonb_build_object(
    'evidenceKey', 'message', 'messageClass', 'payment_returned', 'outcome', 'movement_candidate',
    'parserVersion', 'bank-zero-email-v1',
    'parsedValues', jsonb_build_object(
      'amountMinor', 2500, 'direction', 'credit', 'accountAlias', 'Transactional',
      'accountNumber', '80200000001', 'currency', 'ZAR', 'eventAt', '2026-10-12T09:00:00+02:00',
      'counterparty', 'Test Merchant', 'reference', 'ref-1'
    )
  )
) as return_result \gset
select is(:'return_result'::jsonb->>'status', 'observed', 'supported returned payment is stored as a separate credit');
select is((select refund_of_movement_id from finance.bank_zero_movements where movement_type = 'return' and payment_reference = 'ref-1'), (select id from finance.bank_zero_movements where movement_type = 'payment' and payment_reference = 'ref-1'), 'returned payment links to its original debit');
select is((select relation from finance.bank_zero_evidence_links where observation_id = (:'return_result'::jsonb->>'observation_id')::uuid and movement_id = (select id from finance.bank_zero_movements where movement_type = 'payment' and payment_reference = 'ref-1')), 'return_of', 'return evidence records its original-payment relationship');
select is((select count(*)::integer from finance.bank_zero_movements where movement_type = 'return' and payment_reference = 'ref-1'), 1, 'returned payment does not overwrite the original movement');

select public.bank_zero_record_observation_v1(
  'profile-a', 'unknown-delivery', '<unknown@test.invalid>',
  'ingest/00000000-0000-4000-8000-00000000b278/email.raw', repeat('2', 64), now(), '{}'::jsonb,
  jsonb_build_object('evidenceKey', 'message', 'messageClass', 'unknown', 'outcome', 'review', 'parserVersion', 'bank-zero-email-v1', 'reason', 'Unknown template')
) as unknown_result \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000b211","role":"authenticated","email":"bz-a@test.invalid","email_verified":true,"app_metadata":{"provider":"google"}}', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000b211', true);
set local role authenticated;
select ok(not (public.bank_zero_list_review_v1(50)->'items' @> '[{"route_key":"profile-b"}]'::jsonb), 'review queue excludes another household');
select ok(exists (
  select 1 from jsonb_array_elements(public.bank_zero_list_review_v1(50)->'items') item
  where item->>'observation_id' = (:'changed_card_settlement_result'::jsonb->>'observation_id')
    and item->'candidate_movements' @> jsonb_build_array(jsonb_build_object('movement_id', (select id::text from finance.bank_zero_movements where movement_type = 'card_purchase' and counterparty = 'Test Cafe')))
), 'review queue shows the plausible purchase candidate for a changed card settlement');
select public.bank_zero_review_observation_v1((:'conflict_result'::jsonb->>'observation_id')::uuid, 'associate', '00000000-0000-4000-8000-00000000b251'::uuid);
select is((select status from finance.bank_zero_observations where id = (:'conflict_result'::jsonb->>'observation_id')::uuid), 'matched', 'member association action updates the evidence state');
select public.bank_zero_review_observation_v1((:'unknown_result'::jsonb->>'observation_id')::uuid, 'dismiss', null);
select is((select status from finance.bank_zero_observations where id = (:'unknown_result'::jsonb->>'observation_id')::uuid), 'ignored', 'member dismissal action records the decision');
reset role;

insert into finance.bank_zero_received_emails (
  id, household_id, route_key, dedupe_key, raw_r2_key, raw_sha256,
  receipt_metadata, received_at, processing_outcome
) values
  ('00000000-0000-4000-8000-00000000b233', '00000000-0000-4000-8000-00000000b201', 'profile-a', 'old-closed', 'ingest/00000000-0000-4000-8000-00000000b233/email.raw', repeat('3',64), jsonb_build_object('attachmentPointers', jsonb_build_array(jsonb_build_object('r2Key','ingest/00000000-0000-4000-8000-00000000b233/files/0'))), now() - interval '181 days', 'processed'),
  ('00000000-0000-4000-8000-00000000b234', '00000000-0000-4000-8000-00000000b201', 'profile-a', 'old-open', 'ingest/00000000-0000-4000-8000-00000000b234/email.raw', repeat('4',64), '{}'::jsonb, now() - interval '181 days', 'needs_review');
insert into finance.bank_zero_observations (
  household_id, received_email_id, evidence_key, observation_kind, parser_version, status
) values
  ('00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000b233', 'closed', 'non_transaction', 'test-v1', 'ignored'),
  ('00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000b234', 'open', 'unknown', 'test-v1', 'needs_review');
set local role service_role;
select coalesce(jsonb_agg(claim), '[]'::jsonb) as expiration_claims
from public.bank_zero_claim_source_expiration_v1(100) as claims(claim) \gset
reset role;
select is(jsonb_array_length(:'expiration_claims'::jsonb), 1, 'retention claims only closed email sources older than 180 days');
select is(:'expiration_claims'::jsonb->0->>'received_email_id', '00000000-0000-4000-8000-00000000b233', 'retention claim includes the eligible closed source');
set local role service_role;
select public.bank_zero_finish_source_expiration_v1('00000000-0000-4000-8000-00000000b233', true);
reset role;
select ok((select source_expired_at is not null from finance.bank_zero_received_emails where id = '00000000-0000-4000-8000-00000000b233'), 'source pointer is explicitly marked expired after deletion');

select * from finish();
rollback;
