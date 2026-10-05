import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { IngestCoreConfig } from "../config.js";

const DLQ_TABLE = "dlq_ingest_jobs";

export interface DlqEntry {
  job_id: string;
  message_id: string;
  bank: string;
  error: string;
  payload: Record<string, unknown>;
  /** Requeue-safe source pointers. Inline email bodies are deliberately excluded. */
  replay_payload?: Record<string, unknown>;
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
    replay_payload: entry.replay_payload ?? null,
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
    .eq("status", "open")
    .gte("created_at", since.toISOString());
  if (error) {
    return { count: 0, error: error.message };
  }
  return { count: count ?? 0, error: null };
}

export type DlqGroup = { bank: string; error: string; count: number };

/** Small operational summary for the daily report; only unresolved work is actionable. */
export async function listOpenDlqGroupsSince(
  config: IngestCoreConfig,
  since: Date,
): Promise<{ groups: DlqGroup[]; error: string | null }> {
  const client = getSupabase(config);
  const { data, error } = await client
    .from(DLQ_TABLE)
    .select("bank,error")
    .eq("status", "open")
    .gte("created_at", since.toISOString());
  if (error) return { groups: [], error: error.message };
  const counts = new Map<string, DlqGroup>();
  for (const row of data ?? []) {
    const bank = String((row as { bank?: unknown }).bank ?? "unknown");
    const errorText = String((row as { error?: unknown }).error ?? "unknown");
    const key = `${bank}\u0000${errorText}`;
    const group = counts.get(key) ?? { bank, error: errorText, count: 0 };
    group.count += 1;
    counts.set(key, group);
  }
  return { groups: [...counts.values()].sort((a, b) => b.count - a.count), error: null };
}

const PROCESSED_TABLE = "processed_transactions";

export interface ProcessedStore {
  has(externalId: string): Promise<boolean>;
  add(externalId: string): Promise<void>;
  hasMany(externalIds: string[]): Promise<Set<string>>;
  addMany(externalIds: string[]): Promise<void>;
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
    async hasMany(externalIds: string[]): Promise<Set<string>> {
      if (externalIds.length === 0) return new Set();
      const client = getSupabase(config);
      const { data, error } = await client
        .from(PROCESSED_TABLE)
        .select("external_id")
        .in("external_id", externalIds);
      if (error) return new Set();
      return new Set((data ?? []).map((row) => (row as { external_id: string }).external_id));
    },
    async addMany(externalIds: string[]): Promise<void> {
      if (externalIds.length === 0) return;
      const client = getSupabase(config);
      const now = new Date().toISOString();
      await client.from(PROCESSED_TABLE).upsert(
        externalIds.map((id) => ({ external_id: id, created_at: now })),
        { onConflict: "external_id" },
      );
    },
  };
}
