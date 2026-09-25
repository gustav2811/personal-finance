create or replace function consumption.is_dashboard_user()
returns boolean
language sql
stable
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'gustav@klingbiel.org',
      'cara@klingbiel.org'
    )
    and coalesce(
      auth.jwt() -> 'app_metadata' ->> 'provider',
      auth.jwt() -> 'user_metadata' ->> 'provider',
      ''
    ) = 'google';
$$;

revoke all on function consumption.is_dashboard_user() from public, anon;
grant execute on function consumption.is_dashboard_user() to authenticated;
