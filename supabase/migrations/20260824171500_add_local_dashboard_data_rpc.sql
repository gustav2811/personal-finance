create or replace function public.get_local_dashboard_data()
returns jsonb
language sql
security definer
set search_path = public, consumption
as $$
  select jsonb_build_object(
    'devices',
    coalesce(
      (
        select jsonb_agg(to_jsonb(device) order by device.name)
        from consumption.devices as device
      ),
      '[]'::jsonb
    ),
    'readings',
    coalesce(
      (
        select jsonb_agg(to_jsonb(reading) order by reading.period_start)
        from consumption.readings as reading
        where reading.period_start >= now() - interval '366 days'
      ),
      '[]'::jsonb
    ),
    'ledgerEntries',
    coalesce(
      (
        select jsonb_agg(to_jsonb(entry) order by entry.occurred_at)
        from consumption.ledger_entries as entry
        where entry.occurred_at >= now() - interval '366 days'
      ),
      '[]'::jsonb
    ),
    'ingestionRuns',
    coalesce(
      (
        select jsonb_agg(to_jsonb(run) order by run.started_at desc)
        from consumption.ingestion_runs as run
      ),
      '[]'::jsonb
    ),
    'financialTransactions',
    coalesce(
      (
        select jsonb_agg(to_jsonb(transaction_row) order by transaction_row.date desc)
        from public.transactions as transaction_row
        where transaction_row.date >= now() - interval '366 days'
      ),
      '[]'::jsonb
    ),
    'financialSnapshots',
    coalesce(
      (
        select jsonb_agg(to_jsonb(snapshot) order by snapshot.date desc)
        from public.snapshots as snapshot
        where snapshot.date >= current_date - 366
      ),
      '[]'::jsonb
    ),
    'financialError',
    null,
    'fetchedAt',
    now()
  );
$$;

revoke all on function public.get_local_dashboard_data() from public, anon, authenticated;
grant execute on function public.get_local_dashboard_data() to service_role;
