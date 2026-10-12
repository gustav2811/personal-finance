alter table public.dlq_ingest_jobs
  add column if not exists recovery_id text;

create unique index if not exists dlq_ingest_jobs_recovery_id_key
  on public.dlq_ingest_jobs (recovery_id);
