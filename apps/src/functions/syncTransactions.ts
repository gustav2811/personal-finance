import { getConfig } from "../config";
import { getSupabaseClient } from "../lib/supabase";
import { logInfo, logError, chunk } from "../lib/utils";
import { loginTwentyTwoSeven, fetchAllTransactions } from "../22seven/22seven";
import { getAccountMap } from "../repos/accounts";
import {
  insertTransactions,
  type NewTransactionRow,
} from "../repos/transactions";

/**
 * This is the main orchestrator function for syncing transactions.
 *
 * 1. Logs in to 22seven.
 * 2. Fetches account map & existing transaction keys from Supabase.
 * 3. Fetches ALL (hot + cold) transactions from 22seven.
 * 4. De-dupes and transforms the data to match our schema.
 * 5. Logs any transactions for unknown accounts.
 * 6. Batch-inserts only the new transactions into Supabase.
 */
export async function syncTransactions(): Promise<void> {
  logInfo("--- Starting Transaction Sync ---");
  const cfg = getConfig();
  const supabase = getSupabaseClient();

  try {
    // --- Step 1: Authenticate ---
    logInfo("Step 1/6: Authenticating with 22seven...");
    const tokens = await loginTwentyTwoSeven(cfg);
    logInfo("-> Login successful.");

    // --- Step 2: Get Account Map ---
    logInfo("Step 2/6: Fetching internal account map from Supabase...");
    const accountMap = await getAccountMap(supabase);
    logInfo("-> Accounts loaded.", { count: accountMap.size });

    // --- Step 3: Fetch ALL from 22seven ---
    logInfo("Step 3/5: Fetching ALL (hot + cold) transactions...");
    const allTransactions = await fetchAllTransactions(tokens);
    logInfo("-> All transactions fetched.", { count: allTransactions.length });

    // --- Step 4: Transform & Filter ---
    logInfo("Step 4/5: Transforming and filtering for sync...");
    const toSync: NewTransactionRow[] = [];

    // This Set tracks unknown accounts so we only log them once per run
    const unknownAccountIds = new Set<string>();

    for (const tx of allTransactions) {
      // 2. Translate 22seven ID to our internal UUID
      const internalAccountId = accountMap.get(tx.accountId);

      // 3. Handle transactions for accounts we don't track
      if (!internalAccountId) {
        if (!unknownAccountIds.has(tx.accountId)) {
          logInfo("Found transactions for unknown account. Skipping.", {
            unknownAccountId: tx.accountId,
            transactionDescription: tx.description,
          });
          unknownAccountIds.add(tx.accountId);
        }
        continue;
      }

      // 4. Transform for upsert.
      toSync.push({
        id: tx.id,
        account_id: internalAccountId,
        date: new Date(tx.transactionDate).toISOString(),
        details: tx,
      });
    }

    // --- Step 5: Batch Sync Data ---
    if (toSync.length > 0) {
      logInfo(
        `Step 5/5: Syncing ${toSync.length} transactions (insert/update)...`,
      );

      const batches = chunk(toSync, 500);
      for (const [index, batch] of batches.entries()) {
        logInfo(`-> Syncing batch ${index + 1}/${batches.length}`, {
          size: batch.length,
        });
        await insertTransactions(supabase, batch);
      }
      logInfo("--- Transaction Sync COMPLETE ---");
      logInfo("Transactions successfully synced.", {
        synced: toSync.length,
      });
    } else {
      logInfo("Step 5/5: No transactions found to sync.");
      logInfo("--- Transaction Sync COMPLETE ---");
    }
  } catch (err) {
    const message = (err as any)?.message ?? String(err);
    logError("Transaction Sync Script error", { message });

    throw err;
  }
}

syncTransactions();
