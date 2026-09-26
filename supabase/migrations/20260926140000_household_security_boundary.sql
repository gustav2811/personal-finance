-- Household authorization is auth.uid() after the first verified Google login.
-- Email matches only an unbound member row. is_household_member stays read-only
-- so RLS can call it. authenticated keeps USAGE on finance for that call only.

create or replace function finance.caller_is_verified_google()
returns boolean
language sql
stable
security definer
set search_path = pg_temp
as $$
  select
    (
      coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
      or coalesce(auth.jwt() -> 'app_metadata' -> 'providers', '[]'::jsonb) ? 'google'
    )
    and coalesce(auth.jwt() ->> 'email', '') <> ''
    and (
      coalesce(auth.jwt() ->> 'email_verified', '') in ('true', 't')
      or exists (
        select 1
        from auth.users as account
        where account.id = auth.uid()
          and account.email_confirmed_at is not null
          and lower(account.email) = lower(auth.jwt() ->> 'email')
      )
    );
$$;

create or replace function finance.bind_household_member()
returns void
language plpgsql
volatile
security definer
set search_path = pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if v_uid is null or not finance.caller_is_verified_google() then
    return;
  end if;

  update finance.household_members as member
  set auth_user_id = v_uid
  where member.auth_user_id is null
    and lower(member.email) = v_email
    and not exists (
      select 1
      from finance.household_members as taken
      where taken.household_id = member.household_id
        and taken.auth_user_id = v_uid
    );
end;
$$;

create or replace function finance.bind_household_member_from_user()
returns trigger
language plpgsql
security definer
set search_path = pg_temp
as $$
begin
  if new.email is null or new.email_confirmed_at is null then
    return new;
  end if;
  if coalesce(new.raw_app_meta_data ->> 'provider', '') <> 'google'
     and not coalesce(new.raw_app_meta_data -> 'providers', '[]'::jsonb) ? 'google' then
    return new;
  end if;

  update finance.household_members as member
  set auth_user_id = new.id
  where member.auth_user_id is null
    and lower(member.email) = lower(new.email)
    and not exists (
      select 1
      from finance.household_members as taken
      where taken.household_id = member.household_id
        and taken.auth_user_id = new.id
    );
  return new;
end;
$$;

create or replace function finance.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_temp
as $$
  select exists (
    select 1
    from finance.household_members as member
    where member.household_id = target_household_id
      and (
        member.auth_user_id = auth.uid()
        or (
          member.auth_user_id is null
          and finance.caller_is_verified_google()
          and lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
      )
  );
$$;

create or replace function finance.resolve_caller_household()
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_temp
as $$
declare
  v_id uuid;
begin
  perform finance.bind_household_member();

  select member.household_id into v_id
  from finance.household_members as member
  where member.auth_user_id = auth.uid()
     or (
       member.auth_user_id is null
       and finance.caller_is_verified_google()
       and lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
     )
  order by member.created_at
  limit 1;

  if v_id is null then
    raise exception 'not a household member';
  end if;
  return v_id;
end;
$$;

create or replace function public.finance_caller_membership_v1()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_temp
as $$
declare
  v_member boolean;
begin
  perform finance.bind_household_member();
  select exists (
    select 1
    from finance.household_members as member
    where member.auth_user_id = auth.uid()
       or (
         member.auth_user_id is null
         and finance.caller_is_verified_google()
         and lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       )
  ) into v_member;
  return jsonb_build_object('member', v_member);
end;
$$;

create or replace function consumption.is_dashboard_user()
returns boolean
language sql
stable
security definer
set search_path = pg_temp
as $$
  select exists (
    select 1
    from finance.household_members as member
    where member.auth_user_id = auth.uid()
       or (
         member.auth_user_id is null
         and finance.caller_is_verified_google()
         and lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
       )
  );
$$;

revoke all on function finance.caller_is_verified_google() from public, anon, authenticated, service_role;
revoke all on function finance.bind_household_member() from public, anon, authenticated, service_role;
revoke all on function finance.bind_household_member_from_user() from public, anon, authenticated, service_role;
revoke all on function finance.is_household_member(uuid) from public, anon, service_role;
revoke all on function finance.resolve_caller_household() from public, anon, authenticated, service_role;
revoke all on function public.finance_caller_membership_v1() from public, anon, service_role;
revoke all on function consumption.is_dashboard_user() from public, anon, service_role;

grant execute on function finance.is_household_member(uuid) to authenticated;
grant execute on function public.finance_caller_membership_v1() to authenticated;
grant execute on function consumption.is_dashboard_user() to authenticated;

revoke all on all tables in schema finance from public, anon, authenticated, service_role;
revoke all on all sequences in schema finance from public, anon, authenticated, service_role;
revoke usage on schema finance from public, anon, service_role;
grant usage on schema finance to authenticated;

alter default privileges for role postgres in schema finance
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema finance
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema finance
  revoke all on functions from public, anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema finance to supabase_auth_admin;
    grant execute on function finance.bind_household_member_from_user() to supabase_auth_admin;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'bind_household_member_on_auth_user') then
    drop trigger bind_household_member_on_auth_user on auth.users;
  end if;
  create trigger bind_household_member_on_auth_user
  after insert or update of email, email_confirmed_at, raw_app_meta_data
  on auth.users
  for each row
  execute function finance.bind_household_member_from_user();
exception
  when insufficient_privilege then
    raise notice 'household bind trigger skipped: %', sqlerrm;
end $$;

drop policy if exists dashboard_users_read_accounts on public.accounts;
create policy dashboard_users_read_accounts
on public.accounts
for select
to authenticated
using (finance.is_household_member(household_id));

drop policy if exists dashboard_users_read_transactions on public.transactions;
create policy dashboard_users_read_transactions
on public.transactions
for select
to authenticated
using (
  household_id is not null
  and finance.is_household_member(household_id)
);

drop policy if exists dashboard_users_read_snapshots on public.snapshots;
create policy dashboard_users_read_snapshots
on public.snapshots
for select
to authenticated
using (
  household_id is not null
  and finance.is_household_member(household_id)
);

revoke all on table
  public.accounts,
  public.transactions,
  public.snapshots,
  public.dlq_ingest_jobs,
  public.processed_transactions
from public, anon;

revoke insert, update, delete, truncate, references, trigger on table
  public.accounts,
  public.transactions,
  public.snapshots
from authenticated;

revoke all on table public.dlq_ingest_jobs, public.processed_transactions from authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'finance_list_transactions_v1',
        'finance_get_transaction_v1',
        'finance_get_transaction_filters_v1',
        'finance_get_transaction_activity_v1',
        'finance_set_transaction_category_v1',
        'finance_undo_transaction_category_v1',
        'finance_set_transaction_treatment_v1',
        'get_local_dashboard_data'
      )
  loop
    execute format('revoke all on function %s from public, anon, service_role', r.signature);
  end loop;
end $$;
