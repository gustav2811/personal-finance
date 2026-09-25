grant select on public.accounts, public.transactions, public.snapshots
  to authenticated;

drop policy if exists dashboard_users_read_accounts on public.accounts;
create policy dashboard_users_read_accounts
on public.accounts
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_transactions on public.transactions;
create policy dashboard_users_read_transactions
on public.transactions
for select
to authenticated
using (consumption.is_dashboard_user());

drop policy if exists dashboard_users_read_snapshots on public.snapshots;
create policy dashboard_users_read_snapshots
on public.snapshots
for select
to authenticated
using (consumption.is_dashboard_user());
