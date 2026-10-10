begin;

select * from no_plan();

-- Keep this suite independent from the domain-constraint fixture.  The two
-- members are bound auth identities; outsider belongs only to household B.
insert into finance.households (id) values
  ('00000000-0000-4000-8000-00000000aa01'),
  ('00000000-0000-4000-8000-00000000aa02');
insert into finance.household_members (id, household_id, email, auth_user_id, role)
values
  ('00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000aa01', 'budget-security-a@test.invalid', '00000000-0000-4000-8000-00000000ac01', 'member'),
  ('00000000-0000-4000-8000-00000000ab02', '00000000-0000-4000-8000-00000000aa02', 'budget-security-b@test.invalid', '00000000-0000-4000-8000-00000000ac02', 'member');
insert into public.accounts (account_id, source_account_id, name, household_id, source_system)
values
  ('00000000-0000-4000-8000-00000000ad01', 'budget-security-a', 'Budget security A', '00000000-0000-4000-8000-00000000aa01', 'test'),
  ('00000000-0000-4000-8000-00000000ad02', 'budget-security-b', 'Budget security B', '00000000-0000-4000-8000-00000000aa02', 'test');
insert into public.transactions (id, account_id, date, details, household_id, source_system)
values
  ('budget-security-tx-a', '00000000-0000-4000-8000-00000000ad01', now(), '{}'::jsonb, '00000000-0000-4000-8000-00000000aa01', 'test'),
  ('budget-security-tx-b', '00000000-0000-4000-8000-00000000ad02', now(), '{}'::jsonb, '00000000-0000-4000-8000-00000000aa02', 'test');

-- Seed one readable row in each table.  Allocation components precede their
-- completed command receipt; the receipt FK is deferred by the schema.
insert into finance.funds (id, household_id, name, beneficiary_scope, created_by)
values
  ('00000000-0000-4000-8000-00000000ae01', '00000000-0000-4000-8000-00000000aa01', 'Security fund A', 'shared', '00000000-0000-4000-8000-00000000ab01'),
  ('00000000-0000-4000-8000-00000000ae02', '00000000-0000-4000-8000-00000000aa02', 'Security fund B', 'shared', '00000000-0000-4000-8000-00000000ab02');
insert into finance.budget_versions (id, household_id, starts_on_cycle, actor_id, reason)
values
  ('00000000-0000-4000-8000-00000000af01', '00000000-0000-4000-8000-00000000aa01', date '2026-09-23', '00000000-0000-4000-8000-00000000ab01', 'security fixture'),
  ('00000000-0000-4000-8000-00000000af02', '00000000-0000-4000-8000-00000000aa02', date '2026-09-23', '00000000-0000-4000-8000-00000000ab02', 'security fixture');
insert into finance.budget_lines (id, household_id, version_id, stable_line_id, fund_id, name, beneficiary_scope, kind, funding_behaviour, recurrence, rollover_policy)
values
  ('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000af01', '00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000ae01', 'Security line A', 'shared', 'consumption', 'cycle_allowance', 'cycle', 'carry'),
  ('00000000-0000-4000-8000-00000000b002', '00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-00000000af02', '00000000-0000-4000-8000-00000000b102', '00000000-0000-4000-8000-00000000ae02', 'Security line B', 'shared', 'consumption', 'cycle_allowance', 'cycle', 'carry');
insert into finance.budget_account_settings (household_id, account_id, owner_scope, included, resource_class, freshness_hours, transaction_sign_convention, actor_id)
values
  ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000ad01', 'shared', true, 'liquid', 24, 'unknown', '00000000-0000-4000-8000-00000000ab01'),
  ('00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-00000000ad02', 'shared', true, 'liquid', 24, 'unknown', '00000000-0000-4000-8000-00000000ab02');
insert into finance.budget_reconciliations (id, household_id, as_of, actor_id, status, coverage_snapshot, notes)
values
  ('00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000aa01', now(), '00000000-0000-4000-8000-00000000ab01', 'incomplete', '{}'::jsonb, 'security fixture'),
  ('00000000-0000-4000-8000-00000000b202', '00000000-0000-4000-8000-00000000aa02', now(), '00000000-0000-4000-8000-00000000ab02', 'incomplete', '{}'::jsonb, 'security fixture');
insert into finance.fund_movements (id, household_id, to_fund_id, amount_cents, kind, effective_on, actor_id, command_id, reason)
values
  ('00000000-0000-4000-8000-00000000b301', '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000ae01', 1, 'opening', current_date, '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000b401', 'security fixture'),
  ('00000000-0000-4000-8000-00000000b302', '00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-00000000ae02', 1, 'opening', current_date, '00000000-0000-4000-8000-00000000ab02', '00000000-0000-4000-8000-00000000b402', 'security fixture');
insert into finance.budget_allocation_sets (id, household_id, transaction_id, source_snapshot, source_fingerprint, source_amount_cents, occurred_on, revision_number, actor_id, command_id)
values
  ('00000000-0000-4000-8000-00000000b501', '00000000-0000-4000-8000-00000000aa01', 'budget-security-tx-a', '{}'::jsonb, 'security-a', 1, current_date, 1, '00000000-0000-4000-8000-00000000ab01', '00000000-0000-4000-8000-00000000b601'),
  ('00000000-0000-4000-8000-00000000b502', '00000000-0000-4000-8000-00000000aa02', 'budget-security-tx-b', '{}'::jsonb, 'security-b', 1, current_date, 1, '00000000-0000-4000-8000-00000000ab02', '00000000-0000-4000-8000-00000000b602');
insert into finance.budget_allocations (id, household_id, set_id, ordinal, amount_cents, beneficiary_scope, effect_kind)
values
  ('00000000-0000-4000-8000-00000000b701', '00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000b501', 0, 1, 'shared', 'unresolved'),
  ('00000000-0000-4000-8000-00000000b702', '00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-00000000b502', 0, 1, 'shared', 'unresolved');
insert into finance.budget_commands (household_id, command_id, kind, payload, actor_id, result)
values
  ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000b401', 'security-movement', '{}'::jsonb, '00000000-0000-4000-8000-00000000ab01', '{}'::jsonb),
  ('00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-00000000b402', 'security-movement', '{}'::jsonb, '00000000-0000-4000-8000-00000000ab02', '{}'::jsonb),
  ('00000000-0000-4000-8000-00000000aa01', '00000000-0000-4000-8000-00000000b601', 'security-allocation', '{}'::jsonb, '00000000-0000-4000-8000-00000000ab01', '{}'::jsonb),
  ('00000000-0000-4000-8000-00000000aa02', '00000000-0000-4000-8000-00000000b602', 'security-allocation', '{}'::jsonb, '00000000-0000-4000-8000-00000000ab02', '{}'::jsonb);

do $catalog$
declare
  t text;
begin
  foreach t in array array['funds','budget_versions','budget_lines','budget_allocation_sets','budget_allocations','fund_movements','budget_account_settings','budget_reconciliations','fund_earmarks','budget_commands'] loop
    raise notice '%', ok((select relrowsecurity from pg_class where oid=('finance.'||t)::regclass), t||' enables RLS');
    raise notice '%', ok(exists(select 1 from pg_policies where schemaname='finance' and tablename=t and cmd='SELECT' and 'authenticated'=any(roles)), t||' has authenticated member SELECT policy');
    raise notice '%', ok(has_table_privilege('authenticated','finance.'||t,'SELECT'), t||' grants authenticated SELECT');
  end loop;
end
$catalog$;

do $privileges$
declare t text; p text; denied boolean;
begin
  foreach t in array array['funds','budget_versions','budget_lines','budget_allocation_sets','budget_allocations','fund_movements','budget_account_settings','budget_reconciliations','fund_earmarks','budget_commands'] loop
    foreach p in array array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
      raise notice '%', ok(not has_table_privilege('authenticated','finance.'||t,p), t||' denies authenticated '||p);
      raise notice '%', ok(not has_table_privilege('anon','finance.'||t,p), t||' denies anon '||p);
      raise notice '%', ok(not has_table_privilege('service_role','finance.'||t,p), t||' denies service_role '||p);
    end loop;
    raise notice '%', ok(not has_table_privilege('anon','finance.'||t,'SELECT'), t||' denies anon SELECT');
    raise notice '%', ok(not has_table_privilege('service_role','finance.'||t,'SELECT'), t||' denies service_role SELECT');
  end loop;
end
$privileges$;

do $function_privileges$
declare
  f record;
begin
  for f in
    select p.oid, p.proname, p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'finance' and left(p.proname, 7) = 'budget_'
  loop
    -- Effective denial for anon also proves PUBLIC has no inherited EXECUTE.
    raise notice '%', ok(not has_function_privilege('anon', f.oid, 'EXECUTE'), f.proname||' denies PUBLIC/anon EXECUTE');
    raise notice '%', ok(not has_function_privilege('authenticated', f.oid, 'EXECUTE'), f.proname||' denies authenticated EXECUTE');
    raise notice '%', ok(not has_function_privilege('service_role', f.oid, 'EXECUTE'), f.proname||' denies service_role EXECUTE');
    raise notice '%', ok(not exists (
      select 1
      from aclexplode(coalesce((select proacl from pg_proc where oid = f.oid), acldefault('f', f.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ), f.proname||' denies PUBLIC EXECUTE ACL');
  end loop;
end
$function_privileges$;

do $member_reads$
declare t text; own_count bigint; other_count bigint; expected_count bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub','00000000-0000-4000-8000-00000000ac01','role','authenticated','email','budget-security-a@test.invalid','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ac01',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  foreach t in array array['funds','budget_versions','budget_lines','budget_allocation_sets','budget_allocations','fund_movements','budget_account_settings','budget_reconciliations','budget_commands'] loop
    execute format('select count(*) from finance.%I where household_id = $1',t) into own_count using '00000000-0000-4000-8000-00000000aa01'::uuid;
    execute format('select count(*) from finance.%I where household_id = $1',t) into other_count using '00000000-0000-4000-8000-00000000aa02'::uuid;
    expected_count := case when t = 'budget_commands' then 2 else 1 end;
    raise notice '%', is(own_count,expected_count,t||' member reads own household row');
    raise notice '%', is(other_count,0::bigint,t||' member cannot read other household row');
  end loop;
  execute 'reset role';
end
$member_reads$;

do $outsider_reads$
declare t text; own_count bigint; other_count bigint; expected_count bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub','00000000-0000-4000-8000-00000000ac02','role','authenticated','email','budget-security-b@test.invalid','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ac02',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  foreach t in array array['funds','budget_versions','budget_lines','budget_allocation_sets','budget_allocations','fund_movements','budget_account_settings','budget_reconciliations','budget_commands'] loop
    execute format('select count(*) from finance.%I where household_id = $1',t) into own_count using '00000000-0000-4000-8000-00000000aa01'::uuid;
    execute format('select count(*) from finance.%I where household_id = $1',t) into other_count using '00000000-0000-4000-8000-00000000aa02'::uuid;
    raise notice '%', is(own_count,0::bigint,t||' outsider cannot read household A');
    expected_count := case when t = 'budget_commands' then 2 else 1 end;
    raise notice '%', is(other_count,expected_count,t||' outsider reads household B');
  end loop;
  execute 'reset role';
end
$outsider_reads$;

do $writes$
declare t text; operation text; denied boolean;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub','00000000-0000-4000-8000-00000000ac01','role','authenticated','email','budget-security-a@test.invalid','email_verified',true)::text,true);
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-00000000ac01',true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  foreach t in array array['funds','budget_versions','budget_lines','budget_allocation_sets','budget_allocations','fund_movements','budget_account_settings','budget_reconciliations','fund_earmarks','budget_commands'] loop
    begin execute format('insert into finance.%I (household_id) values ($1)',t) using '00000000-0000-4000-8000-00000000aa01'::uuid; denied := false; exception when insufficient_privilege then denied := true; end;
    raise notice '%', ok(denied,t||' authenticated INSERT raises SQLSTATE 42501');
    begin execute format('update finance.%I set household_id = household_id where false',t); denied := false; exception when insufficient_privilege then denied := true; end;
    raise notice '%', ok(denied,t||' authenticated UPDATE raises SQLSTATE 42501');
    begin execute format('delete from finance.%I where false',t); denied := false; exception when insufficient_privilege then denied := true; end;
    raise notice '%', ok(denied,t||' authenticated DELETE raises SQLSTATE 42501');
  end loop;
  execute 'reset role';
end
$writes$;

do $anonymous_service$
declare t text; denied boolean;
begin
  foreach t in array array['funds','budget_versions','budget_lines','budget_allocation_sets','budget_allocations','fund_movements','budget_account_settings','budget_reconciliations','fund_earmarks','budget_commands'] loop
    execute 'set local role anon';
    begin execute format('select 1 from finance.%I limit 1',t); denied := false; exception when insufficient_privilege then denied := true; end;
    execute 'reset role';
    raise notice '%', ok(denied,t||' anon SELECT raises SQLSTATE 42501');
    execute 'set local role service_role';
    begin execute format('select 1 from finance.%I limit 1',t); denied := false; exception when insufficient_privilege then denied := true; end;
    execute 'reset role';
    raise notice '%', ok(denied,t||' service_role SELECT raises SQLSTATE 42501');
  end loop;
end
$anonymous_service$;

select * from finish();
rollback;
