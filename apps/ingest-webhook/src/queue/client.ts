import { Queue } from "bullmq";
import type { IngestWebhookConfig } from "../config.js";
import type { IngestJobPayload } from "@investments/ingest-core";
import {
  attachmentToPayload,
  payloadToBuffer,
} from "@investments/ingest-core";

export type { IngestJobPayload };
export { attachmentToPayload, payloadToBuffer };

const QUEUE_NAME = "email-ingest";

let queue: Queue<IngestJobPayload> | null = null;

export function getQueue(config: IngestWebhookConfig): Queue<IngestJobPayload> {
  if (!queue) {
    queue = new Queue<IngestJobPayload>(QUEUE_NAME, {
      connection: { url: config.redisUrl },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { count: 1000 },
      },
    });
  }
  return queue;
}

export async function addIngestJob(
  config: IngestWebhookConfig,
  payload: IngestJobPayload,
): Promise<string> {
  const q = getQueue(config);
  const job = await q.add("parse-and-post", payload, {
    jobId: payload.job_id,
  });
  return job.id ?? payload.job_id;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
