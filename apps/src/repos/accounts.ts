import type { SupabaseClient } from "@supabase/supabase-js";

export type DbAccount = {
  account_id: string; // internal UUID
  source_account_id: string; // 22seven id
};

export async function getAccountMap(
  supabase: SupabaseClient
): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from("accounts")
    .select("account_id, source_account_id");

  if (error) {
    throw new Error(`Supabase error (accounts): ${error.message}`);
  }

  const accountMap = new Map<string, string>();
  (data as DbAccount[] | null)?.forEach((acc) => {
    if (acc?.source_account_id && acc?.account_id) {
      accountMap.set(acc.source_account_id, acc.account_id);
    }
  });
  return accountMap;
}
