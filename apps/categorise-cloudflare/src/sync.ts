import { categorySlug, occurredOn, payloadHash } from "./ledger.js";
import { merchantNameOf, signedAmount, type FinwiseTxn } from "./finwise.js";
import type { FinanceRpc } from "./supabase.js";

export interface SyncWindow {
  accounts: {
    id: string;
    name: string;
    type: string | null;
    currencyCode?: string | null;
  }[];
  categories: { id: string; name: string; groupName?: string | null }[];
  transactions: FinwiseTxn[];
  merchants: ReadonlyMap<string, string>;
  categoryNames: ReadonlyMap<string, string>;
}

export interface SyncResult {
  syncedIds: Set<string>;
  upserted: number;
  failed: number;
  ownedByName: Map<string, string>;
}

export async function syncOverlapWindow(
  rpc: FinanceRpc,
  householdId: string,
  window: SyncWindow,
): Promise<SyncResult> {
  const syncRunId = await rpc.startSyncRun(householdId);
  let failed = 0;
  try {
    const accounts = await rpc.upsertAccounts(householdId, await Promise.all(window.accounts.map(accountPayload)));
    failed += accounts.failed;
    const accountError = accounts.error;
    const categories = await rpc.upsertCategories(
      householdId,
      await Promise.all(window.categories.map(categoryPayload)),
    );
    failed += categories.failed;
    const ownedByName = new Map(categories.mapped.map((row) => [row.name, row.ownedCategoryId]));
    const transactions = await rpc.upsertTransactions(
      householdId,
      syncRunId,
      await Promise.all(window.transactions.map((txn) => transactionPayload(txn, window))),
    );
    failed += transactions.failed;
    const error = [accountError, categories.error, transactions.error].filter(Boolean).join("; ").slice(0, 180);
    await rpc.finishSyncRun(syncRunId, failed === 0 ? "succeeded" : "failed", failed === 0 ? null : error || `${failed} rows failed`);
    return {
      syncedIds: new Set(transactions.ids),
      upserted: transactions.ids.length,
      failed,
      ownedByName,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "sync failed";
    await rpc.finishSyncRun(syncRunId, "failed", message.slice(0, 180)).catch(() => undefined);
    throw err;
  }
}

async function accountPayload(account: SyncWindow["accounts"][number]): Promise<Record<string, unknown>> {
  const payload = {
    id: account.id,
    name: account.name,
    type: account.type,
    currencyCode: account.currencyCode ?? null,
  };
  return { ...payload, rawPayloadHash: await payloadHash(payload) };
}

async function categoryPayload(category: SyncWindow["categories"][number]): Promise<Record<string, unknown>> {
  const payload = {
    id: category.id,
    name: category.name,
    slug: categorySlug(category.name, category.id),
    groupName: category.groupName ?? null,
  };
  return { ...payload, rawPayloadHash: await payloadHash(payload) };
}

async function transactionPayload(txn: FinwiseTxn, window: SyncWindow): Promise<Record<string, unknown>> {
  const amount = txn.amount?.amount == null ? null : signedAmount(txn);
  const payload = {
    id: txn.id,
    accountId: txn.accountId,
    date: txn.date,
    effectiveDate: txn.effectiveDate ?? null,
    description: txn.description,
    originalDescription: txn.originalDescription ?? null,
    amount: Number.isFinite(amount) ? amount : null,
    currencyCode: txn.amount?.currencyCode ?? null,
    occurredOn: occurredOn(txn.date),
    transactionCategoryId: txn.transactionCategoryId,
    categoryName: txn.transactionCategoryId ? window.categoryNames.get(txn.transactionCategoryId) ?? null : null,
    originalTransactionCategoryId: txn.originalTransactionCategoryId,
    merchantId: txn.merchantId,
    merchantName: merchantNameOf(txn, window.merchants),
    parentTransactionId: txn.parentTransactionId ?? null,
    isTransfer: txn.isTransfer,
    isPending: txn.isPending ?? null,
    archived: Boolean(txn.archivedAt),
    updatedAt: txn.updatedAt,
    notes: txn.notes,
  };
  return { ...payload, rawPayloadHash: await payloadHash(payload) };
}
