import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { expireBankZeroSourceBatch } from "../bank-zero-retention.js";
import type { IngestCoreConfig } from "../../config.js";

const config: IngestCoreConfig = {
  finwiseApiKey: "test", finwiseBaseUrl: "https://example.test",
  supabaseUrl: "https://supabase.test", supabaseServiceRoleKey: "service-test",
  bankZeroAccountId: "", bankZeroAccountMap: [], uploadToFinwise: true,
  categorisationEnabled: false, geminiApiKey: "", geminiModel: "test",
  geminiApiBase: "https://example.test", categorisationLlmTimeoutMs: 1000,
  categorisationMinConfidence: 0.5,
};

const claimed = {
  received_email_id: "email-1",
  raw_r2_key: "ingest/01234567-89ab-cdef-0123-456789abcdef/email.raw",
  attachment_pointers: [
    { r2Key: "ingest/01234567-89ab-cdef-0123-456789abcdef/files/0" },
  ],
};

describe("Bank Zero source retention", () => {
  beforeEach(() => rpc.mockReset());

  it("deletes the original and its attachments before marking the pointer expired", async () => {
    rpc.mockImplementation(async (name: string) => name === "bank_zero_claim_source_expiration_v1"
      ? { data: [claimed], error: null }
      : { data: null, error: null });
    const deleteObject = vi.fn().mockResolvedValue(undefined);

    const result = await expireBankZeroSourceBatch(config, deleteObject);

    expect(result).toEqual({ claimed: 1, expired: 1, deferred: 0 });
    expect(deleteObject).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls.at(-1)).toEqual(["bank_zero_finish_source_expiration_v1", {
      p_received_email_id: "email-1", p_deleted: true,
    }]);
  });

  it("releases the expiration claim when object deletion fails", async () => {
    rpc.mockImplementation(async (name: string) => name === "bank_zero_claim_source_expiration_v1"
      ? { data: [claimed], error: null }
      : { data: null, error: null });

    const result = await expireBankZeroSourceBatch(config, vi.fn().mockRejectedValue(new Error("R2 unavailable")));

    expect(result).toEqual({ claimed: 1, expired: 0, deferred: 1 });
    expect(rpc.mock.calls.at(-1)).toEqual(["bank_zero_finish_source_expiration_v1", {
      p_received_email_id: "email-1", p_deleted: false,
    }]);
  });
});
