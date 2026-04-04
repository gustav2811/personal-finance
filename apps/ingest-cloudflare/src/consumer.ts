import {
  attachmentToPayload,
  ChunkIncomplete,
  countDlqSince,
  finalizeIngestPayload,
  parseBankZeroAccountMapJson,
  processIngestJob,
  type IngestCoreConfig,
  type IngestQueueMessageV1,
  type ProcessJobLogger,
} from "@investments/ingest-core";

export interface ConsumerEnv {
  INGEST_BUCKET: R2Bucket;
  FINWISE_API_KEY: string;
  FINWISE_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  BANK_ZERO_ACCOUNT_ID: string;
  BANK_ZERO_ACCOUNT_MAP: string;
  UPLOAD_TO_FINWISE: string;
  CATEGORISATION_ENABLED?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_API_BASE?: string;
  CATEGORISATION_LLM_TIMEOUT_MS?: string;
  CATEGORISATION_MIN_CONFIDENCE?: string;
}

function getConsumerConfig(env: ConsumerEnv): IngestCoreConfig {
  const timeoutRaw = env.CATEGORISATION_LLM_TIMEOUT_MS ?? "45000";
  const timeoutParsed = parseInt(timeoutRaw, 10);
  const confRaw = env.CATEGORISATION_MIN_CONFIDENCE ?? "0.35";
  const confParsed = parseFloat(confRaw);
  return {
    finwiseApiKey: env.FINWISE_API_KEY,
    finwiseBaseUrl: env.FINWISE_BASE_URL || "https://api.finwiseapp.io",
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_KEY,
    bankZeroAccountId: env.BANK_ZERO_ACCOUNT_ID ?? "",
    bankZeroAccountMap: parseBankZeroAccountMapJson(
      env.BANK_ZERO_ACCOUNT_MAP ?? "[]",
    ),
    uploadToFinwise:
      env.UPLOAD_TO_FINWISE === "true" || env.UPLOAD_TO_FINWISE === "1",
    categorisationEnabled:
      env.CATEGORISATION_ENABLED === "true" ||
      env.CATEGORISATION_ENABLED === "1",
    geminiApiKey: env.GEMINI_API_KEY ?? "",
    geminiModel: env.GEMINI_MODEL ?? "gemini-gemini-3-flash-preview",
    geminiApiBase:
      env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com",
    categorisationLlmTimeoutMs: Number.isFinite(timeoutParsed)
      ? timeoutParsed
      : 45_000,
    categorisationMinConfidence: Number.isFinite(confParsed)
      ? confParsed
      : 0.35,
  };
}

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

async function processQueueMessage(
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

const DLQ_REPORT_WINDOW_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export default {
  fetch: fetchForQueueOnlyWorker,

  async scheduled(
    _event: ScheduledEvent,
    env: ConsumerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    const config = getConsumerConfig(env);
    if (!config.supabaseUrl?.trim() || !config.supabaseServiceRoleKey?.trim()) {
      console.log(
        JSON.stringify({
          level: "info",
          msg: "dlq_cron_skipped",
          reason: "supabase_not_configured",
        }),
      );
      return;
    }
    const since = new Date(Date.now() - DLQ_REPORT_WINDOW_DAYS * MS_PER_DAY);
    const { count, error } = await countDlqSince(config, since);
    console.log(
      JSON.stringify({
        level: error ? "warn" : "info",
        msg: "dlq_daily_report",
        window_days: DLQ_REPORT_WINDOW_DAYS,
        dlq_count: count,
        ...(error ? { err: error } : {}),
      }),
    );
  },

  async queue(
    batch: MessageBatch<IngestQueueMessageV1>,
    env: ConsumerEnv,
    _ctx: ExecutionContext,
  ): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processQueueMessage(message.body, env);
        message.ack();
      } catch (err) {
        const b = message.body;
        const isChunk = err instanceof ChunkIncomplete;
        console.log(
          JSON.stringify({
            level: isChunk ? "info" : "error",
            msg: isChunk
              ? "queue_message_chunk_deferred"
              : "queue_message_failed",
            component: "ingest-consumer",
            err: err instanceof Error ? err.message : String(err),
            job_id: b.job_id,
            ...(b.email_r2_key !== undefined
              ? { email_r2_key: b.email_r2_key }
              : {}),
            attachment_r2_keys: b.attachments.map((a) => a.r2_key),
          }),
        );
        message.retry();
      }
    }
  },
};
