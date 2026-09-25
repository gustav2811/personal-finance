import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { FinWiseClient, type Transaction } from "../../libs/finwise/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

const HOUSEHOLD_ID = "00000000-0000-4000-8000-000000000001";
const PAGE_SIZE = 100;
const UPSERT_SIZE = 200;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function occurredOn(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function listAll(client: FinWiseClient): Promise<Transaction[]> {
  const out: Transaction[] = [];
  for (let page = 1; page <= 400; page += 1) {
    const batch = await client.transactions.list({
      filters: { fromDate: "2000-01-01", toDate: "2027-01-01", excludeArchived: false },
      pagination: { pageNumber: page, pageSize: PAGE_SIZE },
    });
    out.push(...batch);
    if (batch.length < PAGE_SIZE) return out;
  }
  throw new Error("transaction page cap hit");
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error("missing supabase credentials");
  const finwise = new FinWiseClient({
    apiKey: required("FINWISE_API_KEY"),
    baseUrl: process.env.FINWISE_BASE_URL,
  });
  const db = createClient(url, key, { auth: { persistSession: false } });

  const [categories, merchants, accounts] = await Promise.all([
    finwise.transactionCategories.list({ pagination: { pageNumber: 1, pageSize: 100 } }),
    (async () => {
      const names = new Map<string, string>();
      for (let page = 1; page <= 20; page += 1) {
        const batch = await finwise.request<{ id: string; name: string }[]>(
          "GET",
          "/merchants",
          undefined,
          { pagination: { pageNumber: page, pageSize: 100 } },
        );
        if (!Array.isArray(batch) || batch.length === 0) break;
        for (const merchant of batch) names.set(merchant.id, merchant.name);
        if (batch.length < 100) break;
      }
      return names;
    })(),
    db.from("accounts").select("account_id").eq("source_system", "finwise"),
  ]);
  if (accounts.error) throw new Error(accounts.error.message);
  const accountIds = new Set((accounts.data ?? []).map((row) => row.account_id));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));
  const transactions = await listAll(finwise);
  const known = transactions.filter((txn) => accountIds.has(txn.accountId));
  const skippedAccounts = transactions.length - known.length;
  const now = new Date().toISOString();

  for (let index = 0; index < known.length; index += UPSERT_SIZE) {
    const slice = known.slice(index, index + UPSERT_SIZE).map((txn) => {
      const amount = txn.amount?.amount == null ? null : Number(txn.amount.amount);
      const payload = {
        id: txn.id,
        accountId: txn.accountId,
        date: txn.date,
        effectiveDate: txn.effectiveDate,
        description: txn.description,
        originalDescription: txn.originalDescription,
        amount: txn.amount,
        transactionCategoryId: txn.transactionCategoryId,
        originalTransactionCategoryId: txn.originalTransactionCategoryId,
        merchantId: txn.merchantId,
        parentTransactionId: txn.parentTransactionId,
        isTransfer: txn.isTransfer,
        isPending: txn.isPending,
        archivedAt: txn.archivedAt,
        updatedAt: txn.updatedAt,
      };
      return {
        id: txn.id,
        account_id: txn.accountId,
        date: txn.date,
        details: payload,
        household_id: HOUSEHOLD_ID,
        source_system: "finwise",
        source_transaction_id: txn.id,
        amount: Number.isFinite(amount) ? amount : null,
        currency_code: txn.amount?.currencyCode ?? null,
        occurred_on: occurredOn(txn.date),
        description: txn.description,
        lifecycle_status: txn.archivedAt ? "archived" : "imported",
        original_description: txn.originalDescription,
        source_category_id: txn.transactionCategoryId,
        source_category_name_snapshot: txn.transactionCategoryId
          ? categoryName.get(txn.transactionCategoryId) ?? null
          : null,
        source_updated_at: txn.updatedAt,
        source_last_seen_at: now,
        source_is_pending: txn.isPending,
        source_is_transfer: txn.isTransfer,
        source_is_archived: Boolean(txn.archivedAt),
        raw_payload_hash: hashPayload(payload),
        finwise_transaction_id: txn.id,
        publication_status: "source",
        effective_at: txn.effectiveDate,
        notes: txn.notes,
        merchant_name: txn.merchantId ? merchants.get(txn.merchantId) ?? null : null,
        merchant_source_id: txn.merchantId,
      };
    });
    const saved = await db.from("transactions").upsert(slice, { onConflict: "id" });
    if (saved.error) throw new Error(saved.error.message);
  }

  const loadedIds = new Set(known.map((txn) => txn.id));
  let parentsLinked = 0;
  for (const txn of known) {
    if (!txn.parentTransactionId || !loadedIds.has(txn.parentTransactionId)) continue;
    const updated = await db
      .from("transactions")
      .update({ parent_transaction_id: txn.parentTransactionId })
      .eq("id", txn.id)
      .eq("source_system", "finwise");
    if (updated.error) throw new Error(updated.error.message);
    parentsLinked += 1;
  }

  console.log(JSON.stringify({
    fetched: transactions.length,
    upserted: known.length,
    skippedUnknownAccount: skippedAccounts,
    parentsLinked,
  }));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "sync failed");
  process.exit(1);
});
