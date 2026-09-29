import { describe, expect, it } from "vitest";
import { SubrequestBudget } from "./budget.js";
import { runJob, type ConsumerEnv } from "./run.js";

describe("scheduled job router", () => {
  it("dispatches every job variant using fake bindings", async () => {
    const batches: unknown[][] = [];
    const env = {
      INGEST_BUCKET: {
        head: async () => ({ key: "marker" }),
        list: async () => ({
          objects: [],
          truncated: false,
          delimitedPrefixes: [],
        }),
      },
      JOBS_QUEUE: {
        sendBatch: async (batch: unknown[]) => {
          batches.push(batch);
        },
      },
      FINWISE_API_KEY: "",
      FINWISE_BASE_URL: "",
      SUPABASE_URL: "",
      SUPABASE_SERVICE_KEY: "",
      BANK_ZERO_ACCOUNT_ID: "",
      BANK_ZERO_ACCOUNT_MAP: "",
      UPLOAD_TO_FINWISE: "",
      TUYA_DEVICE_ID: "device",
      TUYA_ACCESS_ID: "access-id",
      TUYA_ACCESS_SECRET: "access-secret",
    } as unknown as ConsumerEnv;

    await runJob({ type: "dlq-report" }, env, new SubrequestBudget());
    await runJob(
      {
        type: "ismrt-sync",
        scheduledTime: "2026-09-29T07:00:00.000Z",
      },
      env,
      new SubrequestBudget(),
    );
    await runJob(
      {
        type: "tuya-plan",
        scheduledTime: "2026-09-29T07:00:00.000Z",
      },
      env,
      new SubrequestBudget(),
    );
    await runJob(
      {
        type: "tuya-day",
        deviceId: "device",
        date: "2026-09-28",
      },
      env,
      new SubrequestBudget(),
    );

    expect(batches).toHaveLength(1);
  });
});
