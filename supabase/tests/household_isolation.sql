-- Each block is one transaction. A passing run raises and rolls back.
-- Expected errors: isolation functions ok, gustav policy ok, cara policy ok,
-- outsider policy ok, anon policy ok.
-- After every block, finance.households has one row and no member is bound.

-- Membership matrix. Does not SET ROLE, so it can switch identities.
do $functions$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000001';
  v_b uuid := '00000000-0000-4000-8000-0000000000b2';
  v_gustav uuid := '00000000-0000-4000-8000-0000000000a1';
  v_cara uuid := '00000000-0000-4000-8000-0000000000a2';
  v_outsider uuid := '00000000-0000-4000-8000-0000000000b1';
begin
  insert into finance.households (id) values (v_b);
  insert into finance.household_members (household_id, email, auth_user_id, role)
  values (v_b, 'attacker@test.invalid', v_outsider, 'member');

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_gustav::text, 'role', 'authenticated', 'email', 'gustav@klingbiel.org',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_gustav::text, true);
  if not finance.is_household_member(v_a) or finance.is_household_member(v_b) then
    raise exception 'unbound gustav should see A only';
  end if;

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_gustav::text, 'role', 'authenticated', 'email', 'gustav@klingbiel.org',
    'email_verified', false, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  if finance.is_household_member(v_a) then
    raise exception 'unverified email must not match an unbound row';
  end if;

  update finance.household_members set auth_user_id = v_gustav
  where household_id = v_a and lower(email) = 'gustav@klingbiel.org';
  update finance.household_members set auth_user_id = v_cara
  where household_id = v_a and lower(email) = 'cara@klingbiel.org';

  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_gustav::text, 'role', 'authenticated', 'email', 'attacker@test.invalid',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_gustav::text, true);
  if not finance.is_household_member(v_a) or finance.is_household_member(v_b) then
    raise exception 'bound gustav uid should see A only';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ff', true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', '00000000-0000-4000-8000-0000000000ff', 'role', 'authenticated',
    'email', 'gustav@klingbiel.org', 'email_verified', true,
    'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  if finance.is_household_member(v_a) then
    raise exception 'email must not match a bound row';
  end if;

  perform set_config('request.jwt.claim.sub', v_cara::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_cara::text, 'role', 'authenticated', 'email', 'cara@klingbiel.org',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  if not finance.is_household_member(v_a) or finance.is_household_member(v_b) then
    raise exception 'cara should see A only';
  end if;

  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_outsider::text, 'role', 'authenticated', 'email', 'attacker@test.invalid',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  if finance.is_household_member(v_a) or not finance.is_household_member(v_b) then
    raise exception 'outsider should see B only';
  end if;

  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform finance.resolve_caller_household();
    raise exception 'service role resolved a household';
  exception
    when others then
      if sqlerrm not like '%not a household member%' then
        raise;
      end if;
  end;

  raise exception 'isolation functions ok';
end
$functions$;

-- Policy checks cannot switch back from SET ROLE, so each identity is its own block.
-- They insert household B, assert, then raise so the insert rolls back.

do $gustav$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000001';
  v_b uuid := '00000000-0000-4000-8000-0000000000b2';
  v_gustav uuid := '00000000-0000-4000-8000-0000000000a1';
  v_account uuid := '00000000-0000-4000-8000-0000000000b3';
  v_visible integer;
  v_own integer;
begin
  insert into finance.households (id) values (v_b);
  insert into finance.household_members (household_id, email, auth_user_id, role)
  values (v_b, 'attacker@test.invalid', '00000000-0000-4000-8000-0000000000b1', 'member');
  update finance.household_members set auth_user_id = v_gustav
  where household_id = v_a and lower(email) = 'gustav@klingbiel.org';
  insert into public.accounts (account_id, source_account_id, name, household_id, source_system)
  values (v_account, 'isolation-b', 'Isolation B', v_b, 'test');
  insert into public.transactions (id, account_id, date, details, household_id)
  values ('isolation-b', v_account, now(), '{}'::jsonb, v_b);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_gustav::text, 'role', 'authenticated', 'email', 'gustav@klingbiel.org',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_gustav::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_visible from public.transactions where id = 'isolation-b';
  select count(*) into v_own from public.transactions where household_id = v_a;
  if v_visible <> 0 or v_own = 0 then
    raise exception 'gustav policy failed';
  end if;
  raise exception 'gustav policy ok';
end
$gustav$;

do $cara$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000001';
  v_b uuid := '00000000-0000-4000-8000-0000000000b2';
  v_cara uuid := '00000000-0000-4000-8000-0000000000a2';
  v_account uuid := '00000000-0000-4000-8000-0000000000b3';
  v_visible integer;
  v_own integer;
begin
  insert into finance.households (id) values (v_b);
  insert into finance.household_members (household_id, email, auth_user_id, role)
  values (v_b, 'attacker@test.invalid', '00000000-0000-4000-8000-0000000000b1', 'member');
  update finance.household_members set auth_user_id = v_cara
  where household_id = v_a and lower(email) = 'cara@klingbiel.org';
  insert into public.accounts (account_id, source_account_id, name, household_id, source_system)
  values (v_account, 'isolation-b', 'Isolation B', v_b, 'test');
  insert into public.transactions (id, account_id, date, details, household_id)
  values ('isolation-b', v_account, now(), '{}'::jsonb, v_b);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_cara::text, 'role', 'authenticated', 'email', 'cara@klingbiel.org',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_cara::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_visible from public.transactions where id = 'isolation-b';
  select count(*) into v_own from public.transactions where household_id = v_a;
  if v_visible <> 0 or v_own = 0 then
    raise exception 'cara policy failed';
  end if;
  begin
    insert into public.transactions (id, account_id, date, details, household_id)
    values ('isolation-write', v_account, now(), '{}'::jsonb, v_a);
    raise exception 'authenticated inserted a transaction';
  exception
    when insufficient_privilege then
      null;
  end;
  raise exception 'cara policy ok';
end
$cara$;

do $outsider$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000001';
  v_b uuid := '00000000-0000-4000-8000-0000000000b2';
  v_outsider uuid := '00000000-0000-4000-8000-0000000000b1';
  v_account uuid := '00000000-0000-4000-8000-0000000000b3';
  v_visible integer;
  v_own integer;
begin
  insert into finance.households (id) values (v_b);
  insert into finance.household_members (household_id, email, auth_user_id, role)
  values (v_b, 'attacker@test.invalid', v_outsider, 'member');
  insert into public.accounts (account_id, source_account_id, name, household_id, source_system)
  values (v_account, 'isolation-b', 'Isolation B', v_b, 'test');
  insert into public.transactions (id, account_id, date, details, household_id)
  values ('isolation-b', v_account, now(), '{}'::jsonb, v_b);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_outsider::text, 'role', 'authenticated', 'email', 'attacker@test.invalid',
    'email_verified', true, 'app_metadata', json_build_object('provider', 'google')
  )::text, true);
  perform set_config('request.jwt.claim.sub', v_outsider::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_visible from public.transactions where id = 'isolation-b';
  select count(*) into v_own from public.transactions where household_id = v_a;
  if v_visible <> 1 or v_own <> 0 then
    raise exception 'outsider policy failed';
  end if;
  raise exception 'outsider policy ok';
end
$outsider$;

do $anon$
begin
  execute 'set local role anon';
  begin
    perform 1 from public.transactions limit 1;
    raise exception 'anon read transactions';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    perform 1 from public.accounts limit 1;
    raise exception 'anon read accounts';
  exception
    when insufficient_privilege then
      null;
  end;
  raise exception 'anon policy ok';
end
$anon$;
