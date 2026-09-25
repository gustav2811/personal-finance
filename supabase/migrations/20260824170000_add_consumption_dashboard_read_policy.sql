grant usage on schema consumption to authenticated;
grant select on all tables in schema consumption to authenticated;

create or replace function consumption.is_dashboard_user()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) in (
    'gustav@klingbiel.org',
    'cara@klingbiel.org'
  );
$$;

revoke all on function consumption.is_dashboard_user() from public, anon;
grant execute on function consumption.is_dashboard_user() to authenticated;

drop policy if exists dashboard_users_read_devices on consumption.devices;
create policy dashboard_users_read_devices
on consumption.devices
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_raw_events on consumption.raw_events;
create policy dashboard_users_read_raw_events
on consumption.raw_events
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_readings on consumption.readings;
create policy dashboard_users_read_readings
on consumption.readings
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_ledger_entries
  on consumption.ledger_entries;
create policy dashboard_users_read_ledger_entries
on consumption.ledger_entries
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_documents on consumption.documents;
create policy dashboard_users_read_documents
on consumption.documents
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_context_events
  on consumption.context_events;
create policy dashboard_users_read_context_events
on consumption.context_events
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_ingestion_runs
  on consumption.ingestion_runs;
create policy dashboard_users_read_ingestion_runs
on consumption.ingestion_runs
for select
to authenticated
using (consumption.is_dashboard_user());
