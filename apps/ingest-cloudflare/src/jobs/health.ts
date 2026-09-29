import * as Sentry from "@sentry/cloudflare";
import { ConsumptionRpc, type IngestHealth } from "../ismrt/supabase.js";
import type { ConsumerEnv } from "../config.js";
import { tuyaPlanDates } from "../tuya/day.js";
import { missingTuyaDays } from "../tuya/run.js";
import { SubrequestBudget } from "./budget.js";
import { countDlqForHealth } from "./run.js";

export const ISMRT_MAX_STALENESS_DAYS = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const HEALTH_CHECK_MONITOR = "ingest-daily-health";

type HealthCheckName =
  | "tuya_days"
  | "tuya_reading"
  | "ismrt_reading"
  | "email_dlq";

type HealthCheckResult = {
  ok: boolean;
  details: Record<string, unknown>;
};

export type HealthCheckOptions = {
  countDlq?: (
    env: ConsumerEnv,
    budget: SubrequestBudget,
    now: Date,
  ) => Promise<{ count: number; error: string | null }>;
};

export async function runHealthCheck(
  env: ConsumerEnv,
  budget: SubrequestBudget,
  now: Date,
  fetchImpl: typeof fetch = fetch,
  options: HealthCheckOptions = {},
): Promise<void> {
  const plannedDates = tuyaPlanDates(now);
  const missingDates = await missingTuyaDays(env, now, budget);

  const rpc = new ConsumptionRpc(
    required(env.SUPABASE_URL, "SUPABASE_URL"),
    required(env.SUPABASE_SERVICE_KEY, "SUPABASE_SERVICE_KEY"),
    fetchImpl,
  );
  const yesterday = plannedDates[0];
  if (yesterday === undefined) {
    throw new Error("Tuya plan did not produce yesterday");
  }
  const rawIngestHealth = await rpc.health(
    `tuya:day:${required(env.TUYA_DEVICE_ID, "TUYA_DEVICE_ID")}:${yesterday}`,
  );
  const ingestHealth = parseIngestHealth(rawIngestHealth);
  const dlq = await (options.countDlq ?? countDlqForHealth)(env, budget, now);

  const results: Record<HealthCheckName, HealthCheckResult> = {
    tuya_days: {
      ok: missingDates.length === 0,
      details: { missing_dates: missingDates },
    },
    tuya_reading: tuyaReadingResult(ingestHealth),
    ismrt_reading: ismrtReadingResult(ingestHealth, now),
    email_dlq: {
      ok: dlq.error === null && dlq.count === 0,
      details: { count: dlq.count, error: dlq.error },
    },
  };
  const failedChecks = Object.entries(results).filter(
    ([, result]) => !result.ok,
  );

  for (const [check, result] of failedChecks) {
    Sentry.captureMessage(`health_check_failed:${check}`, {
      level: "error",
      fingerprint: ["health-check", check],
      extra: result.details,
    });
  }

  Sentry.captureCheckIn(
    {
      monitorSlug: HEALTH_CHECK_MONITOR,
      status: failedChecks.length > 0 ? "error" : "ok",
    },
    {
      schedule: {
        type: "crontab",
        value: "0 10 * * *",
      },
      checkinMargin: 60,
      maxRuntime: 10,
      timezone: "UTC",
    },
  );

  console.log(
    JSON.stringify({
      level: "info",
      msg: "health_check_completed",
      component: "ingest-consumer",
      results,
      subrequests_used: budget.used,
    }),
  );
}

function tuyaReadingResult(health: IngestHealth): HealthCheckResult {
  return {
    ok: health.tuya_reading_exists,
    details: { tuya_reading_exists: health.tuya_reading_exists },
  };
}

function ismrtReadingResult(
  health: IngestHealth,
  now: Date,
): HealthCheckResult {
  const latest = health.ismrt_latest_period_end;
  const latestTime = latest === null ? Number.NaN : Date.parse(latest);
  const ageMs = now.getTime() - latestTime;
  const maxAgeMs = ISMRT_MAX_STALENESS_DAYS * MS_PER_DAY;
  return {
    ok: Number.isFinite(latestTime) && ageMs <= maxAgeMs,
    details: {
      latest_period_end: latest,
      max_staleness_days: ISMRT_MAX_STALENESS_DAYS,
      age_days: Number.isFinite(ageMs) ? ageMs / MS_PER_DAY : null,
    },
  };
}

function parseIngestHealth(value: unknown): IngestHealth {
  if (
    !isRecord(value) ||
    typeof value.tuya_reading_exists !== "boolean" ||
    (value.ismrt_latest_period_end !== null &&
      typeof value.ismrt_latest_period_end !== "string")
  ) {
    throw new Error("Supabase ingest health response is invalid");
  }
  return {
    tuya_reading_exists: value.tuya_reading_exists,
    ismrt_latest_period_end: value.ismrt_latest_period_end,
  };
}

function required(value: string, name: string): string {
  if (!value.trim()) throw new Error(`missing ${name}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
