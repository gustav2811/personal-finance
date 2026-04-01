import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestCoreConfig } from "../config.js";

const DLQ_TABLE = "dlq_ingest_jobs";

export interface DlqEntry {
  job_id: string;
  message_id: string;
  bank: string;
  error: string;
  payload: Record<string, unknown>;
}

let supabase: SupabaseClient | null = null;

function getSupabase(config: IngestCoreConfig): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  return supabase;
}

export async function sendToDlq(
  config: IngestCoreConfig,
  entry: DlqEntry,
): Promise<void> {
  const client = getSupabase(config);
  await client.from(DLQ_TABLE).insert({
    job_id: entry.job_id,
    message_id: entry.message_id,
    bank: entry.bank,
    error: entry.error,
    payload: entry.payload,
  });
}

/** Count DLQ rows with `created_at >= since` (cheap `head: true` query). */
export async function countDlqSince(
  config: IngestCoreConfig,
  since: Date,
): Promise<{ count: number; error: string | null }> {
  if (!config.supabaseUrl?.trim() || !config.supabaseServiceRoleKey?.trim()) {
    return { count: 0, error: null };
  }
  const client = getSupabase(config);
  const { count, error } = await client
    .from(DLQ_TABLE)
    .select("*", { count: "exact", head: true })
    .gte("created_at", since.toISOString());
  if (error) {
    return { count: 0, error: error.message };
  }
  return { count: count ?? 0, error: null };
}

const PROCESSED_TABLE = "processed_transactions";

export interface ProcessedStore {
  has(externalId: string): Promise<boolean>;
  add(externalId: string): Promise<void>;
}

export function createProcessedStore(config: IngestCoreConfig): ProcessedStore {
  return {
    async has(externalId: string): Promise<boolean> {
      const client = getSupabase(config);
      const { data, error } = await client
        .from(PROCESSED_TABLE)
        .select("external_id")
        .eq("external_id", externalId)
        .limit(1)
        .maybeSingle();
      if (error) return false;
      return data != null;
    },
    async add(externalId: string): Promise<void> {
      const client = getSupabase(config);
      await client.from(PROCESSED_TABLE).upsert(
        { external_id: externalId, created_at: new Date().toISOString() },
        { onConflict: "external_id" },
      );
    },
  };
}
