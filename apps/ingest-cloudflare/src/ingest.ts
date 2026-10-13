import * as Sentry from "@sentry/cloudflare";
import { sentryOptions } from "./sentry.js";
import type { IngestQueueMessageV1 } from "@investments/ingest-core";
import { resolveBankZeroOwner } from "./bank-zero-owner.js";

export interface IngestEnv {
  INGEST_BUCKET: R2Bucket;
  INGEST_QUEUE: Queue<IngestQueueMessageV1>;
  INGEST_TOKEN: string;
  /** JSON object of trusted profile route keys to independent webhook tokens. */
  INGEST_ROUTE_TOKENS_JSON?: string;
  /** Comma-separated profiles allowed to become routable from shared delivery. */
  INGEST_OWNER_PROFILES?: string;
  SENTRY_DSN: string;
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

function routeForToken(rawRoutes: string | undefined, token: string): string | undefined {
  if (!rawRoutes?.trim()) return undefined;
  const routes: unknown = JSON.parse(rawRoutes);
  if (typeof routes !== "object" || routes === null || Array.isArray(routes)) {
    throw new Error("INGEST_ROUTE_TOKENS_JSON must be an object");
  }
  for (const [routeKey, routeToken] of Object.entries(routes)) {
    if (
      /^[a-z0-9_-]{1,64}$/.test(routeKey) &&
      typeof routeToken === "string" &&
      routeToken.length > 0 &&
      routeToken === token
    ) {
      return routeKey;
    }
  }
  return undefined;
}

async function sha256Hex(value: ArrayBuffer | string): Promise<string> {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const handler = {
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
    if (!token) {
      return unauthorized();
    }

    let routeKey: string | undefined;
    try {
      routeKey = routeForToken(env.INGEST_ROUTE_TOKENS_JSON, token);
    } catch (error) {
      console.log(JSON.stringify({
        level: "error",
        msg: "ingest_route_configuration_invalid",
        component: "ingest-producer",
        error: error instanceof Error ? error.message : String(error),
      }));
      return jsonResponse({ error: "Invalid route configuration" }, 500);
    }
    if (token !== env.INGEST_TOKEN && !routeKey) return unauthorized();

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("multipart/form-data")) {
      return jsonResponse({ error: "Expected multipart form data" }, 400);
    }

    const job_id = crypto.randomUUID();
    const delivery_id = job_id;
    const received_at = new Date().toISOString();
    const prefix = `ingest/${job_id}/`;

    const formData = await request.formData();
    const fields: Record<string, string> = {};
    const attachments: IngestQueueMessageV1["attachments"] = [];
    let email_r2_key: string | undefined;
    let raw_email_sha256: string | undefined;
    let rawEmail: string | undefined;

    let fileIdx = 0;
    // workers-types declare entries() as [string, string][]; file parts are File at runtime.
    const entries = formData.entries() as IterableIterator<[string, string | File]>;
    for (const [key, value] of entries) {
      if (value instanceof File) {
        const r2_key = `${prefix}files/${fileIdx}`;
        fileIdx += 1;
        const filename = value.name || "attachment";
        const mimetype = value.type || "application/octet-stream";
        const bytes = await value.arrayBuffer();
        const sha256 = await sha256Hex(bytes);
        await env.INGEST_BUCKET.put(r2_key, bytes, {
          httpMetadata: { contentType: mimetype },
          customMetadata: {
            sha256,
            received_at,
            delivery_id,
            ...(routeKey ? { route_key: routeKey } : {}),
          },
        });
        attachments.push({
          fieldname: key,
          filename,
          mimetype,
          r2_key,
          sha256,
        });
      } else {
        const s = typeof value === "string" ? value : String(value);
        if (key === "email") {
          // Keep every original message replayable from the same durable source,
          // regardless of size. Inline messages were previously omitted from
          // some recovery metadata, making their evidence unavailable on replay.
          const ek = `${prefix}email.raw`;
          const sha256 = await sha256Hex(s);
          rawEmail = s;
          await env.INGEST_BUCKET.put(ek, s, {
            httpMetadata: { contentType: "message/rfc822" },
            customMetadata: {
              sha256,
              received_at,
              delivery_id,
              ...(routeKey ? { route_key: routeKey } : {}),
            },
          });
          email_r2_key = ek;
          raw_email_sha256 = sha256;
        } else {
          fields[key] = s;
        }
      }
    }

    const owner = resolveBankZeroOwner({
      rawEmail,
      transportHeaders: fields.headers,
      routeKey,
      enabledProfiles: env.INGEST_OWNER_PROFILES,
    });
    // These fields are written by the receiver and survive queue retries and
    // DLQ replay. They are deliberately separate from route_key: a disabled
    // or ambiguous observed owner must remain unverified.
    delete fields["__bank_zero_observed_owner"];
    delete fields["__bank_zero_owner_basis"];
    delete fields["__bank_zero_owner_status"];
    fields["__bank_zero_owner_status"] = owner.status;
    if (owner.observedProfile) fields["__bank_zero_observed_owner"] = owner.observedProfile;
    if (owner.basis) fields["__bank_zero_owner_basis"] = owner.basis;
    routeKey = owner.routeKey;

    const message: IngestQueueMessageV1 = {
      v: 1,
      job_id,
      delivery_id,
      received_at,
      ...(routeKey ? { route_key: routeKey } : {}),
      fields,
      attachments,
      ...(email_r2_key !== undefined ? { email_r2_key } : {}),
      ...(raw_email_sha256 !== undefined ? { raw_email_sha256 } : {}),
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

export default Sentry.withSentry(sentryOptions, handler);
