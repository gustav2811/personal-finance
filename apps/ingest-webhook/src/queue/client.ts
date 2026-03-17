import { Queue } from "bullmq";
import type { IngestWebhookConfig } from "../config.js";

const QUEUE_NAME = "email-ingest";

export interface IngestJobAttachment {
  fieldname: string;
  filename: string;
  mimetype: string;
  /** Base64-encoded for Redis serialization */
  bufferBase64: string;
}

export interface IngestJobPayload {
  job_id: string;
  message_id: string;
  from: string;
  to: string;
  subject: string;
  headers: string;
  attachments: IngestJobAttachment[];
}

export function attachmentToPayload(
  fieldname: string,
  filename: string,
  mimetype: string,
  buffer: Buffer
): IngestJobAttachment {
  return {
    fieldname,
    filename,
    mimetype,
    bufferBase64: buffer.toString("base64"),
  };
}

export function payloadToBuffer(att: IngestJobAttachment): Buffer {
  return Buffer.from(att.bufferBase64, "base64");
}

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
  payload: IngestJobPayload
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
