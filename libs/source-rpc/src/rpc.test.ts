import { describe, expect, it } from "vitest";
import { callServiceRoleRpc } from "./rpc.js";

describe("callServiceRoleRpc", () => {
  it("posts the named RPC with the service-role headers", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      seen = { url: String(input), init: init ?? {} };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await callServiceRoleRpc(
      "https://example.supabase.co/",
      "service-key",
      "ingest_consumption_batch",
      { p_payload: { devices: [] } },
      fetchImpl,
    );

    expect(seen?.url).toBe(
      "https://example.supabase.co/rest/v1/rpc/ingest_consumption_batch",
    );
    const headers = new Headers(seen?.init.headers);
    expect(headers.get("apikey")).toBe("service-key");
    expect(headers.get("Authorization")).toBe("Bearer service-key");
    expect(seen?.init.method).toBe("POST");
    expect(seen?.init.body).toBe(JSON.stringify({ p_payload: { devices: [] } }));
  });

  it("does not send an opaque secret API key as a bearer token", async () => {
    let seen: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen = init ?? {};
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await callServiceRoleRpc(
      "https://example.supabase.co",
      "sb_secret_test-key",
      "ingest_consumption_batch",
      { p_payload: { devices: [] } },
      fetchImpl,
    );

    const headers = new Headers(seen?.headers);
    expect(headers.get("apikey")).toBe("sb_secret_test-key");
    expect(headers.has("Authorization")).toBe(false);
  });
});
