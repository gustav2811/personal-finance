import {
  attachmentToPayload,
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
}

function getConsumerConfig(env: ConsumerEnv): IngestCoreConfig {
  return {
    finwiseApiKey: env.FINWISE_API_KEY,
    finwiseBaseUrl: env.FINWISE_BASE_URL || "https://api.finwiseapp.io",
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_KEY,
    bankZeroAccountId: env.BANK_ZERO_ACCOUNT_ID ?? "",
    bankZeroAccountMap: parseBankZeroAccountMapJson(env.BANK_ZERO_ACCOUNT_MAP ?? "[]"),
    uploadToFinwise:
      env.UPLOAD_TO_FINWISE === "true" || env.UPLOAD_TO_FINWISE === "1",
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
    throw new Error(`Unsupported ingest message version: ${String((body as { v?: unknown }).v)}`);
  }

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
        console.log(
          JSON.stringify({
            level: "error",
            msg: "queue_message_failed",
            err: err instanceof Error ? err.message : String(err),
            job_id: message.body.job_id,
          }),
        );
        message.retry();
      }
    }
  },
};
