begin;
select plan(5);

insert into finance.households(id) values ('00000000-0000-4000-8000-00000000e701');
insert into finance.household_members(id, household_id, email, auth_user_id, role) values
  ('00000000-0000-4000-8000-00000000e702', '00000000-0000-4000-8000-00000000e701', 'publish-move@test.invalid', '00000000-0000-4000-8000-00000000e703', 'member');
insert into public.accounts(account_id, source_account_id, name, household_id, source_system, currency_code)
values ('00000000-0000-4000-8000-00000000e704', 'publish-move-cash', 'Cash', '00000000-0000-4000-8000-00000000e701', 'test', 'ZAR');
insert into finance.funds(id, household_id, name, beneficiary_scope, created_by) values
  ('00000000-0000-4000-8000-00000000e705', '00000000-0000-4000-8000-00000000e701', 'Gifts', 'shared', '00000000-0000-4000-8000-00000000e702');
insert into finance.budget_versions(id, household_id, state, starts_on_cycle, actor_id, reason)
values ('00000000-0000-4000-8000-00000000e707', '00000000-0000-4000-8000-00000000e701', 'draft', date '2026-09-23', '00000000-0000-4000-8000-00000000e702', 'publish with movement');
insert into finance.budget_lines(id, household_id, version_id, stable_line_id, fund_id, name, beneficiary_scope, kind, contribution_cents, funding_behaviour, recurrence, rollover_policy)
values ('00000000-0000-4000-8000-00000000e708', '00000000-0000-4000-8000-00000000e701', '00000000-0000-4000-8000-00000000e707', '00000000-0000-4000-8000-00000000e709', '00000000-0000-4000-8000-00000000e705', 'Gifts', 'shared', 'consumption', 0, 'accumulating', 'cycle', 'carry');
insert into finance.budget_account_settings(household_id, account_id, owner_scope, included, resource_class, freshness_hours, transaction_sign_convention, sign_evidence, actor_id)
values ('00000000-0000-4000-8000-00000000e701', '00000000-0000-4000-8000-00000000e704', 'shared', true, 'liquid', 24, 'outflow_negative', 'test', '00000000-0000-4000-8000-00000000e702');
insert into public.snapshots(account_id, date, amount_cents, currency_code, household_id, source_system, observed_at)
values ('00000000-0000-4000-8000-00000000e704', current_date, 200000, 'ZAR', '00000000-0000-4000-8000-00000000e701', 'test', now() - interval '1 hour');

do $seed$
declare
  h uuid := '00000000-0000-4000-8000-00000000e701';
  a uuid := '00000000-0000-4000-8000-00000000e704';
  actor uuid := '00000000-0000-4000-8000-00000000e702';
  fp text;
  sf text;
  coverage jsonb;
  checked jsonb;
begin
  select finance.budget_settings_fingerprint(h, a), finance.budget_snapshot_fingerprint(h, a, current_date) into fp, sf;
  coverage := jsonb_build_object(
    'schema_version', 1,
    'evidence', 'publish move fixture',
    'utility_coverage', jsonb_build_object('status', 'not_required', 'evidence', 'none'),
    'accounts', jsonb_build_array(jsonb_build_object(
      'account_id', a::text,
      'status', 'included',
      'settings_fingerprint', fp,
      'snapshot_date', current_date::text,
      'snapshot_fingerprint', sf,
      'balance_convention', 'cash_signed',
      'activity_through', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'pending_included_ids', '[]'::jsonb,
      'evidence', 'cash'
    ))
  );
  checked := finance.budget_check_coverage(h, coverage, now());
  insert into finance.budget_reconciliations(id, household_id, as_of, actor_id, status, coverage_snapshot, opening_fund_cutover, notes)
  values ('00000000-0000-4000-8000-00000000e710', h, now(), actor, checked->>'status', checked->'coverage_snapshot', date '2026-09-23', 'fixture');
end $seed$;

do $member$
declare
  resources jsonb;
  publish jsonb;
  movement jsonb;
  success jsonb;
  replay jsonb;
  failed boolean := false;
  published_state text;
  movement_count bigint;
  failed_receipts bigint;
begin
  select finance.budget_resources('00000000-0000-4000-8000-00000000e701', now()) into resources;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', '00000000-0000-4000-8000-00000000e703', 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000e703', true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  publish := jsonb_build_object(
    'draft_id', '00000000-0000-4000-8000-00000000e707',
    'expected_draft_revision', 1,
    'expected_latest_version_number', 0,
    'reason', 'publish and move'
  );
  movement := jsonb_build_object(
    'kind', 'opening',
    'to_fund_id', '00000000-0000-4000-8000-00000000e705',
    'amount_cents', '100000',
    'effective_on', '2026-09-23',
    'expected_reconciliation_id', resources->>'reconciliation_id',
    'expected_reconciliation_fingerprint', 'wrong',
    'reason', 'opening'
  );
  begin
    perform public.budget_publish_with_movement_v1(
      '00000000-0000-4000-8000-00000000e711',
      jsonb_build_object(
        'publish_command_id', '00000000-0000-4000-8000-00000000e712',
        'move_command_id', '00000000-0000-4000-8000-00000000e713',
        'publish', publish,
        'movement', movement
      )
    );
  exception when sqlstate 'P0001' then
    failed := true;
  end;
  select state into published_state from finance.budget_versions where id = '00000000-0000-4000-8000-00000000e707';
  select count(*) into movement_count from finance.fund_movements where household_id = '00000000-0000-4000-8000-00000000e701';
  select count(*) into failed_receipts from finance.budget_commands where command_id = '00000000-0000-4000-8000-00000000e711';
  raise notice '%', ok(failed and published_state = 'draft' and movement_count = 0 and failed_receipts = 0, 'a failed movement rolls the publication back and leaves no receipt');
  success := public.budget_publish_with_movement_v1(
    '00000000-0000-4000-8000-00000000e714',
    jsonb_build_object(
      'publish_command_id', '00000000-0000-4000-8000-00000000e715',
      'move_command_id', '00000000-0000-4000-8000-00000000e716',
      'publish', publish,
      'movement', jsonb_set(movement, '{expected_reconciliation_fingerprint}', to_jsonb(resources->>'reconciliation_fingerprint'))
    )
  );
  replay := public.budget_publish_with_movement_v1(
    '00000000-0000-4000-8000-00000000e714',
    jsonb_build_object(
      'publish_command_id', '00000000-0000-4000-8000-00000000e715',
      'move_command_id', '00000000-0000-4000-8000-00000000e716',
      'publish', publish,
      'movement', jsonb_set(movement, '{expected_reconciliation_fingerprint}', to_jsonb(resources->>'reconciliation_fingerprint'))
    )
  );
  select state, version_number into published_state, movement_count from finance.budget_versions where id = '00000000-0000-4000-8000-00000000e707';
  raise notice '%', ok(published_state = 'published' and movement_count = 1, 'combined publication assigns version one');
  select count(*) into movement_count from finance.fund_movements where household_id = '00000000-0000-4000-8000-00000000e701';
  raise notice '%', ok(movement_count = 1 and success->'movement'->>'movement_id' = (select id::text from finance.fund_movements where household_id = '00000000-0000-4000-8000-00000000e701'), 'combined command records one movement');
  raise notice '%', ok(replay = success, 'replaying the combined command returns the original result');
  select count(*) into movement_count from finance.fund_movements where household_id = '00000000-0000-4000-8000-00000000e701';
  raise notice '%', ok(movement_count = 1, 'replay does not record a second movement');
  execute 'reset role';
end $member$;

select * from finish();
rollback;
