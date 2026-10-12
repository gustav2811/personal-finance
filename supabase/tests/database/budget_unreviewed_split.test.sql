begin;
select plan(2);

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000f701');
insert into finance.household_members(id, household_id, email, auth_user_id, role) values
  ('00000000-0000-4000-8000-00000000f711', '00000000-0000-4000-8000-00000000f701', 'unreviewed@test.invalid', '00000000-0000-4000-8000-00000000f721', 'member');
insert into public.accounts(account_id, source_account_id, name, household_id, source_system, currency_code) values
  ('00000000-0000-4000-8000-00000000f731', 'unreviewed-a', 'Unreviewed account', '00000000-0000-4000-8000-00000000f701', 'test', 'ZAR');
insert into finance.budget_account_settings(household_id, account_id, owner_scope, included, resource_class, freshness_hours, transaction_sign_convention, sign_evidence, actor_id) values
  ('00000000-0000-4000-8000-00000000f701', '00000000-0000-4000-8000-00000000f731', 'shared', true, 'liquid', 24, 'outflow_negative', 'statement', '00000000-0000-4000-8000-00000000f711');
insert into finance.categories(id, household_id, name, slug) values
  ('00000000-0000-4000-8000-00000000f741', '00000000-0000-4000-8000-00000000f701', 'Groceries', 'unreviewed-groceries'),
  ('00000000-0000-4000-8000-00000000f742', '00000000-0000-4000-8000-00000000f701', 'Gifts', 'unreviewed-gifts');
insert into finance.funds(id, household_id, name, beneficiary_scope, created_by) values
  ('00000000-0000-4000-8000-00000000f751', '00000000-0000-4000-8000-00000000f701', 'Groceries', 'shared', '00000000-0000-4000-8000-00000000f711'),
  ('00000000-0000-4000-8000-00000000f752', '00000000-0000-4000-8000-00000000f701', 'Gifts', 'shared', '00000000-0000-4000-8000-00000000f711');
insert into public.transactions(id, account_id, date, occurred_on, details, household_id, source_system, source_is_pending, source_is_archived, amount, currency_code, raw_payload_hash) values
  ('unreviewed-split', '00000000-0000-4000-8000-00000000f731', now(), current_date, '{}', '00000000-0000-4000-8000-00000000f701', 'test', false, false, -200, 'ZAR', 'unreviewed-split');

do $$
declare
  fp text;
  denied boolean := false;
  r jsonb;
  components jsonb;
begin
  select finance.budget_source_snapshot('00000000-0000-4000-8000-00000000f701', 'unreviewed-split')->>'source_fingerprint' into fp;
  components := jsonb_build_array(
    jsonb_build_object('amount_cents', '-12000', 'beneficiary_scope', 'shared', 'effect_kind', 'consumption', 'fund_id', '00000000-0000-4000-8000-00000000f751', 'category_id', '00000000-0000-4000-8000-00000000f741'),
    jsonb_build_object('amount_cents', '-8000', 'beneficiary_scope', 'shared', 'effect_kind', 'consumption', 'fund_id', '00000000-0000-4000-8000-00000000f752', 'category_id', '00000000-0000-4000-8000-00000000f742')
  );
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-00000000f721', 'role', 'authenticated', 'email_verified', true)::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000f721', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  begin
    perform public.budget_review_allocation_v1(
      '00000000-0000-4000-8000-00000000f7b1',
      jsonb_build_object(
        'transaction_id', 'unreviewed-split',
        'expected_source_fingerprint', fp,
        'components', components,
        'evidence', jsonb_build_object('split_review_reason', 'mixed till slip', 'receipt_reference', 'mixed till slip')
      )
    );
  exception when sqlstate 'P0001' then
    denied := sqlerrm = 'budget_incomplete: confirmed decisions';
  end;
  execute 'reset role';
  raise notice '%', ok(
    denied
      and not exists (select 1 from finance.transaction_classifications where transaction_id = 'unreviewed-split')
      and not exists (select 1 from finance.transaction_treatments where transaction_id = 'unreviewed-split')
      and not exists (select 1 from finance.budget_allocation_sets where transaction_id = 'unreviewed-split'),
    'a genuinely unreviewed mixed purchase is rejected until classification and treatment are confirmed'
  );

  execute 'set local role authenticated';
  r := public.budget_review_allocation_v1(
    '00000000-0000-4000-8000-00000000f7b2',
    jsonb_build_object(
      'transaction_id', 'unreviewed-split',
      'expected_source_fingerprint', fp,
      'components', components,
      'evidence', jsonb_build_object('split_review_reason', 'mixed till slip', 'receipt_reference', 'mixed till slip'),
      'decision_update', jsonb_build_object('category_id', '00000000-0000-4000-8000-00000000f741', 'is_transfer', false, 'exclude_from_spend', false)
    )
  );
  execute 'reset role';
  raise notice '%', ok(
    r->>'set_id' is not null
      and exists (
        select 1 from finance.transaction_classifications
        where transaction_id = 'unreviewed-split' and status = 'confirmed' and category_id = '00000000-0000-4000-8000-00000000f741'
      )
      and exists (
        select 1 from finance.transaction_treatments
        where transaction_id = 'unreviewed-split' and status = 'confirmed' and is_transfer = false and exclude_from_spend = false
      )
      and (
        select count(*)
        from finance.budget_allocations a
        join finance.budget_allocation_sets s on s.id = a.set_id
        where s.transaction_id = 'unreviewed-split' and s.status = 'current'
      ) = 2,
    'a genuinely unreviewed mixed purchase completes once the source classification and treatment are confirmed'
  );
end $$;

select * from finish();
rollback;
