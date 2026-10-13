begin;
select plan(3);

insert into finance.households (id)
values ('00000000-0000-4000-8000-00000000b601');
insert into finance.household_members (id, household_id, auth_user_id, email, role)
values ('00000000-0000-4000-8000-00000000b611', '00000000-0000-4000-8000-00000000b601', '00000000-0000-4000-8000-00000000b611', 'source-sync@test.invalid', 'member');
insert into public.accounts (account_id, source_account_id, name, household_id, source_system, currency_code)
values ('00000000-0000-4000-8000-00000000b621', 'source-sync-account', 'Test account', '00000000-0000-4000-8000-00000000b601', 'finwise', 'ZAR');

select public.finance_start_sync_run('00000000-0000-4000-8000-00000000b601', 'finwise') as first_run \gset
select is(public.finance_upsert_source_transaction(
  '00000000-0000-4000-8000-00000000b601', :'first_run',
  jsonb_build_object(
    'id', 'bank-zero-test-transaction',
    'accountId', '00000000-0000-4000-8000-00000000b621',
    'date', '2026-10-12T08:00:00Z', 'occurredOn', '2026-10-12',
    'amount', '-25.00', 'currencyCode', 'ZAR',
    'description', 'Importer description', 'notes', 'Importer notes',
    'rawPayloadHash', repeat('a', 64), 'archived', false
  )
), 'bank-zero-test-transaction', 'first source sync inserts the FinWise identity');

update public.transactions
set description = 'Household description', notes = 'Household notes'
where id = 'bank-zero-test-transaction';

select public.finance_start_sync_run('00000000-0000-4000-8000-00000000b601', 'finwise') as second_run \gset
select is(public.finance_upsert_source_transaction(
  '00000000-0000-4000-8000-00000000b601', :'second_run',
  jsonb_build_object(
    'id', 'bank-zero-test-transaction',
    'accountId', '00000000-0000-4000-8000-00000000b621',
    'date', '2026-10-12T08:00:00Z', 'occurredOn', '2026-10-12',
    'amount', '-25.00', 'currencyCode', 'ZAR',
    'description', 'New importer description', 'notes', 'New importer notes',
    'rawPayloadHash', repeat('b', 64), 'archived', false
  )
), 'bank-zero-test-transaction', 'later source sync updates the same remote identity');

select is(
  (select jsonb_build_object('description', description, 'notes', notes)
   from public.transactions where id = 'bank-zero-test-transaction'),
  '{"description":"Household description","notes":"Household notes"}'::jsonb,
  'source sync preserves household description and notes while updating tracked source values'
);

select * from finish();
rollback;
