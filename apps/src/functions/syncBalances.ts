import { getConfig } from "../config";
import { getSupabaseClient } from "../lib/supabase";
import { loginTwentyTwoSeven, fetchAllSnapshots } from "../22seven/22seven";
import {
  normalizeTimestampToDateString,
  logInfo,
  logError,
  chunk,
} from "../lib/utils";
import { getAccountMap } from "../repos/accounts";
import {
  getExistingSnapshotKeys,
  insertSnapshots,
  type NewSnapshotRow,
} from "../repos/snapshots";

export async function syncSnapshots(): Promise<void> {
  try {
    const cfg = getConfig();

    logInfo("Step 1/6: Authenticating with 22seven...");
    const tokens = await loginTwentyTwoSeven(cfg);
    logInfo("-> Login successful.");

    const supabase = getSupabaseClient();

    logInfo("Step 2/6: Fetching internal account map from Supabase...");
    const accountMap = await getAccountMap(supabase);
    logInfo("-> Accounts loaded.", { count: accountMap.size });

    logInfo("Step 3/6: Fetching existing snapshot keys from Supabase...");
    const existingKeys = await getExistingSnapshotKeys(supabase);
    logInfo("-> Existing snapshot keys loaded.", { count: existingKeys.size });

    logInfo("Step 4/6: Fetching all snapshots from 22seven...");
    const allSnapshots = await fetchAllSnapshots(tokens);
    logInfo("-> Snapshots fetched from 22seven.", {
      count: allSnapshots.length,
    });

    logInfo("Step 5/6: Transforming and filtering for new snapshots...");
    const toInsert: NewSnapshotRow[] = [];
    for (const snapshot of allSnapshots) {
      const internalAccountId = accountMap.get(snapshot.accountId);
      if (!internalAccountId) continue;
      const date = normalizeTimestampToDateString(snapshot.date as number);
      const key = `${internalAccountId}-${date}`;
      if (existingKeys.has(key)) continue;
      const amount_cents = Math.round(snapshot.amount.amount * 100);
      toInsert.push({
        account_id: internalAccountId,
        date,
        amount_cents,
        currency_code: snapshot.amount.currencyCode,
      });
    }

    if (toInsert.length > 0) {
      const BATCH_SIZE = 500;
      const chunks = chunk(toInsert, BATCH_SIZE);
      logInfo("Step 6/6: Inserting new snapshots...", {
        count: toInsert.length,
        batches: chunks.length,
        batch_size: BATCH_SIZE,
      });
      for (let i = 0; i < chunks.length; i++) {
        const part = chunks[i];
        logInfo("Inserting batch", { batch_index: i + 1, size: part.length });
        await insertSnapshots(supabase, part);
      }
      logInfo("--- COMPLETE ---");
      logInfo("New snapshots successfully added to Supabase.", {
        inserted: toInsert.length,
      });
    } else {
      logInfo("Step 6/6: No new snapshots found.");
      logInfo("--- COMPLETE ---");
      logInfo("Database is already up-to-date.");
    }
  } catch (err) {
    const message = (err as any)?.message ?? String(err);
    logError("Script error", { message });
    throw err;
  }
}
