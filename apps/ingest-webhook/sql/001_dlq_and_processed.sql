-- DLQ table for failed ingest jobs
CREATE TABLE IF NOT EXISTS dlq_ingest_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id text NOT NULL,
  message_id text NOT NULL,
  bank text NOT NULL,
  error text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlq_ingest_jobs_job_id ON dlq_ingest_jobs (job_id);
CREATE INDEX IF NOT EXISTS idx_dlq_ingest_jobs_created_at ON dlq_ingest_jobs (created_at);

-- Processed transactions for idempotency (external_id from canonical schema)
CREATE TABLE IF NOT EXISTS processed_transactions (
  external_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
