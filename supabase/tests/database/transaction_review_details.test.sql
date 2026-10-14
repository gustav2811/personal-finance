begin;
select plan(18);

insert into finance.households (id)
values
  ('00000000-0000-4000-8000-00000000d601'),
  ('00000000-0000-4000-8000-00000000d602');
insert into finance.household_members (id, household_id, auth_user_id, email, role)
values
  ('00000000-0000-4000-8000-00000000d611', '00000000-0000-4000-8000-00000000d601', '00000000-0000-4000-8000-00000000d611', 'details-a@test.invalid', 'member'),
  ('00000000-0000-4000-8000-00000000d612', '00000000-0000-4000-8000-00000000d602', '00000000-0000-4000-8000-00000000d612', 'details-b@test.invalid', 'member');
insert into public.accounts (account_id, source_account_id, name, household_id, source_system, currency_code)
values
  ('00000000-0000-4000-8000-00000000d621', 'details-account-a', 'Details A', '00000000-0000-4000-8000-00000000d601', 'finwise', 'ZAR'),
  ('00000000-0000-4000-8000-00000000d622', 'details-account-b', 'Details B', '00000000-0000-4000-8000-00000000d602', 'finwise', 'ZAR');
insert into finance.categories (id, household_id, name, slug)
values ('00000000-0000-4000-8000-00000000d631', '00000000-0000-4000-8000-00000000d601', 'Gifts', 'gifts');
insert into public.transactions (
  id, account_id, date, occurred_on, details, household_id, source_system,
  source_category_name_snapshot, source_is_archived, amount, currency_code,
  description, notes, source_managed_description, source_managed_notes
) values
  ('details-unreviewed', '00000000-0000-4000-8000-00000000d621', '2026-10-13T08:00:00Z', '2026-10-13', '{}', '00000000-0000-4000-8000-00000000d601', 'finwise', 'Groceries', false, -199, 'ZAR', 'Imported', 'Import notes', 'Imported', 'Import notes'),
  ('details-atomic', '00000000-0000-4000-8000-00000000d621', '2026-10-13T07:00:00Z', '2026-10-13', '{}', '00000000-0000-4000-8000-00000000d601', 'finwise', 'Groceries', false, -149, 'ZAR', 'Atomic imported', 'Atomic notes', 'Atomic imported', 'Atomic notes'),
  ('details-reviewed', '00000000-0000-4000-8000-00000000d621', '2026-10-12T08:00:00Z', '2026-10-12', '{}', '00000000-0000-4000-8000-00000000d601', 'finwise', 'Groceries', false, -50, 'ZAR', 'Reviewed', null, 'Reviewed', null),
  ('details-foreign', '00000000-0000-4000-8000-00000000d622', '2026-10-11T08:00:00Z', '2026-10-11', '{}', '00000000-0000-4000-8000-00000000d602', 'finwise', 'Groceries', false, -25, 'ZAR', 'Foreign', null, 'Foreign', null);
insert into finance.transaction_classifications (
  household_id, transaction_id, category_id, decision_source, status, actor_id, confirmed_at
) values (
  '00000000-0000-4000-8000-00000000d601', 'details-reviewed', '00000000-0000-4000-8000-00000000d631', 'user', 'confirmed', '00000000-0000-4000-8000-00000000d611', now()
);
insert into public.transactions (
  id, account_id, date, occurred_on, details, household_id, source_system,
  source_category_name_snapshot, source_is_archived, amount, currency_code,
  description, source_managed_description
)
select
  'page-confirmed-' || i,
  '00000000-0000-4000-8000-00000000d621',
  '2026-10-14T08:00:00Z'::timestamptz + (i * interval '1 minute'),
  '2026-10-14', '{}', '00000000-0000-4000-8000-00000000d601', 'finwise',
  'Groceries', false, -i, 'ZAR', 'Page confirmed ' || i, 'Page confirmed ' || i
from generate_series(1, 60) as series(i);
insert into finance.transaction_classifications (
  household_id, transaction_id, category_id, decision_source, status, actor_id, confirmed_at
)
select
  '00000000-0000-4000-8000-00000000d601',
  'page-confirmed-' || i,
  '00000000-0000-4000-8000-00000000d631', 'user', 'confirmed',
  '00000000-0000-4000-8000-00000000d611', now()
from generate_series(1, 60) as series(i);

select set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-00000000d611', 'role', 'authenticated', 'email', 'details-a@test.invalid', 'email_verified', true)::text, true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d611', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
  public.finance_update_transaction_details_v1('details-unreviewed', 'Household description', null, 'Imported', 'Import notes')->>'conflict',
  'false',
  'household can update description and clear notes'
);
select is(
  (select jsonb_build_object('description', description, 'notes', notes, 'sourceDescription', source_managed_description, 'sourceNotes', source_managed_notes) from public.transactions where id = 'details-unreviewed'),
  '{"description":"Household description","notes":null,"sourceDescription":"Imported","sourceNotes":"Import notes"}'::jsonb,
  'details edit preserves source managed baselines'
);
select is(
  (public.finance_update_transaction_details_v1('details-unreviewed', 'Lost update', 'new notes', 'Imported', 'Import notes')->>'conflict'),
  'true',
  'stale expected details return a conflict'
);
select is(
  (public.finance_update_transaction_details_v1('details-unreviewed', 'Household description', null, 'Household description', null)->>'idempotent'),
  'true',
  'repeating the same details edit is idempotent'
);
select is(
  (public.finance_update_transaction_details_v1('details-unreviewed', 'Household description', null, 'Household description', null)->'item'->>'notes'),
  null,
  'feed item exposes cleared notes as null'
);
select is(
  (public.finance_update_transaction_details_v1('details-unreviewed', 'Household description', null, 'Household description', null)->'item'->>'description'),
  'Household description',
  'feed item exposes the edited description'
);
select is(
  (public.finance_review_transaction_v1(
    'details-atomic', '00000000-0000-4000-8000-00000000d631', 'Saved description', 'Saved notes', false, false, null,
    '{"description":"Atomic imported","notes":"Atomic notes","confirmedClassificationId":null,"proposedClassificationId":null,"confirmedTreatmentId":null,"proposedTreatmentId":null}'::jsonb,
    'review-atomic-1'
  )->>'conflict'),
  'false',
  'review save updates details, category, and treatment together'
);
select is(
  (select jsonb_build_object('description', description, 'notes', notes) from public.transactions where id = 'details-atomic'),
  '{"description":"Saved description","notes":"Saved notes"}'::jsonb,
  'review save commits both editable details'
);
select is(
  (public.finance_review_transaction_v1(
    'details-atomic', '00000000-0000-4000-8000-00000000d631', 'Saved description', 'Saved notes', false, false, null,
    '{"description":"Atomic imported","notes":"Atomic notes","confirmedClassificationId":null,"proposedClassificationId":null,"confirmedTreatmentId":null,"proposedTreatmentId":null}'::jsonb,
    'review-atomic-1'
  )->>'idempotent'),
  'true',
  'review save retry is idempotent after a response loss'
);
select is(
  (public.finance_review_transaction_v1(
    'details-atomic', '00000000-0000-4000-8000-00000000d631', 'Should not save', 'Should not save', false, false, null,
    '{"description":"Atomic imported","notes":"Atomic notes","confirmedClassificationId":null,"proposedClassificationId":null,"confirmedTreatmentId":null,"proposedTreatmentId":null}'::jsonb,
    'review-atomic-2'
  )->>'conflict'),
  'true',
  'stale category or treatment metadata conflicts without changing details'
);
select is(
  (select description || '|' || notes from public.transactions where id = 'details-atomic'),
  'Saved description|Saved notes',
  'stale review save rolls back the attempted detail change'
);

select is(
  (public.finance_list_transactions_v1(null, 50, '{"reviewState":"not_reviewed"}'::jsonb)->'items' @> '[{"id":"details-unreviewed"}]'::jsonb),
  true,
  'not_reviewed includes a transaction without a confirmed decision'
);
select is(
  (public.finance_list_transactions_v1(null, 50, '{"reviewState":"not_reviewed"}'::jsonb)->'items' @> '[{"id":"details-reviewed"}]'::jsonb),
  false,
  'not_reviewed excludes a transaction with a confirmed decision'
);
select is(
  (public.finance_list_transactions_v1(null, 50, '{"reviewState":"not_reviewed"}'::jsonb)->'items' @> '[{"id":"details-unreviewed"}]'::jsonb),
  true,
  'not_reviewed applies confirmed absence before the page limit'
);
select is(
  (public.finance_list_transactions_v1(null, 50, jsonb_build_object('reviewState', 'not_reviewed', 'accountId', '00000000-0000-4000-8000-00000000d621', 'search', 'Household'))->'items' @> '[{"id":"details-unreviewed"}]'::jsonb),
  true,
  'not_reviewed preserves account and search filters'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-00000000d611', 'role', 'authenticated', 'email', 'details-a@test.invalid', 'email_verified', true)::text, true);
select throws_ok(
  $$select public.finance_update_transaction_details_v1('details-foreign', 'Nope', null, 'Foreign', null)$$,
  'P0001',
  'transaction not found',
  'cross-household details edit is rejected'
);

set local role anon;
select throws_ok(
  $$select public.finance_update_transaction_details_v1('details-unreviewed', 'Nope', null, 'Household description', null)$$,
  '42501',
  null,
  'anonymous details edit is rejected by execute privileges'
);

set local role authenticated;
select throws_ok(
  $$select public.finance_update_transaction_details_v1('details-unreviewed', '   ', null, 'Household description', null)$$,
  'P0001',
  'description is required',
  'blank descriptions are rejected'
);

select * from finish();
rollback;
