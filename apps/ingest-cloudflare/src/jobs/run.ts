import { countDlqSince } from "@investments/ingest-core";
import { type ConsumerEnv, getConsumerConfig } from "../config.js";
import { logSummary, runConsumptionSync } from "../ismrt/run.js";
import { budgetedFetch, SubrequestBudget } from "./budget.js";
import type { Job, IsmrtSyncJob } from "./jobs.js";
import {
  handleTuyaDay,
  planTuyaDays,
  type TuyaEnv,
} from "../tuya/run.js";

const DLQ_REPORT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type JobRunOptions = {
  fetchImpl?: typeof fetch;
  now?: Date;
};

export async function runJob(
  job: Job,
  env: ConsumerEnv,
  budget: SubrequestBudget,
  options: JobRunOptions = {},
): Promise<void> {
  const fetchImpl = budgetedFetch(budget, options.fetchImpl ?? fetch);
  switch (job.type) {
    case "dlq-report":
      await reportDlq(job.jobId, env, budget);
      return;
    case "ismrt-sync":
      await syncIsmrt(job, env, fetchImpl, budget);
      return;
    case "tuya-plan":
      await planTuyaDays(env, new Date(job.scheduledTime), budget, job.jobId);
      return;
    case "tuya-day":
      await handleTuyaDay(
        job,
        env satisfies TuyaEnv,
        fetchImpl,
        options.now ?? new Date(),
        budget,
      );
      return;
    default:
      assertNever(job);
  }
}

async function reportDlq(
  jobId: string,
  env: ConsumerEnv,
  budget: SubrequestBudget,
): Promise<void> {
  const config = getConsumerConfig(env);
  if (!config.supabaseUrl?.trim() || !config.supabaseServiceRoleKey?.trim()) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "dlq_cron_skipped",
        component: "ingest-consumer",
        job_id: jobId,
        reason: "supabase_not_configured",
        subrequests_used: budget.used,
      }),
    );
    return;
  }
  const since = new Date(Date.now() - DLQ_REPORT_WINDOW_DAYS * MS_PER_DAY);
  budget.external("supabase:dlq");
  const { count, error } = await countDlqSince(config, since);
  console.log(
    JSON.stringify({
      level: error ? "warn" : "info",
      msg: "dlq_daily_report",
      component: "ingest-consumer",
      job_id: jobId,
      window_days: DLQ_REPORT_WINDOW_DAYS,
      dlq_count: count,
      subrequests_used: budget.used,
      ...(error ? { err: error } : {}),
    }),
  );
}

async function syncIsmrt(
  job: IsmrtSyncJob,
  env: ConsumerEnv,
  fetchImpl: typeof fetch,
  budget: SubrequestBudget,
): Promise<void> {
  if (!env.ISMRT_USERNAME?.trim() || !env.ISMRT_PASSWORD?.trim()) {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "ismrt_cron_skipped",
        component: "ingest-consumer",
        job_id: job.jobId,
        reason: "credentials_not_configured",
        subrequests_used: budget.used,
      }),
    );
    return;
  }
  logSummary(
    await runConsumptionSync(
      {
        ISMRT_USERNAME: env.ISMRT_USERNAME,
        ISMRT_PASSWORD: env.ISMRT_PASSWORD,
        SUPABASE_URL: env.SUPABASE_URL,
        SUPABASE_SERVICE_KEY: env.SUPABASE_SERVICE_KEY,
        ISMRT_LOOKBACK_DAYS: env.ISMRT_LOOKBACK_DAYS,
      },
      new Date(job.scheduledTime),
      fetchImpl,
      job.jobId,
    ),
    job.jobId,
    budget.used,
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled job type: ${JSON.stringify(value)}`);
}
