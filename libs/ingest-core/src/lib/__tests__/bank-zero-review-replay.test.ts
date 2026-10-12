import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc }) }));

import {
  claimBankZeroReviewReplayBatch,
  finishBankZeroReviewReplay,
} from "../bank-zero-review-replay.js";
import type { IngestCoreConfig } from "../../config.js";

const config: IngestCoreConfig = {
  finwiseApiKey: "test", finwiseBaseUrl: "https://example.test",
  supabaseUrl: "https://supabase.test", supabaseServiceRoleKey: "service-test",
  bankZeroAccountId: "", bankZeroAccountMap: [], uploadToFinwise: true,
  categorisationEnabled: false, geminiApiKey: "", geminiModel: "test",
  geminiApiBase: "https://example.test", categorisationLlmTimeoutMs: 1000,
  categorisationMinConfidence: 0.5,
};

const claim = {
  replay_request_id: "replay-1", observation_id: "observation-1",
  received_email_id: "email-1", route_key: "profile-a", original_message_id: "bank-message-1",
  raw_r2_key: "ingest/email-1/email.raw", raw_sha256: "a".repeat(64),
  received_at: "2026-10-12T08:00:00Z", receipt_metadata: { attachmentPointers: [] },
  attempt_count: 1,
};

describe("Bank Zero review replay queue client", () => {
  beforeEach(() => rpc.mockReset());

  it("claims source pointers for current-parser replay", async () => {
    rpc.mockResolvedValue({ data: [claim], error: null });

    await expect(claimBankZeroReviewReplayBatch(config, "worker-1", 2)).resolves.toEqual([claim]);
    expect(rpc).toHaveBeenCalledWith("bank_zero_claim_review_replays_v1", {
      p_worker_id: "worker-1", p_limit: 2,
    });
  });

  it("rejects malformed claim data instead of processing incomplete source", async () => {
    rpc.mockResolvedValue({ data: [{ ...claim, raw_r2_key: null }], error: null });

    await expect(claimBankZeroReviewReplayBatch(config, "worker-1")).rejects.toThrow(
      "Bank Zero replay claim returned an invalid item shape",
    );
  });

  it("persists completion and bounded retry outcomes through the service RPC", async () => {
    rpc.mockResolvedValue({ data: null, error: null });

    await finishBankZeroReviewReplay(config, "replay-1", "worker-1", {
      succeeded: true, details: { parser: "current" },
    });
    expect(rpc).toHaveBeenLastCalledWith("bank_zero_finish_review_replay_v1", expect.objectContaining({
      p_replay_request_id: "replay-1", p_worker_id: "worker-1", p_succeeded: true,
      p_result: { parser: "current" }, p_retry_delay_seconds: 0, p_terminal: false,
    }));

    await finishBankZeroReviewReplay(config, "replay-1", "worker-1", {
      succeeded: false, error: "temporary outage", retryDelaySeconds: 120, terminal: false,
    });
    expect(rpc).toHaveBeenLastCalledWith("bank_zero_finish_review_replay_v1", expect.objectContaining({
      p_succeeded: false, p_error: "temporary outage", p_retry_delay_seconds: 120, p_terminal: false,
    }));
  });
});
