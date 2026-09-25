import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FinWiseClient, type Transaction } from "../../libs/finwise/src/index.js";
import { temporalSplit, toFeatures } from "../../libs/categoriser/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

async function listAll(client: FinWiseClient): Promise<Transaction[]> {
  const out: Transaction[] = [];
  for (let page = 1; page <= 80; page++) {
    const batch = await client.transactions.list({
      filters: { fromDate: "2023-01-01", toDate: "2026-09-24", excludeArchived: true },
      pagination: { pageNumber: page, pageSize: 100 },
    });
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

async function main(): Promise<void> {
  if (process.env.LIVE_EVAL !== "1") {
    console.log("refusing without LIVE_EVAL=1");
    process.exit(1);
  }
  const client = new FinWiseClient({ apiKey: process.env.FINWISE_API_KEY ?? "" });
  const categories = await client.transactionCategories.list({ pagination: { pageSize: 100 } });
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const raw = await listAll(client);
  const rows = raw.map((txn) =>
    toFeatures({
      id: txn.id,
      date: txn.date,
      description: txn.description,
      amount: Number(txn.amount?.amount ?? 0),
      categoryId: txn.transactionCategoryId,
      categoryName: txn.transactionCategoryId ? nameById.get(txn.transactionCategoryId) ?? null : null,
      originalCategoryId: txn.originalTransactionCategoryId,
      accountId: txn.accountId,
    }),
  );
  const labelled = rows.filter((row) => row.categoryName);
  const split = temporalSplit(labelled);
  function agreement(set: typeof labelled) {
    const comparable = set.filter((row) => row.originalCategoryId);
    const hits = comparable.filter((row) => row.originalCategoryId === row.categoryId).length;
    return {
      n: set.length,
      comparable: comparable.length,
      missingOriginal: set.length - comparable.length,
      agreement: comparable.length === 0 ? null : Number((hits / comparable.length).toFixed(4)),
    };
  }
  const probe = raw.find((txn) => txn.transactionCategoryId && !txn.isPending);
  if (!probe) throw new Error("no probe row");
  const other = categories.find((category) => category.id !== probe.transactionCategoryId);
  if (!other) throw new Error("no alternate category");
  const beforeCategory = probe.transactionCategoryId;
  const beforeOriginal = probe.originalTransactionCategoryId;
  const patched = await client.transactions.update(probe.id, { transactionCategoryId: other.id });
  const restored = await client.transactions.update(probe.id, { transactionCategoryId: beforeCategory });
  console.log(JSON.stringify({
    finwise: {
      all: agreement(labelled),
      final: agreement(split.final),
      tune: agreement(split.tune),
      reference: agreement(split.reference),
    },
    categoryPatch: {
      restored: restored.transactionCategoryId === beforeCategory,
      originalUnchanged: patched.originalTransactionCategoryId === beforeOriginal && restored.originalTransactionCategoryId === beforeOriginal,
      patchApplied: patched.transactionCategoryId === other.id,
    },
  }));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "baseline failed");
  process.exit(1);
});
