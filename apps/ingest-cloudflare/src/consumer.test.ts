import { describe, expect, it, vi } from "vitest";
import consumer from "./consumer.js";
import { createTuyaDayJob } from "./jobs/jobs.js";
import type { ConsumerEnv } from "./config.js";

describe("consumer schedule", () => {
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
});
