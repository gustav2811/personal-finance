import type { IngestQueueMessageV1 } from "@investments/ingest-core";

/** Raw MIME `email` field larger than this is stored in R2 to keep queue messages smaller. */
const EMAIL_R2_THRESHOLD_BYTES = 256 * 1024;

export interface IngestEnv {
  INGEST_BUCKET: R2Bucket;
  INGEST_QUEUE: Queue<IngestQueueMessageV1>;
  INGEST_TOKEN: string;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function unauthorized(): Response {
  return jsonResponse({ error: "Unauthorized" }, 401);
}

export default {
  async fetch(
    request: Request,
    env: IngestEnv,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/$/, "") || "/";
    // Match Railway Fastify route so SendGrid URL stays the same: .../webhook/sendgrid?token=...
    if (pathname !== "/webhook/sendgrid" && pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    const authHeader = request.headers.get("Authorization");
    const bearer =
      authHeader?.startsWith("Bearer ") === true
        ? authHeader.slice(7)
        : undefined;
    const token = url.searchParams.get("token") ?? bearer;
    if (!token || token !== env.INGEST_TOKEN) {
      return unauthorized();
    }

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonResponse({ error: "Expected multipart form data" }, 400);
    }

    const job_id = crypto.randomUUID();
    const prefix = `ingest/${job_id}/`;

    const formData = await request.formData();
    const fields: Record<string, string> = {};
    const attachments: IngestQueueMessageV1["attachments"] = [];
    let email: string | undefined;
    let email_r2_key: string | undefined;

    let fileIdx = 0;
    // workers-types declare entries() as [string, string][]; file parts are File at runtime.
    const entries = formData.entries() as IterableIterator<[string, string | File]>;
    for (const [key, value] of entries) {
      if (value instanceof File) {
        const r2_key = `${prefix}files/${fileIdx}`;
        fileIdx += 1;
        const filename = value.name || "attachment";
        const mimetype = value.type || "application/octet-stream";
        await env.INGEST_BUCKET.put(r2_key, value.stream(), {
          httpMetadata: { contentType: mimetype },
        });
        attachments.push({
          fieldname: key,
          filename,
          mimetype,
          r2_key,
        });
      } else {
        const s = typeof value === "string" ? value : String(value);
        if (key === "email") {
          if (s.length >= EMAIL_R2_THRESHOLD_BYTES) {
            const ek = `${prefix}email.raw`;
            await env.INGEST_BUCKET.put(ek, s, {
              httpMetadata: { contentType: "message/rfc822" },
            });
            email_r2_key = ek;
          } else {
            email = s;
          }
        } else {
          fields[key] = s;
        }
      }
    }

    const message: IngestQueueMessageV1 = {
      v: 1,
      job_id,
      fields,
      attachments,
      ...(email !== undefined ? { email } : {}),
      ...(email_r2_key !== undefined ? { email_r2_key } : {}),
    };

    await env.INGEST_QUEUE.send(message);

    console.log(
      JSON.stringify({
        level: "info",
        msg: "ingest_producer_queued",
        component: "ingest-producer",
        job_id,
        ...(email_r2_key !== undefined ? { email_r2_key } : {}),
        attachment_r2_keys: attachments.map((a) => a.r2_key),
        attachment_filenames: attachments.map((a) => a.filename),
        attachments_count: attachments.length,
      }),
    );

    return jsonResponse({ job_id, status: "queued" });
  },
};
