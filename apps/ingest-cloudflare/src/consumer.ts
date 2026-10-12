import {
  createDlqReportJob,
  createHealthCheckJob,
  createBankZeroPublishJob,
  createBankZeroStatementJob,
  createIsmrtSyncJob,
  createTuyaPlanJob,
  parseJob,
  type Job,
} from "./jobs/jobs.js";
import { SubrequestBudget } from "./jobs/budget.js";
import { backoffDelaySeconds, classifyJobFailure } from "./jobs/policy.js";
import { buildFailureTags, errorType } from "./jobs/observe.js";
import { runJob } from "./jobs/run.js";
import { getConsumerConfig, type ConsumerEnv } from "./config.js";
import * as Sentry from "@sentry/cloudflare";
import { sentryOptions } from "./sentry.js";
import { TuyaSubscriptionExpiredError } from "./tuya/errors.js";
import {
  attachmentToPayload,
  ChunkIncomplete,
  claimBankZeroReviewReplayBatch,
  expireBankZeroSourceBatch,
  finalizeIngestPayload,
  finishBankZeroReviewReplay,
  processIngestJob,
  type IngestQueueMessageV1,
  type ProcessJobLogger,
  sendToDlq,
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
  statementStartRow = 0,
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

  // v1 jobs created before every-email R2 retention may still carry the MIME
  // body inline. Promote it before processing so evidence writes and replay
  // always refer to durable content.
  let rawR2Key = body.email_r2_key;
  let rawSha256 = body.raw_email_sha256;
  if (!rawR2Key && fields.email) {
    rawR2Key = `ingest/${body.job_id}/email.raw`;
    rawSha256 = await sha256Hex(fields.email);
    await env.INGEST_BUCKET.put(rawR2Key, fields.email, {
      httpMetadata: { contentType: "message/rfc822" },
      customMetadata: {
        sha256: rawSha256,
        received_at: body.received_at ?? new Date().toISOString(),
        delivery_id: body.delivery_id ?? body.job_id,
        ...(body.route_key ? { route_key: body.route_key } : {}),
      },
    });
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

  let envelope: unknown = {};
  const envelopeRaw = fields.envelope;
  if (envelopeRaw) {
    try {
      envelope = JSON.parse(envelopeRaw);
    } catch {
      envelope = { unparsed: true };
    }
  }

  const continuationSource: IngestQueueMessageV1 = { ...body };
  if (rawR2Key) continuationSource.email_r2_key = rawR2Key;
  if (rawSha256) continuationSource.raw_email_sha256 = rawSha256;
  delete continuationSource.email;

  await processIngestJob(config, payload, logger, {
    replayPayload: dlqReplayPayload(body),
    statementStartRow,
    bankZeroReceipt: {
      // Missing trusted route metadata is explicitly unresolved. It must never
      // be inferred from the visible To header or account alias.
      routeKey: body.route_key ?? "unverified",
      deliveryId: body.delivery_id ?? body.job_id,
      receivedAt: body.received_at ?? new Date().toISOString(),
      rawR2Key: rawR2Key ?? `ingest/${body.job_id}/email.raw`,
      rawSha256: rawSha256 ?? await sha256Hex(JSON.stringify(fields)),
      envelope,
      attachments: body.attachments.map((attachment) => ({
        filename: attachment.filename,
        mimetype: attachment.mimetype,
        ...(attachment.sha256 ? { sha256: attachment.sha256 } : {}),
        r2Key: attachment.r2_key,
      })),
    },
    scheduleStatementContinuation: async (nextStartRow) => {
      await env.JOBS_QUEUE.send(createBankZeroStatementJob(continuationSource, nextStartRow));
    },
  });
}

async function processBankZeroReviewReplayBatch(env: ConsumerEnv, limit = 1): Promise<void> {
  const config = getConsumerConfig(env);
  const workerId = `bank-zero-review:${crypto.randomUUID()}`;
  const claims = await claimBankZeroReviewReplayBatch(config, workerId, limit);
  for (const claim of claims) {
    try {
      const pointers = claim.receipt_metadata.attachmentPointers;
      if (pointers !== undefined && !Array.isArray(pointers)) {
        throw new Error("Replay source attachment pointers are invalid");
      }
      const attachments = (Array.isArray(pointers) ? pointers : []).map((value, index) => {
        if (!isRecord(value) || typeof value.r2Key !== "string") {
          throw new Error("Replay source contains an invalid attachment pointer");
        }
        return {
          fieldname: typeof value.fieldname === "string" ? value.fieldname : `attachment-${index}`,
          filename: typeof value.filename === "string" ? value.filename : `attachment-${index}`,
          mimetype: typeof value.mimetype === "string" ? value.mimetype : "application/octet-stream",
          r2_key: value.r2Key,
          ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
        };
      });
      const replay: IngestQueueMessageV1 = {
        v: 1,
        job_id: `bank-zero-manual-replay:${claim.replay_request_id}`,
        delivery_id: `manual-replay:${claim.replay_request_id}`,
        received_at: claim.received_at,
        route_key: claim.route_key,
        fields: {},
        attachments,
        email_r2_key: claim.raw_r2_key,
        raw_email_sha256: claim.raw_sha256,
      };
      await processEmailIngestMessage(replay, env);
      await finishBankZeroReviewReplay(config, claim.replay_request_id, workerId, {
        succeeded: true,
        details: { parser: "current", completedAt: new Date().toISOString() },
      });
      console.log(JSON.stringify({
        level: "info", msg: "bank_zero_review_replay_completed",
        component: "ingest-consumer", replay_request_id: claim.replay_request_id,
        observation_id: claim.observation_id,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const terminal = claim.attempt_count >= 5 || message.startsWith("Missing R2 object:");
      const retryDelaySeconds = Math.min(60 * 2 ** Math.max(claim.attempt_count - 1, 0), 3600);
      await finishBankZeroReviewReplay(config, claim.replay_request_id, workerId, {
        succeeded: false, error: message, retryDelaySeconds, terminal,
      });
      console.log(JSON.stringify({
        level: terminal ? "error" : "warn", msg: "bank_zero_review_replay_failed",
        component: "ingest-consumer", replay_request_id: claim.replay_request_id,
        observation_id: claim.observation_id, attempt: claim.attempt_count,
        outcome: terminal ? "terminal_failure" : "retryable_failure", error: message,
      }));
    }
  }
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Keep only durable R2 pointers and metadata needed to reconstruct a queue message. */
function dlqReplayPayload(body: IngestQueueMessageV1): Record<string, unknown> {
  return {
    v: body.v,
    job_id: body.job_id,
    ...(body.route_key ? { route_key: body.route_key } : {}),
    ...(body.delivery_id ? { delivery_id: body.delivery_id } : {}),
    ...(body.received_at ? { received_at: body.received_at } : {}),
    fields: body.fields,
    attachments: body.attachments,
    ...(body.email_r2_key ? { email_r2_key: body.email_r2_key } : {}),
    ...(body.raw_email_sha256 ? { raw_email_sha256: body.raw_email_sha256 } : {}),
  };
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
        case "* * * * *":
          try {
            await drainR2RecoveryRecords(env, 10);
          } catch (error) {
            console.log(JSON.stringify({
              level: "warn", msg: "r2_recovery_scan_failed",
              component: "ingest-consumer",
              error: error instanceof Error ? error.message : String(error),
            }));
          }
          try {
            await processBankZeroReviewReplayBatch(env, 1);
          } catch (error) {
            console.log(JSON.stringify({
              level: "warn", msg: "bank_zero_review_replay_scan_failed",
              component: "ingest-consumer",
              error: error instanceof Error ? error.message : String(error),
            }));
          }
          await env.BANK_ZERO_PUBLISH_QUEUE.send({
            body: createBankZeroPublishJob(scheduledTime),
          });
          return;
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
        case "0 2 * * *": {
          const result = await expireBankZeroSourceBatch(
            getConsumerConfig(env),
            (key) => env.INGEST_BUCKET.delete(key),
            20,
          );
          console.log(JSON.stringify({
            level: "info", msg: "bank_zero_source_retention_completed",
            component: "ingest-consumer", ...result,
          }));
          return;
        }
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
    if (batch.queue === "investments-email-ingest-dlq") {
      await processEmailDeadLetterBatch(batch, env);
      return;
    }
    if (batch.queue.endsWith("-dlq") || batch.queue.endsWith("-dlq-recovery")) {
      await processOtherDeadLetterBatch(batch, env);
      return;
    }
    if (batch.queue === "investments-jobs") {
      await processJobsQueueBatch(batch, env);
      return;
    }
    if (batch.queue === "investments-bank-zero-publish") {
      await processJobsQueueBatch(batch, env);
      return;
    }
    throw new Error(`Unknown queue: ${batch.queue}`);
  },
};

export default Sentry.withSentry(sentryOptions, handler);

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

async function processEmailDeadLetterBatch(
  batch: MessageBatch<unknown>,
  env: ConsumerEnv,
): Promise<void> {
  const config = getConsumerConfig(env);
  for (const message of batch.messages) {
    const original = message.body;
    let jobId = `cloudflare-email-dlq:${message.id}`;
    try {
      let replay: Record<string, unknown> | undefined;
      let messageId = jobId;
      let recoveryId = `cloudflare-email:${message.id}`;
      if (isIngestQueueMessage(original)) {
        jobId = original.job_id;
        messageId = original.fields["message-id"] ?? original.fields["Message-ID"] ?? original.job_id;
        recoveryId = `cloudflare-email:${original.route_key ?? "unrouted"}:${original.delivery_id ?? original.job_id}`;
        let durableMessage = original;
        if (!durableMessage.email_r2_key && durableMessage.email !== undefined) {
          const rawR2Key = `ingest/${durableMessage.job_id}/email.raw`;
          const digest = await sha256Hex(durableMessage.email);
          await env.INGEST_BUCKET.put(rawR2Key, durableMessage.email, {
            httpMetadata: { contentType: "message/rfc822" },
            customMetadata: { sha256: digest, delivery_id: durableMessage.delivery_id ?? durableMessage.job_id },
          });
          durableMessage = {
            ...durableMessage,
            email_r2_key: rawR2Key,
            raw_email_sha256: digest,
          };
          delete durableMessage.email;
        }
        replay = dlqReplayPayload(durableMessage);
      }

      const recoveryKey = `recovery/email-ingest/${safePathPart(jobId)}.json`;
      await env.INGEST_BUCKET.put(recoveryKey, JSON.stringify({
        version: 1,
        recoveryId,
        source: "cloudflare-native-dlq",
        queue: batch.queue,
        jobId,
        messageId,
        replayPayload: replay ?? null,
        exhaustedAttempts: message.attempts,
        recordedAt: new Date().toISOString(),
      }), { httpMetadata: { contentType: "application/json" } });

      await sendToDlq(config, {
        job_id: jobId,
        message_id: messageId,
        bank: "unknown",
        error: "Cloudflare email queue retry allowance exhausted",
        payload: { recovery_r2_key: recoveryKey, queue: batch.queue, exhausted_attempts: message.attempts },
        replay_payload: replay,
        recovery_id: recoveryId,
      });
      message.ack();
    } catch (error) {
      console.log(JSON.stringify({
        level: "error", msg: "email_native_dlq_persistence_failed",
        component: "ingest-consumer", job_id: jobId,
        error: error instanceof Error ? error.message : String(error),
      }));
      message.retry({ delaySeconds: backoffDelaySeconds(message.attempts) });
    }
  }
}

async function processOtherDeadLetterBatch(
  batch: MessageBatch<unknown>,
  env: ConsumerEnv,
): Promise<void> {
  const config = getConsumerConfig(env);
  for (const message of batch.messages) {
    const jobId = `cloudflare-dlq:${batch.queue}:${message.id}`;
    const recoveryId = `cloudflare:${batch.queue}:${message.id}`;
    const recoveryKey = `recovery/native-dlq/${safePathPart(batch.queue)}/${safePathPart(message.id)}.json`;
    try {
      await env.INGEST_BUCKET.put(recoveryKey, JSON.stringify({
        version: 1,
        recoveryId,
        source: "cloudflare-native-dlq",
        queue: batch.queue,
        jobId,
        messageId: message.id,
        replayPayload: message.body,
        exhaustedAttempts: message.attempts,
        recordedAt: new Date().toISOString(),
      }), { httpMetadata: { contentType: "application/json" } });
      await sendToDlq(config, {
        job_id: jobId,
        message_id: message.id,
        bank: "unknown",
        error: `Cloudflare ${batch.queue} retry allowance exhausted`,
        payload: { recovery_r2_key: recoveryKey, queue: batch.queue, exhausted_attempts: message.attempts },
        replay_payload: isRecord(message.body) ? message.body : { value: String(message.body) },
        recovery_id: recoveryId,
      });
      message.ack();
    } catch (error) {
      console.log(JSON.stringify({
        level: "error", msg: "native_dlq_persistence_failed",
        component: "ingest-consumer", queue: batch.queue,
        error: error instanceof Error ? error.message : String(error),
      }));
      message.retry({ delaySeconds: backoffDelaySeconds(message.attempts) });
    }
  }
}

/** R2 is the durable fallback when a DLQ drain cannot reach Supabase. */
async function drainR2RecoveryRecords(env: ConsumerEnv, limit: number): Promise<void> {
  const config = getConsumerConfig(env);
  const cursorKey = "recovery-control/email-ingest-cursor";
  const cursorObject = await env.INGEST_BUCKET.get(cursorKey);
  const cursor = cursorObject ? (await cursorObject.text()).trim() || undefined : undefined;
  const listed = await env.INGEST_BUCKET.list({ prefix: "recovery/", limit, ...(cursor ? { cursor } : {}) });
  for (const item of listed.objects) {
    const object = await env.INGEST_BUCKET.get(item.key);
    if (!object) continue;
    try {
      const record: unknown = JSON.parse(await object.text());
      if (!isRecord(record) || typeof record.jobId !== "string") {
        throw new Error("Recovery record has an invalid shape");
      }
      const recoveryId = typeof record.recoveryId === "string"
        ? record.recoveryId
        : `legacy-recovery:${record.jobId}`;
      const replay = isRecord(record.replayPayload) ? record.replayPayload : undefined;
      await sendToDlq(config, {
        job_id: record.jobId,
        message_id: typeof record.messageId === "string" ? record.messageId : record.jobId,
        bank: "unknown",
        error: typeof record.queue === "string" ? `Cloudflare ${record.queue} retry allowance exhausted` : "Cloudflare queue retry allowance exhausted",
        payload: { recovery_r2_key: item.key, queue: record.queue ?? "unknown", exhausted_attempts: record.exhaustedAttempts ?? null },
        replay_payload: replay,
        recovery_id: recoveryId,
      });
      await env.INGEST_BUCKET.delete(item.key);
    } catch (error) {
      console.log(JSON.stringify({
        level: "error", msg: "r2_recovery_drain_failed",
        component: "ingest-consumer", recovery_r2_key: item.key,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }
  if (listed.truncated) {
    if (!listed.cursor) throw new Error("R2 recovery scan is truncated without a continuation cursor");
    await env.INGEST_BUCKET.put(cursorKey, listed.cursor, {
      httpMetadata: { contentType: "text/plain" },
    });
  } else {
    await env.INGEST_BUCKET.delete(cursorKey);
  }
}

function safePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120) || crypto.randomUUID();
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
        Sentry.captureMessage("unsupported_version", {
          level: "error",
          tags: {
            queue: "investments-jobs",
            job_id: jobIdFromBody(message.body),
            error_type: "unsupported_version",
          },
        });
        message.retry();
      } else {
        Sentry.captureMessage("invalid_job_body", {
          level: "error",
          tags: {
            queue: "investments-jobs",
            job_id: jobIdFromBody(message.body),
            error_type: "invalid_job_body",
          },
        });
        message.ack();
      }
      continue;
    }

    const job: Job = parsed.job;
    if (job.type === "bank-zero-statement") {
      try {
        await processEmailIngestMessage(job.source, env, job.startRow);
        message.ack();
      } catch (err: unknown) {
        console.log(JSON.stringify({
          level: "error", msg: "bank_zero_statement_continuation_failed",
          component: "ingest-consumer", job_id: job.jobId,
          error: err instanceof Error ? err.message : String(err),
        }));
        message.retry({ delaySeconds: backoffDelaySeconds(message.attempts) });
      }
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
        case "backoff": {
          const delaySeconds = backoffDelaySeconds(message.attempts);
          console.log(
            JSON.stringify({
              level: "warn",
              msg: "scheduled_job_failed",
              component: "ingest-consumer",
              outcome,
              attempts: message.attempts,
              delay_seconds: delaySeconds,
              error_type: errorType(err),
              error: errorMessage(err),
              job_id: job.jobId,
              job_type: job.type,
              subrequests_used: budget.used,
            }),
          );
          message.retry({ delaySeconds });
          break;
        }
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
    (value.email_r2_key !== undefined && typeof value.email_r2_key !== "string") ||
    (value.route_key !== undefined && (typeof value.route_key !== "string" || !/^[a-z0-9_-]{1,64}$/.test(value.route_key))) ||
    (value.delivery_id !== undefined && typeof value.delivery_id !== "string") ||
    (value.received_at !== undefined && (typeof value.received_at !== "string" || Number.isNaN(Date.parse(value.received_at)))) ||
    (value.raw_email_sha256 !== undefined && (typeof value.raw_email_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.raw_email_sha256)))
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
        typeof attachment.r2_key === "string" &&
        (attachment.sha256 === undefined || (typeof attachment.sha256 === "string" && /^[0-9a-f]{64}$/.test(attachment.sha256))),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
