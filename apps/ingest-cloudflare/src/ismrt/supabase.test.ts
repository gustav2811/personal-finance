import { describe, expect, it } from "vitest";
import { ConsumptionRpc } from "./supabase.js";

describe("ConsumptionRpc ownership provisioning", () => {
  it("sends the explicit household and wallet binding to the service RPC", async () => {
    let requestUrl = "";
    let requestBody: unknown;
    const rpc = new ConsumptionRpc(
      "https://example.supabase.co/",
      "service-key",
      async (input, init) => {
        requestUrl = String(input);
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ devices_assigned: 3 }), { status: 200 });
      },
    );

    await expect(
      rpc.provisionIsmrtOwnership(
        "00000000-0000-4000-8000-000000000001",
        "wallet-1",
      ),
    ).resolves.toEqual({ devices_assigned: 3 });

    expect(requestUrl).toBe(
      "https://example.supabase.co/rest/v1/rpc/provision_ismrt_consumption_ownership_v1",
    );
    expect(requestBody).toEqual({
      p_household_id: "00000000-0000-4000-8000-000000000001",
      p_wallet_external_id: "wallet-1",
      p_evidence: "ISMRT_HOUSEHOLD_ID configured on the ingest consumer",
    });
  });
});
