import { describe, expect, it, vi } from "vitest";
import consumer from "./consumer.js";
import { createBankZeroPublishJob, createTuyaDayJob } from "./jobs/jobs.js";
import type { ConsumerEnv } from "./config.js";

const ingestCoreMocks = vi.hoisted(() => ({
  claimBankZeroReviewReplayBatch: vi.fn(),
  finishBankZeroReviewReplay: vi.fn(),
  finalizeIngestPayload: vi.fn(),
  processIngestJob: vi.fn(),
}));

vi.mock("@investments/ingest-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("@investments/ingest-core")>(),
  ...ingestCoreMocks,
}));

vi.mock("@sentry/cloudflare", () => ({
  withSentry: (_options: unknown, handler: unknown) => handler,
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  captureCheckIn: vi.fn(),
}));

describe("consumer schedule", () => {
  it("sends a valid publisher job directly to the publisher queue", async () => {
    const sent: unknown[] = [];
    const scheduledTime = Date.parse("2026-10-12T10:01:00.000Z");
    const env = {
      BANK_ZERO_PUBLISH_QUEUE: { send: async (job: unknown) => { sent.push(job); } },
      JOBS_QUEUE: { sendBatch: vi.fn() },
    } as unknown as ConsumerEnv;

    await consumer.scheduled(
      { cron: "* * * * *", scheduledTime } as unknown as ScheduledEvent,
      env,
      {} as ExecutionContext,
    );

    expect(sent).toEqual([createBankZeroPublishJob(new Date(scheduledTime).toISOString())]);
    expect(sent[0]).not.toHaveProperty("body");
  });

  it("enqueues all scheduled jobs in one batch", async () => {
    const batches: unknown[][] = [];
    const env = {
      JOBS_QUEUE: {
        sendBatch: async (batch: unknown[]) => {
          batches.push(batch);
        },
      },
    } as unknown as ConsumerEnv;
    const event = {
      cron: "0 7 * * *",
      scheduledTime: Date.parse("2026-09-29T07:00:00.000Z"),
    } as unknown as ScheduledEvent;

    await consumer.scheduled(event, env, {} as ExecutionContext);

    expect(batches).toEqual([
      [
        { body: { v: 1, jobId: "dlq-report:2026-09-29", type: "dlq-report" } },
        {
          body: {
            v: 1,
            jobId: "ismrt-sync:2026-09-29",
            type: "ismrt-sync",
            scheduledTime: "2026-09-29T07:00:00.000Z",
          },
        },
        {
          body: {
            v: 1,
            jobId: "tuya-plan:2026-09-29",
            type: "tuya-plan",
            scheduledTime: "2026-09-29T07:00:00.000Z",
          },
        },
      ],
    ]);
  });

  it("acks invalid jobs, retries newer versions, and applies failure policy", async () => {
    const acked: string[] = [];
    const retried: string[] = [];
    const job = createTuyaDayJob("device", "2026-09-28");
    const messages = [
      {
        body: "garbage",
        attempts: 1,
        ack: () => acked.push("invalid"),
        retry: () => retried.push("invalid"),
      },
      {
        body: { v: 2, type: "tuya-day" },
        attempts: 2,
        ack: () => acked.push("unsupported"),
        retry: () => retried.push("unsupported"),
      },
      {
        body: job,
        attempts: 3,
        ack: () => acked.push("abandon"),
        retry: () => retried.push("abandon"),
      },
      {
        body: createTuyaDayJob("device", "2026-09-28"),
        attempts: 4,
        ack: () => acked.push("retry"),
        retry: () => retried.push("retry"),
      },
    ];
    const env = {
      INGEST_BUCKET: { head: async () => null },
      JOBS_QUEUE: { sendBatch: vi.fn() },
      TUYA_DEVICE_ID: "device",
      TUYA_ACCESS_ID: "access-id",
      TUYA_ACCESS_SECRET: "secret",
    } as unknown as ConsumerEnv;
    const originalFetch = globalThis.fetch;
    try {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({ success: true, result: {} }),
        ),
      );
      await consumer.queue(
        {
          queue: "investments-jobs",
          messages: messages.slice(0, 3),
        } as unknown as MessageBatch<never>,
        env,
        {} as ExecutionContext,
      );
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
      await consumer.queue(
        {
          queue: "investments-jobs",
          messages: [messages[3]],
        } as unknown as MessageBatch<never>,
        env,
        {} as ExecutionContext,
      );
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }

    expect(acked).toEqual(["invalid", "abandon"]);
    expect(retried).toEqual(["unsupported", "retry"]);
  });

  it("enqueues only the health check at 10:00 UTC", async () => {
    const batches: unknown[][] = [];
    const env = {
      JOBS_QUEUE: {
        sendBatch: async (batch: unknown[]) => {
          batches.push(batch);
        },
      },
    } as unknown as ConsumerEnv;

    await consumer.scheduled(
      {
        cron: "0 10 * * *",
        scheduledTime: Date.parse("2026-09-29T10:00:00.000Z"),
      } as unknown as ScheduledEvent,
      env,
      {} as ExecutionContext,
    );

    expect(batches).toEqual([
      [
        {
          body: {
            v: 1,
            jobId: "health-check:2026-09-29",
            type: "health-check",
            scheduledTime: "2026-09-29T10:00:00.000Z",
          },
        },
      ],
    ]);
  });

  it("throws for an unknown cron", async () => {
    await expect(
      consumer.scheduled(
        {
          cron: "0 12 * * *",
          scheduledTime: Date.parse("2026-09-29T12:00:00.000Z"),
        } as unknown as ScheduledEvent,
        { JOBS_QUEUE: { sendBatch: vi.fn() } } as unknown as ConsumerEnv,
        {} as ExecutionContext,
      ),
    ).rejects.toThrow("Unknown consumer cron");
  });

  it("keeps a replay in progress until its final statement chunk completes", async () => {
    ingestCoreMocks.claimBankZeroReviewReplayBatch.mockResolvedValue([{
      replay_request_id: "replay-1",
      observation_id: "observation-1",
      received_email_id: "email-1",
      route_key: "profile-a",
      original_message_id: "message-1",
      raw_r2_key: "ingest/email-1/email.raw",
      raw_sha256: "a".repeat(64),
      received_at: "2026-10-12T10:00:00.000Z",
      receipt_metadata: { attachmentPointers: [] },
      attempt_count: 1,
    }]);
    ingestCoreMocks.finishBankZeroReviewReplay.mockResolvedValue(undefined);
    ingestCoreMocks.finalizeIngestPayload.mockResolvedValue({
      job_id: "bank-zero-manual-replay:replay-1",
      message_id: "message-1",
      from: "alerts@bankzero.test",
      to: "profile-a@test.invalid",
      subject: "Statement",
      text: "statement body",
      html: "",
      attachments: [],
    });
    ingestCoreMocks.processIngestJob.mockImplementation(async (
      _config: unknown,
      _payload: unknown,
      _logger: unknown,
      options: {
        statementStartRow?: number;
        scheduleStatementContinuation?: (nextStartRow: number) => Promise<void>;
      },
    ) => {
      if (options.statementStartRow === 0) {
        await options.scheduleStatementContinuation?.(100);
      }
    });

    const queued: unknown[] = [];
    const acknowledged: string[] = [];
    const env = {
      INGEST_BUCKET: {
        get: async (key: string) => key === "ingest/email-1/email.raw"
          ? { text: async () => "raw MIME" }
          : null,
        list: async () => ({ objects: [], truncated: false }),
        delete: vi.fn(),
      },
      JOBS_QUEUE: {
        send: async (job: unknown) => queued.push(job),
        sendBatch: vi.fn(),
      },
      BANK_ZERO_PUBLISH_QUEUE: { send: vi.fn() },
      FINWISE_API_KEY: "finwise-key",
      FINWISE_BASE_URL: "https://finwise.test",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_SERVICE_KEY: "service-key",
      BANK_ZERO_ACCOUNT_ID: "bank-zero",
      UPLOAD_TO_FINWISE: "false",
      TUYA_DEVICE_ID: "device",
      TUYA_ACCESS_ID: "access-id",
      TUYA_ACCESS_SECRET: "access-secret",
      SENTRY_DSN: "",
    } as unknown as ConsumerEnv;

    await consumer.scheduled(
      { cron: "* * * * *", scheduledTime: Date.parse("2026-10-12T10:01:00.000Z") } as unknown as ScheduledEvent,
      env,
      {} as ExecutionContext,
    );

    expect(queued).toHaveLength(1);
    expect(ingestCoreMocks.finishBankZeroReviewReplay).not.toHaveBeenCalled();
    const continuation = queued[0] as { type: string; source: { fields: Record<string, string> } };
    expect(continuation.type).toBe("bank-zero-statement");
    expect(continuation.source.fields).toMatchObject({
      bank_zero_replay_request_id: "replay-1",
    });

    await consumer.queue({
      queue: "investments-jobs",
      messages: [{
        body: queued[0],
        attempts: 1,
        ack: () => acknowledged.push("final-statement-chunk"),
        retry: () => acknowledged.push("retry"),
      }],
    } as unknown as MessageBatch<never>, env, {} as ExecutionContext);

    expect(ingestCoreMocks.finishBankZeroReviewReplay).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseUrl: "https://supabase.test" }),
      "replay-1",
      expect.stringMatching(/^bank-zero-review:/),
      expect.objectContaining({ succeeded: true }),
    );
    expect(acknowledged).toEqual(["final-statement-chunk"]);
  });
});
