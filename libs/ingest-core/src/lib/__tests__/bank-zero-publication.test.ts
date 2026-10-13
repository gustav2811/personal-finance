import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import { processBankZeroPublicationBatch } from "../bank-zero-publication.js";
import type { FinWiseClient } from "@investments/finwise";
import type { IngestCoreConfig } from "../../config.js";

const config: IngestCoreConfig = {
  finwiseApiKey: "test", finwiseBaseUrl: "https://example.test",
  supabaseUrl: "https://supabase.test", supabaseServiceRoleKey: "service-test",
  bankZeroAccountId: "", bankZeroAccountMap: [], uploadToFinwise: true,
  categorisationEnabled: false, geminiApiKey: "", geminiModel: "test",
  geminiApiBase: "https://example.test", categorisationLlmTimeoutMs: 1000,
  categorisationMinConfidence: 0.5,
};

const createClaim = {
  outbox_id: "outbox-1", operation_id: "operation-1", operation: "create",
  household_id: "household-1", movement_id: "movement-1", finwise_transaction_id: null,
  exact_request: { accountId: "account-1", description: "Merchant", date: "2026-10-12", amount: { amount: -12, currencyCode: "ZAR" } },
  attempt_count: 1,
};
const updateClaim = {
  outbox_id: "outbox-2", operation_id: "operation-2", operation: "update",
  household_id: "household-1", movement_id: "movement-1", finwise_transaction_id: "finwise-1",
  exact_request: {
    finwise_transaction_id: "finwise-1", account_id: "account-1", amount: -12,
    currency_code: "ZAR", expected: { description: "Merchant", notes: null },
    patch: { description: "Merchant — Gustav", notes: "Bank reference: ABC" },
  },
  attempt_count: 1,
};
const transferUpdateClaim = {
  outbox_id: "outbox-transfer", operation_id: "operation-transfer", operation: "update",
  household_id: "household-1", movement_id: "movement-transfer", finwise_transaction_id: "finwise-transfer",
  exact_request: {
    finwise_transaction_id: "finwise-transfer", account_id: "account-1", amount: -12,
    currency_code: "ZAR", expected: { description: "Transfer", notes: null, isTransfer: null },
    patch: { isTransfer: true },
  },
  attempt_count: 1,
};
const projectClaim = {
  outbox_id: "outbox-project", operation_id: "operation-1", operation: "project",
  household_id: "household-1", movement_id: "movement-1", finwise_transaction_id: "finwise-1",
  exact_request: { id: "finwise-1", accountId: "account-1", amount: -12, currencyCode: "ZAR", rawPayloadHash: "hash" },
  attempt_count: 1,
};

const finwiseTransaction = {
  id: "finwise-1", accountId: "account-1", date: "2026-10-12T10:00:00+02:00",
  amount: { amount: -12, currencyCode: "ZAR" }, description: "Merchant", updatedAt: "2026-10-12T08:00:00Z",
};

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

describe("Bank Zero publication recovery", () => {
  beforeEach(() => rpc.mockReset());

  it("records the returned remote ID and queues projection for the next claimed operation", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "bank_zero_claim_publication_v1") return { data: [createClaim], error: null };
      return { data: null, error: null };
    });
    const create = vi.fn().mockResolvedValue(finwiseTransaction);
    const finwise = { transactions: { create } } as unknown as FinWiseClient;

    const result = await processBankZeroPublicationBatch(config, finwise, "worker-1", logger);

    expect(result).toEqual({ claimed: 1, published: 0, deferred: 1 });
    expect(create).toHaveBeenCalledTimes(1);
    const calls = rpc.mock.calls.map(([name]) => name);
    expect(calls).not.toContain("finance_upsert_source_transaction");
    expect(rpc).toHaveBeenCalledWith("bank_zero_record_finwise_create_v1", expect.objectContaining({
      p_operation_id: "operation-1", p_finwise_transaction_id: "finwise-1",
    }));

    rpc.mockReset();
    rpc.mockImplementation(async (name: string) => {
      if (name === "bank_zero_claim_publication_v1") return { data: [projectClaim], error: null };
      if (name === "finance_start_sync_run") return { data: "sync-1", error: null };
      return { data: null, error: null };
    });
    const projected = await processBankZeroPublicationBatch(config, finwise, "worker-2", logger);
    expect(projected).toEqual({ claimed: 1, published: 1, deferred: 0 });
    expect(rpc).toHaveBeenCalledWith("finance_upsert_source_transaction", expect.objectContaining({ p_payload: projectClaim.exact_request }));
    expect(rpc).toHaveBeenCalledWith("bank_zero_finish_projection_v1", expect.objectContaining({ p_operation_id: "operation-1", p_succeeded: true }));
  });

  it("stops automatic creation after a response-loss outcome", async () => {
    let claimsRemaining = true;
    rpc.mockImplementation(async (name: string) => {
      if (name === "bank_zero_claim_publication_v1") {
        if (!claimsRemaining) return { data: [], error: null };
        return { data: [createClaim], error: null };
      }
      if (name === "bank_zero_finish_publication_v1") {
        claimsRemaining = false;
        return { data: null, error: null };
      }
      return { data: null, error: null };
    });
    const create = vi.fn().mockRejectedValue(new TypeError("network response was lost"));
    const finwise = { transactions: { create } } as unknown as FinWiseClient;

    const first = await processBankZeroPublicationBatch(config, finwise, "worker-1", logger);
    const second = await processBankZeroPublicationBatch(config, finwise, "worker-2", logger);

    expect(first).toEqual({ claimed: 1, published: 0, deferred: 1 });
    expect(second).toEqual({ claimed: 0, published: 0, deferred: 0 });
    expect(create).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("bank_zero_finish_publication_v1", expect.objectContaining({
      p_state: "outcome_unknown",
    }));
  });

  it("updates the retained remote ID and retries projection independently", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "bank_zero_claim_publication_v1") return { data: [updateClaim], error: null };
      if (name === "finance_start_sync_run") return { data: "sync-2", error: null };
      if (name === "finance_upsert_source_transaction") return { data: null, error: { message: "temporary DB outage" } };
      return { data: null, error: null };
    });
    const current = { ...finwiseTransaction, notes: null };
    const list = vi.fn().mockResolvedValue([current]);
    const update = vi.fn().mockResolvedValue({
      ...current, description: "Merchant — Gustav", notes: "Bank reference: ABC",
      updatedAt: "2026-10-12T08:10:00Z",
    });
    const create = vi.fn();
    const finwise = { transactions: { list, update, create } } as unknown as FinWiseClient;

    const result = await processBankZeroPublicationBatch(config, finwise, "worker-1", logger);

    expect(result).toEqual({ claimed: 1, published: 0, deferred: 1 });
    expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith("finwise-1", updateClaim.exact_request.patch);
    expect(rpc).toHaveBeenCalledWith("bank_zero_record_finwise_update_v1", expect.objectContaining({
      p_operation_id: "operation-2", p_finwise_transaction_id: "finwise-1",
    }));
    expect(rpc).not.toHaveBeenCalledWith("bank_zero_finish_projection_v1", expect.anything());
    expect(rpc).toHaveBeenCalledWith("bank_zero_record_finwise_update_v1", expect.objectContaining({ p_operation_id: "operation-2" }));
    expect(rpc).not.toHaveBeenCalledWith("bank_zero_finish_publication_v1", expect.anything());
  });

  it("holds an enrichment when the household changed the remote fields", async () => {
    rpc.mockImplementation(async (name: string) => name === "bank_zero_claim_publication_v1"
      ? { data: [updateClaim], error: null }
      : { data: null, error: null });
    const list = vi.fn().mockResolvedValue([{ ...finwiseTransaction, description: "Household edit", notes: null }]);
    const update = vi.fn();
    const finwise = { transactions: { list, update } } as unknown as FinWiseClient;

    const result = await processBankZeroPublicationBatch(config, finwise, "worker-1", logger);

    expect(result).toEqual({ claimed: 1, published: 0, deferred: 1 });
    expect(update).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("bank_zero_finish_publication_v1", expect.objectContaining({
      p_operation_id: "operation-2", p_state: "needs_review",
    }));
  });

  it("sets isTransfer on the retained FinWise identity after confirmed pairing", async () => {
    rpc.mockImplementation(async (name: string) => {
      if (name === "bank_zero_claim_publication_v1") return { data: [transferUpdateClaim], error: null };
      if (name === "finance_start_sync_run") return { data: "sync-transfer", error: null };
      return { data: null, error: null };
    });
    const current = { ...finwiseTransaction, id: "finwise-transfer", description: "Transfer", isTransfer: null, notes: null };
    const list = vi.fn().mockResolvedValue([current]);
    const update = vi.fn().mockResolvedValue({ ...current, isTransfer: true });
    const create = vi.fn();
    const finwise = { transactions: { list, update, create } } as unknown as FinWiseClient;

    const result = await processBankZeroPublicationBatch(config, finwise, "worker-1", logger);

    expect(result).toEqual({ claimed: 1, published: 0, deferred: 1 });
    expect(update).toHaveBeenCalledWith("finwise-transfer", { isTransfer: true });
    expect(create).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("bank_zero_record_finwise_update_v1", expect.objectContaining({
      p_operation_id: "operation-transfer", p_finwise_transaction_id: "finwise-transfer",
    }));
  });
});
