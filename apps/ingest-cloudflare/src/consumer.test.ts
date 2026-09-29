import { describe, expect, it } from "vitest";
import consumer from "./consumer.js";
import type { ConsumerEnv } from "./jobs/run.js";

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
        { body: { type: "dlq-report" } },
        {
          body: {
            type: "ismrt-sync",
            scheduledTime: "2026-09-29T07:00:00.000Z",
          },
        },
        {
          body: {
            type: "tuya-plan",
            scheduledTime: "2026-09-29T07:00:00.000Z",
          },
        },
      ],
    ]);
  });
});
