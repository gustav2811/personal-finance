alter table public.dlq_ingest_jobs
  add column if not exists status text not null default 'open',
  add column if not exists status_reason text,
  add column if not exists resolved_at timestamptz,
  add column if not exists replay_payload jsonb,
  add column if not exists replayed_at timestamptz;

alter table public.dlq_ingest_jobs
  drop constraint if exists dlq_ingest_jobs_status_check;

alter table public.dlq_ingest_jobs
  add constraint dlq_ingest_jobs_status_check
  check (status in ('open', 'replayed', 'resolved', 'ignored'));

create index if not exists dlq_ingest_jobs_open_created_at_idx
  on public.dlq_ingest_jobs (created_at desc)
  where status = 'open';
