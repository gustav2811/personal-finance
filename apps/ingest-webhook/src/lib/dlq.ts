import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestWebhookConfig } from "../config.js";

const DLQ_TABLE = "dlq_ingest_jobs";

export interface DlqEntry {
  job_id: string;
  message_id: string;
  bank: string;
  error: string;
  payload: Record<string, unknown>;
}

let supabase: SupabaseClient | null = null;

function getSupabase(config: IngestWebhookConfig): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  }
  return supabase;
}

export async function sendToDlq(
  config: IngestWebhookConfig,
  entry: DlqEntry
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

const PROCESSED_TABLE = "processed_transactions";

export interface ProcessedStore {
  has(externalId: string): Promise<boolean>;
  add(externalId: string): Promise<void>;
}

export function createProcessedStore(
  config: IngestWebhookConfig
): ProcessedStore {
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
        { onConflict: "external_id" }
      );
    },
  };
}
