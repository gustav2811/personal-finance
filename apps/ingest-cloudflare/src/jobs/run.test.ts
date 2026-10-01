import { describe, expect, it } from "vitest";
import { SubrequestBudget } from "./budget.js";
import {
  createDlqReportJob,
  createIsmrtSyncJob,
  createTuyaDayJob,
  createTuyaPlanJob,
} from "./jobs.js";
import { runJob } from "./run.js";
import type { ConsumerEnv } from "../config.js";

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
      UPLOAD_TO_FINWISE: "",
      TUYA_DEVICE_ID: "device",
      TUYA_ACCESS_ID: "access-id",
      TUYA_ACCESS_SECRET: "access-secret",
    } as unknown as ConsumerEnv;

    await runJob(
      createDlqReportJob("2026-09-29T07:00:00.000Z"),
      env,
      new SubrequestBudget(),
    );
    await runJob(
      createIsmrtSyncJob("2026-09-29T07:00:00.000Z"),
      env,
      new SubrequestBudget(),
    );
    await runJob(
      createTuyaPlanJob("2026-09-29T07:00:00.000Z"),
      env,
      new SubrequestBudget(),
    );
    await runJob(
      createTuyaDayJob("device", "2026-09-28"),
      env,
      new SubrequestBudget(),
    );

    expect(batches).toHaveLength(0);
  });
});
