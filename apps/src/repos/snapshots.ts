import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeDate } from "../lib/utils";

export type DbSnapshotKey = {
  account_id: string;
  date: string; // 'YYYY-MM-DD'
};

export type NewSnapshotRow = {
  account_id: string;
  date: string; // 'YYYY-MM-DD'
  amount_cents: number;
  currency_code: string;
};

export async function getExistingSnapshotKeys(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("snapshots")
    .select("account_id, date");
  if (error) {
    throw new Error(`Supabase error (snapshots): ${error.message}`);
  }
  const set = new Set<string>();
  (data as DbSnapshotKey[] | null)?.forEach((snap) => {
    const normalized = normalizeDate(snap.date);
    set.add(`${snap.account_id}-${normalized}`);
  });
  return set;
}

export async function insertSnapshots(
  supabase: SupabaseClient,
  rows: NewSnapshotRow[]
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from("snapshots").insert(rows);
  if (error) {
    throw new Error(`Supabase insert error: ${error.message}`);
  }
}
