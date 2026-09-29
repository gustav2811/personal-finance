import { InvalidJobError, parseJob, type Job } from "./jobs/jobs.js";
import { SubrequestBudget } from "./jobs/budget.js";
import { getConsumerConfig, runJob, type ConsumerEnv } from "./jobs/run.js";
import { TuyaSubscriptionExpiredError } from "./tuya/client.js";
import {
  attachmentToPayload,
  ChunkIncomplete,
  finalizeIngestPayload,
  processIngestJob,
  type IngestQueueMessageV1,
  type ProcessJobLogger,
} from "@investments/ingest-core";

export type { ConsumerEnv } from "./jobs/run.js";

function createCfLogger(bindings: Record<string, unknown>): ProcessJobLogger {
  const line = (
    level: "info" | "warn" | "error",
    o: unknown,
    msg?: string,
  ): void => {
    const rest =
      typeof o === "object" && o !== null && !Array.isArray(o)
        ? (o as Record<string, unknown>)
        : { detail: o };
    console.log(
      JSON.stringify({
        level,
        msg: msg ?? "",
        ...bindings,
        ...rest,
      }),
    );
  };
  return {
    child: (b) => createCfLogger({ ...bindings, ...b }),
    info: (o, m) => line("info", o, m),
    warn: (o, m) => line("warn", o, m),
    error: (o, m) => line("error", o, m),
  };
}

async function processEmailIngestMessage(
  body: IngestQueueMessageV1,
  env: ConsumerEnv,
): Promise<void> {
  if (body.v !== 1) {
    throw new Error(
      `Unsupported ingest message version: ${String((body as { v?: unknown }).v)}`,
    );
  }

  console.log(
    JSON.stringify({
      level: "info",
      msg: "ingest_consumer_run_start",
      component: "ingest-consumer",
      job_id: body.job_id,
      ...(body.email_r2_key !== undefined
        ? { email_r2_key: body.email_r2_key }
        : {}),
      attachment_r2_keys: body.attachments.map((a) => a.r2_key),
      attachment_filenames: body.attachments.map((a) => a.filename),
    }),
  );

  const config = getConsumerConfig(env);
  const fields: Record<string, string> = { ...body.fields };

  if (body.email_r2_key) {
    const obj = await env.INGEST_BUCKET.get(body.email_r2_key);
    if (!obj) {
      throw new Error(`Missing R2 object: ${body.email_r2_key}`);
    }
    fields.email = await obj.text();
  } else if (body.email !== undefined) {
    fields.email = body.email;
  }

  const attachments = [];
  for (const att of body.attachments) {
    const obj = await env.INGEST_BUCKET.get(att.r2_key);
    if (!obj) {
      throw new Error(`Missing R2 object: ${att.r2_key}`);
    }
    const buf = Buffer.from(await obj.arrayBuffer());
    attachments.push(
      attachmentToPayload(att.fieldname, att.filename, att.mimetype, buf),
    );
  }

  const payload = await finalizeIngestPayload({
    job_id: body.job_id,
    fields,
    attachments,
  });

  const logger = createCfLogger({
    component: "ingest-consumer",
    job_id: body.job_id,
  });

  await processIngestJob(config, payload, logger);
}

/** Queue-only worker; browsers and uptime checks hit workers.dev — respond quietly (no thrown errors in logs). */
function fetchForQueueOnlyWorker(request: Request): Response {
  if (request.method === "GET" || request.method === "HEAD") {
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify({ error: "Method not allowed" }), {
    status: 405,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  fetch: fetchForQueueOnlyWorker,

  async scheduled(
    event: ScheduledEvent,
    env: ConsumerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const scheduledTime = new Date(event.scheduledTime).toISOString();
      await env.JOBS_QUEUE.sendBatch([
        { body: { type: "dlq-report" as const } },
        { body: { type: "ismrt-sync" as const, scheduledTime } },
        { body: { type: "tuya-plan" as const, scheduledTime } },
      ]);
    } catch (err: unknown) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "scheduled_jobs_enqueue_failed",
          component: "ingest-consumer",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      throw err;
    }
  },

  async queue(
    batch: MessageBatch<IngestQueueMessageV1 | Job>,
    env: ConsumerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    if (batch.queue === "investments-email-ingest") {
      await processEmailQueueBatch(batch, env);
      return;
    }
    if (batch.queue === "investments-jobs") {
      await processJobsQueueBatch(batch, env);
      return;
    }
    throw new Error(`Unknown queue: ${batch.queue}`);
  },
};

async function processEmailQueueBatch(
  batch: MessageBatch<IngestQueueMessageV1 | Job>,
  env: ConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processEmailIngestMessage(
        message.body as IngestQueueMessageV1,
        env,
      );
      message.ack();
    } catch (err: unknown) {
      const body = message.body as IngestQueueMessageV1;
      const isChunk = err instanceof ChunkIncomplete;
      console.log(
        JSON.stringify({
          level: isChunk ? "info" : "error",
          msg: isChunk
            ? "queue_message_chunk_deferred"
            : "queue_message_failed",
          component: "ingest-consumer",
          err: err instanceof Error ? err.message : String(err),
          error_type:
            err instanceof TuyaSubscriptionExpiredError
              ? "tuya_subscription_expired"
              : err instanceof Error
                ? err.name
                : "unknown",
          job_id: body.job_id,
          ...(body.email_r2_key !== undefined
            ? { email_r2_key: body.email_r2_key }
            : {}),
          attachment_r2_keys: body.attachments.map((a) => a.r2_key),
        }),
      );
      message.retry();
    }
  }
}

async function processJobsQueueBatch(
  batch: MessageBatch<IngestQueueMessageV1 | Job>,
  env: ConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    let job: Job;
    try {
      job = parseJob(message.body);
    } catch (err: unknown) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "scheduled_job_invalid",
          component: "ingest-consumer",
          error: err instanceof InvalidJobError ? err.message : "unknown",
        }),
      );
      message.ack();
      continue;
    }

    const budget = new SubrequestBudget();
    try {
      await runJob(job, env, budget);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "scheduled_job_completed",
          component: "ingest-consumer",
          job_type: job.type,
          subrequests_used: budget.used,
          ...(job.type === "tuya-day"
            ? { device_id: job.deviceId, date: job.date }
            : job.type === "ismrt-sync" || job.type === "tuya-plan"
              ? { scheduled_time: job.scheduledTime }
              : {}),
        }),
      );
      message.ack();
    } catch (err: unknown) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "scheduled_job_failed",
          component: "ingest-consumer",
          job_type: job.type,
          error: err instanceof Error ? err.message : String(err),
          subrequests_used: budget.used,
          ...(job.type === "tuya-day"
            ? { device_id: job.deviceId, date: job.date }
            : job.type === "ismrt-sync" || job.type === "tuya-plan"
              ? { scheduled_time: job.scheduledTime }
              : {}),
        }),
      );
      message.retry();
    }
  }
}
