import {
  countDlqSince,
  parseBankZeroAccountMapJson,
  type IngestCoreConfig,
} from "@investments/ingest-core";
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

export interface ConsumerEnv {
  INGEST_BUCKET: R2Bucket;
  JOBS_QUEUE: Queue<Job>;
  FINWISE_API_KEY: string;
  FINWISE_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  BANK_ZERO_ACCOUNT_ID: string;
  BANK_ZERO_ACCOUNT_MAP: string;
  UPLOAD_TO_FINWISE: string;
  CATEGORISATION_ENABLED?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_API_BASE?: string;
  CATEGORISATION_LLM_TIMEOUT_MS?: string;
  CATEGORISATION_MIN_CONFIDENCE?: string;
  ISMRT_USERNAME?: string;
  ISMRT_PASSWORD?: string;
  ISMRT_LOOKBACK_DAYS?: string;
  TUYA_DEVICE_ID: string;
  TUYA_ACCESS_ID: string;
  TUYA_ACCESS_SECRET: string;
}

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
      await reportDlq(env, budget);
      return;
    case "ismrt-sync":
      await syncIsmrt(job, env, fetchImpl, budget);
      return;
    case "tuya-plan":
      await planTuyaDays(env, new Date(job.scheduledTime), budget);
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
      return assertNever(job);
  }
}

async function reportDlq(
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
        reason: "supabase_not_configured",
        subrequests_used: budget.used,
      }),
    );
    return;
  }
  const since = new Date(Date.now() - DLQ_REPORT_WINDOW_DAYS * MS_PER_DAY);
  budget.spend("supabase:dlq");
  const { count, error } = await countDlqSince(config, since);
  console.log(
    JSON.stringify({
      level: error ? "warn" : "info",
      msg: "dlq_daily_report",
      component: "ingest-consumer",
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
        reason: "credentials_not_configured",
        subrequests_used: budget.used,
      }),
    );
    return;
  }
  try {
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
      ),
    );
  } catch (err: unknown) {
    console.log(
      JSON.stringify({
        level: "error",
        msg: "ismrt_consumption_sync_failed",
        component: "ingest-consumer",
        error: err instanceof Error ? err.message : "unknown",
        subrequests_used: budget.used,
      }),
    );
    throw err;
  }
}

export function getConsumerConfig(env: ConsumerEnv): IngestCoreConfig {
  const timeoutRaw = env.CATEGORISATION_LLM_TIMEOUT_MS ?? "45000";
  const timeoutParsed = parseInt(timeoutRaw, 10);
  const confRaw = env.CATEGORISATION_MIN_CONFIDENCE ?? "0.35";
  const confParsed = parseFloat(confRaw);
  return {
    finwiseApiKey: env.FINWISE_API_KEY,
    finwiseBaseUrl: env.FINWISE_BASE_URL || "https://api.finwiseapp.io",
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_KEY,
    bankZeroAccountId: env.BANK_ZERO_ACCOUNT_ID ?? "",
    bankZeroAccountMap: parseBankZeroAccountMapJson(
      env.BANK_ZERO_ACCOUNT_MAP ?? "[]",
    ),
    uploadToFinwise:
      env.UPLOAD_TO_FINWISE === "true" || env.UPLOAD_TO_FINWISE === "1",
    categorisationEnabled:
      env.CATEGORISATION_ENABLED === "true" ||
      env.CATEGORISATION_ENABLED === "1",
    geminiApiKey: env.GEMINI_API_KEY ?? "",
    geminiModel: env.GEMINI_MODEL ?? "gemini-gemini-3-flash-preview",
    geminiApiBase:
      env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com",
    categorisationLlmTimeoutMs: Number.isFinite(timeoutParsed)
      ? timeoutParsed
      : 45_000,
    categorisationMinConfidence: Number.isFinite(confParsed)
      ? confParsed
      : 0.35,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled job type: ${JSON.stringify(value)}`);
}
