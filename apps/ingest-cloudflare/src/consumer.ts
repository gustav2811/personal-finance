import {
  createDlqReportJob,
  createHealthCheckJob,
  createIsmrtSyncJob,
  createTuyaPlanJob,
  parseJob,
  type Job,
} from "./jobs/jobs.js";
import { SubrequestBudget } from "./jobs/budget.js";
import { classifyJobFailure } from "./jobs/policy.js";
import { buildFailureTags, errorType } from "./jobs/observe.js";
import { runJob } from "./jobs/run.js";
import { getConsumerConfig, type ConsumerEnv } from "./config.js";
import * as Sentry from "@sentry/cloudflare";
import { TuyaSubscriptionExpiredError } from "./tuya/errors.js";
import {
  attachmentToPayload,
  ChunkIncomplete,
  finalizeIngestPayload,
  processIngestJob,
  type IngestQueueMessageV1,
  type ProcessJobLogger,
} from "@investments/ingest-core";

export type { ConsumerEnv } from "./config.js";

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

const handler = {
  fetch: fetchForQueueOnlyWorker,

  async scheduled(
    event: ScheduledEvent,
    env: ConsumerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const scheduledTime = new Date(event.scheduledTime).toISOString();
      switch (event.cron) {
        case "0 7 * * *":
          {
            const budget = new SubrequestBudget();
            budget.internal("queue:sendBatch");
          await env.JOBS_QUEUE.sendBatch([
              { body: createDlqReportJob(scheduledTime) },
              { body: createIsmrtSyncJob(scheduledTime) },
              { body: createTuyaPlanJob(scheduledTime) },
          ]);
          }
          return;
        case "0 10 * * *":
          {
            const budget = new SubrequestBudget();
            budget.internal("queue:sendBatch");
          await env.JOBS_QUEUE.sendBatch([
              { body: createHealthCheckJob(scheduledTime) },
          ]);
          }
          return;
        default:
          throw new Error(`Unknown consumer cron: ${event.cron}`);
      }
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

export default Sentry.withSentry(
  (env) => ({
    dsn: env.SENTRY_DSN,
    environment: "production",
    tracesSampleRate: 0,
  }),
  handler,
);

async function processEmailQueueBatch(
  batch: MessageBatch<IngestQueueMessageV1 | Job>,
  env: ConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    if (!isIngestQueueMessage(message.body)) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "queue_message_invalid",
          component: "ingest-consumer",
          queue: "investments-email-ingest",
        }),
      );
      Sentry.captureMessage("invalid_job_body", {
        level: "error",
        tags: {
          queue: "investments-email-ingest",
          job_type: "email-ingest",
          error_type: "invalid_job_body",
        },
      });
      message.ack();
      continue;
    }
    try {
      await processEmailIngestMessage(message.body, env);
      message.ack();
    } catch (err: unknown) {
      const body = message.body;
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
      if (!isChunk) {
        Sentry.captureException(err, {
          tags: buildFailureTags(
            "investments-email-ingest",
            "email-ingest",
            err,
            { jobId: body.job_id },
          ),
        });
      }
      message.retry();
    }
  }
}

async function processJobsQueueBatch(
  batch: MessageBatch<IngestQueueMessageV1 | Job>,
  env: ConsumerEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = parseJob(message.body);
    if (!parsed.ok) {
      console.log(
        JSON.stringify({
          level: "error",
          msg:
            parsed.reason === "unsupported_version"
              ? "scheduled_job_unsupported_version"
              : "scheduled_job_invalid",
          component: "ingest-consumer",
          job_id: jobIdFromBody(message.body),
          ...(parsed.reason === "unsupported_version"
            ? { version: parsed.v, outcome: "retry", attempts: message.attempts }
            : { outcome: "abandoned" }),
        }),
      );
      if (parsed.reason === "unsupported_version") {
        Sentry.captureMessage("unsupported_version", "error");
        message.retry();
      } else {
        Sentry.captureMessage("invalid_job_body", "error");
        message.ack();
      }
      continue;
    }

    const job: Job = parsed.job;
    const budget = new SubrequestBudget();
    try {
      await runJob(job, env, budget);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "scheduled_job_completed",
          component: "ingest-consumer",
          job_id: job.jobId,
          job_type: job.type,
          subrequests_used: budget.used,
          ...(job.type === "tuya-day"
            ? { device_id: job.deviceId, date: job.date }
            : job.type === "ismrt-sync" ||
                job.type === "tuya-plan" ||
                job.type === "health-check"
              ? { scheduled_time: job.scheduledTime }
              : {}),
        }),
      );
      message.ack();
    } catch (err: unknown) {
      const outcome = classifyJobFailure(err);
      Sentry.captureException(err, {
        tags: buildFailureTags("investments-jobs", job, err, {
          jobId: job.jobId,
          outcome,
        }),
      });
      switch (outcome) {
        case "abandon":
          console.log(
            JSON.stringify({
              level: "error",
              msg: "scheduled_job_failed",
              component: "ingest-consumer",
              outcome: "abandoned",
              error_type: errorType(err),
              error: errorMessage(err),
              job_id: job.jobId,
              job_type: job.type,
              subrequests_used: budget.used,
            }),
          );
          message.ack();
          break;
        case "retry":
          console.log(
            JSON.stringify({
              level: "error",
              msg: "scheduled_job_failed",
              component: "ingest-consumer",
              outcome,
              attempts: message.attempts,
              error_type: errorType(err),
              error: errorMessage(err),
              job_id: job.jobId,
              job_type: job.type,
              subrequests_used: budget.used,
            }),
          );
          message.retry();
          break;
        default:
          assertNever(outcome);
      }
    }
  }
}

function jobIdFromBody(value: unknown): string | null {
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { jobId?: unknown }).jobId === "string"
  ) {
    return (value as { jobId: string }).jobId;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled job failure outcome: ${value}`);
}

function isIngestQueueMessage(value: unknown): value is IngestQueueMessageV1 {
  if (!isRecord(value) || value.v !== 1) return false;
  if (typeof value.job_id !== "string" || !isRecord(value.fields)) return false;
  if (!Object.values(value.fields).every((field) => typeof field === "string")) {
    return false;
  }
  if (
    (value.email !== undefined && typeof value.email !== "string") ||
    (value.email_r2_key !== undefined && typeof value.email_r2_key !== "string")
  ) {
    return false;
  }
  return (
    Array.isArray(value.attachments) &&
    value.attachments.every(
      (attachment) =>
        isRecord(attachment) &&
        typeof attachment.fieldname === "string" &&
        typeof attachment.filename === "string" &&
        typeof attachment.mimetype === "string" &&
        typeof attachment.r2_key === "string",
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
