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
  const { data, error } = await supabase.from("transactions").select("id");

  if (error) {
    throw new Error(`Supabase select error (transactions): ${error.message}`);
  }

  return new Set(data.map((row) => row.id));
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
  const { error } = await supabase.from("transactions").insert(transactions);

  if (error) {
    throw new Error(`Supabase insert error (transactions): ${error.message}`);
  }
}
