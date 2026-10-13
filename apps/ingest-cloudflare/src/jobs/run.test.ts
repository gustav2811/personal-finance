import { describe, expect, it, vi } from "vitest";
import { SubrequestBudget } from "./budget.js";
import {
  createBankZeroPublishJob,
  createDlqReportJob,
  createIsmrtSyncJob,
  createTuyaDayJob,
  createTuyaPlanJob,
} from "./jobs.js";
import { runJob } from "./run.js";
import type { ConsumerEnv } from "../config.js";

const publicationMocks = vi.hoisted(() => ({
  processBankZeroPublicationBatch: vi.fn(),
}));

vi.mock("@investments/ingest-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@investments/ingest-core")>(),
  ...publicationMocks,
}));

describe("scheduled job router", () => {
  function publicationEnv(send: (job: unknown, options?: unknown) => Promise<void>): ConsumerEnv {
    return {
      BANK_ZERO_PUBLISH_QUEUE: { send },
      FINWISE_API_KEY: "finwise-key",
      FINWISE_BASE_URL: "https://finwise.test",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_KEY: "service-key",
      BANK_ZERO_ACCOUNT_ID: "bank-zero",
      UPLOAD_TO_FINWISE: "true",
    } as unknown as ConsumerEnv;
  }

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

  it("schedules a follow-up after a create leaves projection work deferred", async () => {
    const sent: Array<{ job: unknown; options: unknown }> = [];
    publicationMocks.processBankZeroPublicationBatch.mockResolvedValueOnce({
      claimed: 1, published: 0, deferred: 1,
    });
    await runJob(
      createBankZeroPublishJob("2026-10-13T11:00:00.000Z"),
      publicationEnv(async (job, options) => { sent.push({ job, options }); }),
      new SubrequestBudget(),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].job).toMatchObject({ type: "bank-zero-publish" });
    expect(sent[0].options).toEqual({ delaySeconds: 1 });
  });

  it("does not schedule a follow-up for an empty or partial published batch", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const env = publicationEnv(send);
    publicationMocks.processBankZeroPublicationBatch.mockResolvedValueOnce({
      claimed: 0, published: 0, deferred: 0,
    });
    await runJob(createBankZeroPublishJob("2026-10-13T11:00:00.000Z"), env, new SubrequestBudget());
    publicationMocks.processBankZeroPublicationBatch.mockResolvedValueOnce({
      claimed: 2, published: 2, deferred: 0,
    });
    await runJob(createBankZeroPublishJob("2026-10-13T11:01:00.000Z"), env, new SubrequestBudget());
    expect(send).not.toHaveBeenCalled();
  });
});
