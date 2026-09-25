create schema if not exists finance;

create table if not exists finance.households (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists finance.household_members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references finance.households(id),
  auth_user_id uuid,
  email text,
  role text not null default 'owner' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  unique (household_id, auth_user_id),
  unique (household_id, email)
);

insert into finance.households (id)
values ('00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into finance.household_members (household_id, email, role)
values
  ('00000000-0000-4000-8000-000000000001', 'gustav@klingbiel.org', 'owner'),
  ('00000000-0000-4000-8000-000000000001', 'cara@klingbiel.org', 'owner')
on conflict (household_id, email) do nothing;

create or replace function finance.is_household_member(target_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = finance, public
as $$
  select exists (
    select 1
    from finance.household_members as member
    where member.household_id = target_household_id
      and (
        member.auth_user_id = auth.uid()
        or lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
  );
$$;

revoke all on function finance.is_household_member(uuid) from public, anon;
grant execute on function finance.is_household_member(uuid) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'consumption') then
    execute $fn$
      create or replace function consumption.is_dashboard_user()
      returns boolean
      language sql
      stable
      as $body$
        select
          coalesce(
            auth.jwt() -> 'app_metadata' ->> 'provider',
            auth.jwt() -> 'user_metadata' ->> 'provider',
            ''
          ) = 'google'
          and exists (
            select 1
            from finance.household_members as member
            where lower(member.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
               or member.auth_user_id = auth.uid()
          );
      $body$
    $fn$;
  end if;
end $$;
