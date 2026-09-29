import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/cloudflare";
import { tuyaPlanDates } from "../tuya/day.js";
import { budgetedFetch, SubrequestBudget } from "./budget.js";
import {
  ISMRT_MAX_STALENESS_DAYS,
  runHealthCheck,
} from "./health.js";
import type { ConsumerEnv } from "./run.js";

vi.mock("@sentry/cloudflare", () => ({
  captureCheckIn: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withSentry: (_options: unknown, handler: unknown) => handler,
}));

function createBucket(successDates: string[]): R2Bucket {
  return {
    head: vi.fn(async (key: string) =>
      successDates.some((date) => key === `tuya/device/date=${date}/_SUCCESS`)
        ? ({} as R2ObjectBody)
        : null,
    ),
  } as unknown as R2Bucket;
}

function createEnv(bucket: R2Bucket): ConsumerEnv {
  return {
    INGEST_BUCKET: bucket,
    JOBS_QUEUE: {} as Queue<never>,
    FINWISE_API_KEY: "finwise",
    FINWISE_BASE_URL: "https://finwise.example",
    SUPABASE_URL: "https://supabase.example",
    SUPABASE_SERVICE_KEY: "service-key",
    BANK_ZERO_ACCOUNT_ID: "account",
    BANK_ZERO_ACCOUNT_MAP: "[]",
    UPLOAD_TO_FINWISE: "false",
    TUYA_DEVICE_ID: "device",
    TUYA_ACCESS_ID: "access-id",
    TUYA_ACCESS_SECRET: "access-secret",
    SENTRY_DSN: "https://sentry.example/1",
  };
}

function healthFetch(latestPeriodEnd: string | null): typeof fetch {
  return vi.fn(async () =>
    Response.json({
      tuya_reading_exists: true,
      ismrt_latest_period_end: latestPeriodEnd,
    }),
  ) as unknown as typeof fetch;
}

function countDlq(
  count: number,
  error: string | null = null,
): NonNullable<Parameters<typeof runHealthCheck>[4]>["countDlq"] {
  return async (_env, budget) => {
    budget.external("supabase:dlq");
    return { count, error };
  };
}

describe("health check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports an all-clear check-in without failure messages", async () => {
    const now = new Date("2026-09-29T10:00:00.000Z");
    const env = createEnv(createBucket(tuyaPlanDates(now)));
    const budget = new SubrequestBudget();

    await runHealthCheck(
      env,
      budget,
      now,
      budgetedFetch(budget, healthFetch("2026-09-28T22:00:00.000Z")),
      { countDlq: countDlq(0) },
    );

    expect(budget.used).toEqual({ external: 2, internal: 6 });
    expect(Sentry.captureMessage).not.toHaveBeenCalled();
    expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorSlug: "ingest-daily-health",
        status: "ok",
      }),
      expect.objectContaining({
        schedule: { type: "crontab", value: "0 10 * * *" },
      }),
    );
  });

  it("reports missing Tuya dates and stale ISMRT without throwing", async () => {
    const now = new Date("2026-09-29T10:00:00.000Z");
    const planned = tuyaPlanDates(now);
    const env = createEnv(createBucket(planned.slice(1)));
    const budget = new SubrequestBudget();

    await expect(
      runHealthCheck(
        env,
        budget,
        now,
        budgetedFetch(budget, healthFetch("2026-09-25T22:00:00.000Z")),
        { countDlq: countDlq(0) },
      ),
    ).resolves.toBeUndefined();

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(2);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "health_check_failed:tuya_days",
      expect.objectContaining({
        fingerprint: ["health-check", "tuya_days"],
      }),
    );
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "health_check_failed:ismrt_reading",
      expect.objectContaining({
        fingerprint: ["health-check", "ismrt_reading"],
        extra: expect.objectContaining({
          max_staleness_days: ISMRT_MAX_STALENESS_DAYS,
        }),
      }),
    );
    expect(Sentry.captureCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error" }),
      expect.anything(),
    );
  });
});
