import { SupabaseClient } from "@supabase/supabase-js";
import type { TwentyTwoSevenTransaction } from "../22seven/types";

/**
 * Defines the shape of a new row for the 'transactions' table.
 */
export type NewTransactionRow = {
  id: string;
  account_id: string;
  date: string;
  details: TwentyTwoSevenTransaction;
};

/**
 * Fetches all existing transaction IDs from the database.
 *
 * @param supabase The Supabase client instance.
 * @returns A Set<string> containing all existing transaction IDs.
 */
export async function getExistingTransactionKeys(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const PAGE_SIZE = 1000;
  const existingIds = new Set<string>();
  let from = 0;

  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("transactions")
      .select("id")
      .range(from, to);

    if (error) {
      throw new Error(`Supabase select error (transactions): ${error.message}`);
    }

    const page = (data ?? []) as { id: string }[];
    for (const row of page) existingIds.add(row.id);

    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return existingIds;
}

/**
 * Inserts a batch of new, transformed transactions into the database.
 *
 * @param supabase The Supabase client instance.
 * @param transactions An array of 'NewTransactionRow' objects to insert.
 */
export async function insertTransactions(
  supabase: SupabaseClient,
  transactions: NewTransactionRow[]
): Promise<void> {
  const { error } = await supabase
    .from("transactions")
    .upsert(transactions, { onConflict: "id" });

  if (error) {
    throw new Error(`Supabase insert error (transactions): ${error.message}`);
  }
}
