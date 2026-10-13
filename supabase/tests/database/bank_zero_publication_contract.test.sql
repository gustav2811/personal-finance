begin;
select plan(8);

insert into finance.households (id) values ('00000000-0000-4000-8000-00000000c001');
insert into finance.household_members (id, household_id, auth_user_id, email, role)
values ('00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c002', 'publication@test.invalid', 'member');
insert into public.accounts (account_id, source_account_id, name, household_id, source_system, currency_code)
values ('00000000-0000-4000-8000-00000000c003', 'publication-account', 'Publication test', '00000000-0000-4000-8000-00000000c001', 'finwise', 'ZAR');
insert into finance.bank_zero_routes (household_id, route_key, member_id, forwarding_address)
values ('00000000-0000-4000-8000-00000000c001', 'publication', '00000000-0000-4000-8000-00000000c002', 'publication@test.invalid');
insert into finance.bank_zero_account_aliases (household_id, route_key, account_id, alias_normalized, alias_display, status)
values ('00000000-0000-4000-8000-00000000c001', 'publication', '00000000-0000-4000-8000-00000000c003', 'transactional', 'Transactional', 'active');
insert into finance.bank_zero_movements (
  id, household_id, route_key, member_id, account_id, movement_type, amount,
  currency_code, display_description, publication_state
) values (
  '00000000-0000-4000-8000-00000000c004', '00000000-0000-4000-8000-00000000c001', 'publication',
  '00000000-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c003',
  'payment', -25, 'ZAR', 'Test payment', 'pending'
);
insert into finance.bank_zero_publication_outbox (
  id, household_id, movement_id, desired_revision, operation_id, operation, state, exact_request
) values (
  '00000000-0000-4000-8000-00000000c005', '00000000-0000-4000-8000-00000000c001',
  '00000000-0000-4000-8000-00000000c004', 1, '00000000-0000-4000-8000-00000000c006',
  'create', 'pending', jsonb_build_object('id', 'planned-id', 'accountId', '00000000-0000-4000-8000-00000000c003')
);

set local role service_role;
select coalesce(jsonb_agg(claim), '[]'::jsonb) as blocked_claims
from public.bank_zero_claim_publication_v1('publication-test', 10) as rows(claim) \gset
reset role;
select is(jsonb_array_length(:'blocked_claims'::jsonb), 0, 'create claims are blocked until the account history baseline is complete');

select public.bank_zero_complete_account_baseline_v1(
  '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c003',
  0, 0, 0, repeat('a', 64)
);
set local role service_role;
select coalesce(jsonb_agg(claim), '[]'::jsonb) as create_claims
from public.bank_zero_claim_publication_v1('publication-test', 10) as rows(claim) \gset
reset role;
select is(jsonb_array_length(:'create_claims'::jsonb), 1, 'baseline completion releases the create for publication');
select public.bank_zero_record_finwise_create_v1(
  '00000000-0000-4000-8000-00000000c006', 'finwise-publication-id',
  jsonb_build_object('id', 'finwise-publication-id', 'accountId', '00000000-0000-4000-8000-00000000c003', 'amount', '-25.00', 'currencyCode', 'ZAR')
);
select is((select operation || '/' || state from finance.bank_zero_publication_outbox where id = '00000000-0000-4000-8000-00000000c005'), 'project/pending', 'recording remote create queues projection instead of completing it inline');

set local role service_role;
select coalesce(jsonb_agg(claim), '[]'::jsonb) as project_claims
from public.bank_zero_claim_publication_v1('publication-test', 10) as rows(claim) \gset
reset role;
select is(:'project_claims'::jsonb->0->>'operation', 'project', 'a later worker claims projection as its own operation');
select public.bank_zero_finish_projection_v1('00000000-0000-4000-8000-00000000c006', true, null, 0);
select is((select state from finance.bank_zero_publication_outbox where id = '00000000-0000-4000-8000-00000000c005'), 'published', 'projection completion accepts the claimed in-progress state');

insert into finance.bank_zero_publication_outbox (
  household_id, movement_id, desired_revision, operation_id, operation, state,
  exact_request, finwise_transaction_id, lease_owner, lease_expires_at
) values (
  '00000000-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c004', 2,
  '00000000-0000-4000-8000-00000000c007', 'update', 'in_progress', '{}'::jsonb,
  'finwise-publication-id', 'interrupted-worker', now() - interval '1 minute'
);
set local role service_role;
select coalesce(jsonb_agg(claim), '[]'::jsonb) as recovered_updates
from public.bank_zero_claim_publication_v1('recovery-worker', 10) as rows(claim) \gset
reset role;
select ok(:'recovered_updates'::jsonb @> '[{"operation":"update","operation_id":"00000000-0000-4000-8000-00000000c007"}]'::jsonb, 'expired update leases return to the claim queue');
select public.bank_zero_finish_publication_v1('00000000-0000-4000-8000-00000000c007', 'needs_review', 'Household edit conflict', 0);
select is((select state from finance.bank_zero_publication_outbox where operation_id = '00000000-0000-4000-8000-00000000c007'), 'needs_review', 'needs-review failure is persisted on the outbox');
select is((select publication_state || '/' || reconciliation_state from finance.bank_zero_movements where id = '00000000-0000-4000-8000-00000000c004'), 'deferred/needs_review', 'needs-review is mapped to schema-valid publication state and review reconciliation state');

select * from finish();
rollback;
