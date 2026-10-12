import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestCoreConfig } from "../config.js";

export type BankZeroReplayClaim = {
  replay_request_id: string;
  observation_id: string;
  received_email_id: string;
  route_key: string;
  original_message_id: string | null;
  raw_r2_key: string;
  raw_sha256: string;
  received_at: string;
  receipt_metadata: Record<string, unknown>;
  attempt_count: number;
};

const clients = new Map<string, SupabaseClient>();

function clientFor(config: IngestCoreConfig): SupabaseClient {
  const key = `${config.supabaseUrl}\u0000${config.supabaseServiceRoleKey}`;
  let client = clients.get(key);
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.set(key, client);
  }
  return client;
}

function claimsFrom(value: unknown): BankZeroReplayClaim[] {
  if (!Array.isArray(value)) throw new Error("Bank Zero replay claim returned an invalid list");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Bank Zero replay claim returned an invalid item");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.replay_request_id !== "string" || typeof row.observation_id !== "string" ||
      typeof row.received_email_id !== "string" || typeof row.route_key !== "string" ||
      !(row.original_message_id === null || typeof row.original_message_id === "string") ||
      typeof row.raw_r2_key !== "string" || typeof row.raw_sha256 !== "string" ||
      typeof row.received_at !== "string" || !row.receipt_metadata ||
      typeof row.receipt_metadata !== "object" || Array.isArray(row.receipt_metadata) ||
      typeof row.attempt_count !== "number"
    ) throw new Error("Bank Zero replay claim returned an invalid item shape");
    return row as unknown as BankZeroReplayClaim;
  });
}

export async function claimBankZeroReviewReplayBatch(
  config: IngestCoreConfig,
  workerId: string,
  limit = 1,
): Promise<BankZeroReplayClaim[]> {
  const { data, error } = await clientFor(config).rpc("bank_zero_claim_review_replays_v1", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`Could not claim Bank Zero replay work: ${error.message}`);
  return claimsFrom(data);
}

export async function finishBankZeroReviewReplay(
  config: IngestCoreConfig,
  replayRequestId: string,
  workerId: string,
  result: { succeeded: true; details?: Record<string, unknown> } |
    { succeeded: false; error: string; retryDelaySeconds: number; terminal: boolean },
): Promise<void> {
  const { error } = await clientFor(config).rpc("bank_zero_finish_review_replay_v1", {
    p_replay_request_id: replayRequestId,
    p_worker_id: workerId,
    p_succeeded: result.succeeded,
    p_result: result.succeeded ? result.details ?? {} : null,
    p_error: result.succeeded ? null : result.error,
    p_retry_delay_seconds: result.succeeded ? 0 : result.retryDelaySeconds,
    p_terminal: result.succeeded ? false : result.terminal,
  });
  if (error) throw new Error(`Could not record Bank Zero replay result: ${error.message}`);
}
