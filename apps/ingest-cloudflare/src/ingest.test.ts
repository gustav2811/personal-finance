import { describe, expect, it } from "vitest";
import worker, { type IngestEnv } from "./ingest.js";

function mocks(): {
  env: IngestEnv;
  objects: Array<{ key: string; body: BodyInit | ReadableStream | null; options?: R2PutOptions }>;
  queued: unknown[];
} {
  const objects: Array<{ key: string; body: BodyInit | ReadableStream | null; options?: R2PutOptions }> = [];
  const queued: unknown[] = [];
  const env = {
    INGEST_BUCKET: {
      put: async (key: string, body: BodyInit | ReadableStream | null, options?: R2PutOptions) => {
        objects.push({ key, body, options });
        return {} as R2Object;
      },
    } as unknown as R2Bucket,
    INGEST_QUEUE: { send: async (message: unknown) => { queued.push(message); } } as unknown as Queue<never>,
    INGEST_TOKEN: "legacy-secret",
    INGEST_ROUTE_TOKENS_JSON: JSON.stringify({ gustav: "gustav-route-secret", cara: "cara-route-secret" }),
    SENTRY_DSN: "https://public@sentry.test.invalid/1",
  } satisfies IngestEnv;
  return { env, objects, queued };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe("Bank Zero webhook receipt", () => {
  it("writes raw MIME before queueing and carries a trusted profile route plus integrity metadata", async () => {
    const { env, objects, queued } = mocks();
    const raw = [
      "From: e-services@bankzerosa.co.za",
      "Message-ID: <sample@bankzero.test.invalid>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Paid R50.00 to Sample Merchant",
    ].join("\r\n");
    const request = new Request("https://ingest.test.invalid/webhook/sendgrid", {
      method: "POST",
      headers: { Authorization: "Bearer gustav-route-secret" },
      body: form({ email: raw, from: "e-services@bankzerosa.co.za", to: "untrusted-visible-to@test.invalid" }),
    });

    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(200);
    expect(objects).toHaveLength(1);
    expect(queued).toHaveLength(1);
    const message = queued[0] as Record<string, unknown>;
    expect(message.route_key).toBe("gustav");
    expect(message.email_r2_key).toBe(objects[0].key);
    expect(message.raw_email_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(message.delivery_id).toBe(message.job_id);
    expect(message.email).toBeUndefined();
    expect(objects[0].options?.customMetadata).toMatchObject({
      route_key: "gustav",
      sha256: message.raw_email_sha256,
      delivery_id: message.delivery_id,
    });
    expect(message.fields).toMatchObject({ to: "untrusted-visible-to@test.invalid" });
  });

  it("rejects an unknown receiving token without trusting a visible To header", async () => {
    const { env, objects, queued } = mocks();
    const request = new Request("https://ingest.test.invalid/webhook/sendgrid?token=not-configured", {
      method: "POST",
      body: form({ email: "From: e-services@bankzerosa.co.za\r\n\r\nbody", to: "gustav+bankzero@klingbiel.org" }),
    });
    const response = await worker.fetch(request, env, {} as ExecutionContext);
    expect(response.status).toBe(401);
    expect(objects).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });
});
