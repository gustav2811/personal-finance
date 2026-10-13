import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestCoreConfig } from "../config.js";

type RetentionClaim = {
  received_email_id: string;
  raw_r2_key: string;
  attachment_pointers: Array<{ r2Key?: unknown }>;
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

function claimsFrom(value: unknown): RetentionClaim[] {
  if (!Array.isArray(value)) throw new Error("Source expiration claim returned an invalid list");
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("Source expiration claim returned an invalid record");
    }
    const row = item as Record<string, unknown>;
    if (typeof row.received_email_id !== "string" || typeof row.raw_r2_key !== "string" ||
      !Array.isArray(row.attachment_pointers)) {
      throw new Error("Source expiration claim returned an invalid record shape");
    }
    return row as unknown as RetentionClaim;
  });
}

function sourceKeys(claim: RetentionClaim): string[] {
  const attachmentKeys: string[] = [];
  for (const attachment of claim.attachment_pointers) {
    if (!attachment || typeof attachment.r2Key !== "string") {
      throw new Error("Source expiration claim contains an invalid attachment pointer");
    }
    attachmentKeys.push(attachment.r2Key);
  }
  const prefix = claim.raw_r2_key.replace(/email\.raw$/, "");
  const keys = [...new Set([...attachmentKeys, claim.raw_r2_key])];
  if (!/^ingest\/[a-f0-9-]+\/$/.test(prefix) || keys.some((key) => !key.startsWith(prefix))) {
    throw new Error("Source expiration claim contains a pointer outside its ingest identity");
  }
  return [...new Set(keys)];
}

/** Deletes only closed source records after the database's 180-day eligibility check. */
export async function expireBankZeroSourceBatch(
  config: IngestCoreConfig,
  deleteObject: (key: string) => Promise<void>,
  limit = 20,
): Promise<{ claimed: number; expired: number; deferred: number }> {
  const client = clientFor(config);
  const { data, error } = await client.rpc("bank_zero_claim_source_expiration_v1", { p_limit: limit });
  if (error) throw new Error(`Could not claim expired Bank Zero sources: ${error.message}`);
  const claims = claimsFrom(data);
  let expired = 0;
  let deferred = 0;

  for (const claim of claims) {
    let deleted = false;
    try {
      for (const key of sourceKeys(claim)) await deleteObject(key);
      deleted = true;
      expired++;
    } catch {
      deferred++;
    }
    const { error: finishError } = await client.rpc("bank_zero_finish_source_expiration_v1", {
      p_received_email_id: claim.received_email_id,
      p_deleted: deleted,
    });
    if (finishError) throw new Error(`Could not record Bank Zero source expiration: ${finishError.message}`);
  }
  return { claimed: claims.length, expired, deferred };
}
