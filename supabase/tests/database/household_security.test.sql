begin;

select plan(30);

-- The seeded household is a production-shaped migration fixture.  Never carry
-- personal addresses into this test: rename those two rows for this transaction.
do $fixture$
begin
  update finance.household_members
  set email = case lower(email)
    when 'gustav@klingbiel.org' then 'gustav@test.invalid'
    when 'cara@klingbiel.org' then 'cara@test.invalid'
  end
  where household_id = '00000000-0000-4000-8000-000000000001'
    and lower(email) in ('gustav@klingbiel.org', 'cara@klingbiel.org');

  insert into finance.households (id)
  values ('00000000-0000-4000-8000-0000000000b2');

  insert into finance.household_members (household_id, email, auth_user_id, role)
  values (
    '00000000-0000-4000-8000-0000000000b2',
    'outsider@test.invalid',
    '00000000-0000-4000-8000-0000000000b1',
    'member'
  );

  insert into public.accounts (account_id, source_account_id, name, household_id, source_system)
  values
    ('00000000-0000-4000-8000-0000000000c1', 'security-a', 'Security A', '00000000-0000-4000-8000-000000000001', 'test'),
    ('00000000-0000-4000-8000-0000000000c2', 'security-b', 'Security B', '00000000-0000-4000-8000-0000000000b2', 'test');

  insert into public.transactions (id, account_id, date, details, household_id)
  values
    ('security-a', '00000000-0000-4000-8000-0000000000c1', now(), '{}'::jsonb, '00000000-0000-4000-8000-000000000001'),
    ('security-b', '00000000-0000-4000-8000-0000000000c2', now(), '{}'::jsonb, '00000000-0000-4000-8000-0000000000b2');

  insert into public.snapshots (account_id, date, amount_cents, household_id, source_system, observed_at)
  values
    ('00000000-0000-4000-8000-0000000000c1', date '2026-01-01', 100, '00000000-0000-4000-8000-000000000001', 'test', now()),
    ('00000000-0000-4000-8000-0000000000c2', date '2026-01-01', 100, '00000000-0000-4000-8000-0000000000b2', 'test', now());
end
$fixture$;

-- A verified Google identity may bind an unbound member; an unverified claim may not.
do $membership$
declare
  v_household_a constant uuid := '00000000-0000-4000-8000-000000000001';
  v_household_b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  v_gustav constant uuid := '00000000-0000-4000-8000-0000000000a1';
  v_cara constant uuid := '00000000-0000-4000-8000-0000000000a2';
  v_outsider constant uuid := '00000000-0000-4000-8000-0000000000b1';
  v_wrong_uid constant uuid := '00000000-0000-4000-8000-0000000000ff';
  v_membership jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_gustav::text, 'role', 'authenticated', 'email', 'gustav@test.invalid',
    'email_verified', true, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_gustav::text, true);
  select public.finance_caller_membership_v1() into v_membership;
  raise notice '%', is(v_membership ->> 'member', 'true', 'verified Google member is recognised');
  raise notice '%', ok(finance.is_household_member(v_household_a), 'verified Google member resolves household A');
  raise notice '%', ok(not finance.is_household_member(v_household_b), 'verified Google member cannot resolve household B');
  raise notice '%', is(
    (select auth_user_id from finance.household_members where household_id = v_household_a and email = 'gustav@test.invalid'),
    v_gustav,
    'verified Google member binds its own UID'
  );

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_cara::text, 'role', 'authenticated', 'email', 'cara@test.invalid',
    'email_verified', false, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_cara::text, true);
  select public.finance_caller_membership_v1() into v_membership;
  raise notice '%', is(v_membership ->> 'member', 'false', 'unverified Google email is not a member');
  raise notice '%', ok(not finance.is_household_member(v_household_a), 'unverified Google email cannot resolve an unbound row');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_wrong_uid::text, 'role', 'authenticated', 'email', 'gustav@test.invalid',
    'email_verified', true, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_wrong_uid::text, true);
  raise notice '%', ok(not finance.is_household_member(v_household_a), 'wrong UID cannot claim a bound email');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_cara::text, 'role', 'authenticated', 'email', 'cara@test.invalid',
    'email_verified', true, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_cara::text, true);
  select public.finance_caller_membership_v1() into v_membership;
  raise notice '%', is(v_membership ->> 'member', 'true', 'second verified Google member is recognised');
  raise notice '%', ok(finance.is_household_member(v_household_a), 'second verified Google member resolves household A');

  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_outsider::text, 'role', 'authenticated', 'email', 'outsider@test.invalid',
    'email_verified', true, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  raise notice '%', ok(not finance.is_household_member(v_household_a), 'outsider cannot resolve household A');
  raise notice '%', ok(finance.is_household_member(v_household_b), 'outsider resolves only household B');
end
$membership$;

-- These reads and writes use the actual PostgREST roles and JWT GUCs.  Reset
-- before calling pgTAP so assertions themselves retain their test privileges.
do $authenticated_reads$
declare
  v_household_a constant uuid := '00000000-0000-4000-8000-000000000001';
  v_household_b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  v_gustav constant uuid := '00000000-0000-4000-8000-0000000000a1';
  v_accounts_a bigint;
  v_accounts_b bigint;
  v_transactions_a bigint;
  v_transactions_b bigint;
  v_snapshots_a bigint;
  v_snapshots_b bigint;
  v_membership jsonb;
  v_account_write_denied boolean := false;
  v_transaction_write_denied boolean := false;
  v_snapshot_write_denied boolean := false;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_gustav::text, 'role', 'authenticated', 'email', 'gustav@test.invalid',
    'email_verified', true, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_gustav::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select public.finance_caller_membership_v1() into v_membership;
  select count(*) into v_accounts_a from public.accounts where household_id = v_household_a;
  select count(*) into v_accounts_b from public.accounts where household_id = v_household_b;
  select count(*) into v_transactions_a from public.transactions where household_id = v_household_a;
  select count(*) into v_transactions_b from public.transactions where household_id = v_household_b;
  select count(*) into v_snapshots_a from public.snapshots where household_id = v_household_a;
  select count(*) into v_snapshots_b from public.snapshots where household_id = v_household_b;
  begin
    insert into public.accounts (account_id, source_account_id, name, household_id, source_system)
    values ('00000000-0000-4000-8000-0000000000c3', 'security-write', 'Denied', v_household_a, 'test');
  exception when insufficient_privilege then
    v_account_write_denied := true;
  end;
  begin
    insert into public.transactions (id, account_id, date, details, household_id)
    values ('security-write', '00000000-0000-4000-8000-0000000000c1', now(), '{}'::jsonb, v_household_a);
  exception when insufficient_privilege then
    v_transaction_write_denied := true;
  end;
  begin
    insert into public.snapshots (account_id, date, amount_cents, household_id, source_system, observed_at)
    values ('00000000-0000-4000-8000-0000000000c1', date '2026-01-02', 100, v_household_a, 'test', now());
  exception when insufficient_privilege then
    v_snapshot_write_denied := true;
  end;
  execute 'reset role';
  raise notice '%', is(v_membership ->> 'member', 'true', 'authenticated caller receives its membership through the public RPC');
  perform cmp_ok(v_accounts_a, '>=', 1::bigint, 'authenticated member reads its accounts');
  raise notice '%', is(v_accounts_b, 0::bigint, 'authenticated member cannot read another household accounts');
  perform cmp_ok(v_transactions_a, '>=', 1::bigint, 'authenticated member reads its transactions');
  raise notice '%', is(v_transactions_b, 0::bigint, 'authenticated member cannot read another household transactions');
  perform cmp_ok(v_snapshots_a, '>=', 1::bigint, 'authenticated member reads its snapshots');
  raise notice '%', is(v_snapshots_b, 0::bigint, 'authenticated member cannot read another household snapshots');
  raise notice '%', ok(v_account_write_denied, 'authenticated user cannot directly write source accounts');
  raise notice '%', ok(v_transaction_write_denied, 'authenticated user cannot directly write source transactions');
  raise notice '%', ok(v_snapshot_write_denied, 'authenticated user cannot directly write source snapshots');
end
$authenticated_reads$;

do $outsider_reads$
declare
  v_household_a constant uuid := '00000000-0000-4000-8000-000000000001';
  v_household_b constant uuid := '00000000-0000-4000-8000-0000000000b2';
  v_outsider constant uuid := '00000000-0000-4000-8000-0000000000b1';
  v_accounts_a bigint;
  v_accounts_b bigint;
  v_transactions_a bigint;
  v_transactions_b bigint;
  v_snapshots_a bigint;
  v_snapshots_b bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_outsider::text, 'role', 'authenticated', 'email', 'outsider@test.invalid',
    'email_verified', true, 'app_metadata', jsonb_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_accounts_a from public.accounts where household_id = v_household_a;
  select count(*) into v_accounts_b from public.accounts where household_id = v_household_b;
  select count(*) into v_transactions_a from public.transactions where household_id = v_household_a;
  select count(*) into v_transactions_b from public.transactions where household_id = v_household_b;
  select count(*) into v_snapshots_a from public.snapshots where household_id = v_household_a;
  select count(*) into v_snapshots_b from public.snapshots where household_id = v_household_b;
  execute 'reset role';
  raise notice '%', is(v_accounts_a, 0::bigint, 'outsider cannot read household A accounts');
  raise notice '%', is(v_accounts_b, 1::bigint, 'outsider reads household B accounts');
  raise notice '%', is(v_transactions_a, 0::bigint, 'outsider cannot read household A transactions');
  raise notice '%', is(v_transactions_b, 1::bigint, 'outsider reads household B transactions');
  raise notice '%', is(v_snapshots_a, 0::bigint, 'outsider cannot read household A snapshots');
  raise notice '%', is(v_snapshots_b, 1::bigint, 'outsider reads household B snapshots');
end
$outsider_reads$;

do $anonymous_and_service$
declare
  v_anon_rpc_denied boolean := false;
  v_anon_read_denied boolean := false;
  v_service_resolution_denied boolean := false;
begin
  execute 'set local role anon';
  begin
    perform public.finance_caller_membership_v1();
  exception when insufficient_privilege then
    v_anon_rpc_denied := true;
  end;
  begin
    perform 1 from public.accounts limit 1;
  exception when insufficient_privilege then
    v_anon_read_denied := true;
  end;
  execute 'reset role';
  raise notice '%', ok(v_anon_rpc_denied, 'anonymous caller cannot use membership RPC');
  raise notice '%', ok(v_anon_read_denied, 'anonymous caller cannot read source accounts');

  execute 'set local role service_role';
  begin
    perform finance.resolve_caller_household();
  exception when insufficient_privilege then
    v_service_resolution_denied := true;
  end;
  execute 'reset role';
  raise notice '%', ok(v_service_resolution_denied, 'service role cannot resolve a member household');
end
$anonymous_and_service$;

select * from finish();
rollback;
