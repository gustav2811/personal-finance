import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FinWiseClient, type Transaction } from "../../libs/finwise/src/index.js";
import {
  DEV_END,
  DEV_START,
  SACRED_START,
  applyAdjudication,
  labelledAccuracy,
  toFeatures,
} from "../../libs/categoriser/src/index.js";
import { APRIL_JUNE_2026_V1 } from "./gold/april-june-2026-v1.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });
const SA = "Africa/Johannesburg";

interface SavedCall {
  id: string;
  arm: string;
  predicted: string | null;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function utcDay(iso: string): string {
  return iso.slice(0, 10);
}

function saDay(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function inWindow(day: string): boolean {
  return day >= DEV_START && day < DEV_END;
}

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

function score(
  rows: readonly { id: string; actual: string }[],
  predicted: ReadonlyMap<string, string | null>,
): { n: number; hits: number; accuracy: number } {
  const scored = rows.map((row) => ({ actual: row.actual, predicted: predicted.get(row.id) ?? null }));
  const hits = scored.filter((row) => row.predicted === row.actual).length;
  return { n: scored.length, hits, accuracy: labelledAccuracy(scored) };
}

async function main(): Promise<void> {
  const client = new FinWiseClient({
    apiKey: required("FINWISE_API_KEY"),
    baseUrl: process.env.FINWISE_BASE_URL,
  });
  const [categories, rawTxns] = await Promise.all([
    client.transactionCategories.list({ pagination: { pageNumber: 1, pageSize: 100 } }),
    listAll(client),
  ]);
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const rows = rawTxns.map((txn) => toFeatures({
    id: txn.id,
    date: txn.date,
    description: txn.description,
    amount: Number(txn.amount?.amount ?? 0),
    categoryName: txn.transactionCategoryId ? nameById.get(txn.transactionCategoryId) ?? null : null,
    accountId: txn.accountId,
    isTransfer: txn.isTransfer,
  }));
  const sacred = rows.filter((row) => saDay(row.date) >= SACRED_START);
  const checkpointPath = path.join(root, "reports", "categoriser", "v2-checkpoint.json");
  if (!existsSync(checkpointPath)) throw new Error("missing v2 checkpoint");
  const saved = JSON.parse(readFileSync(checkpointPath, "utf8")) as SavedCall[];
  const v8full = new Map(saved.filter((call) => call.arm === "v8full").map((call) => [call.id, call.predicted]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const utcLabelled = rows.filter((row) => row.categoryName && inWindow(utcDay(row.date)));
  const saLabelled = rows.filter((row) => row.categoryName && inWindow(saDay(row.date)));
  const saActive = rows.filter((row) => inWindow(saDay(row.date)));
  const snapshotIds = new Set(v8full.keys());
  const utcIds = new Set(utcLabelled.map((row) => row.id));
  const onlySnapshot = [...snapshotIds].filter((id) => !utcIds.has(id));
  const onlyLiveUtc = [...utcIds].filter((id) => !snapshotIds.has(id));
  const onlyLiveSa = saLabelled.filter((row) => !snapshotIds.has(row.id)).map((row) => row.id);
  const intersection = utcLabelled.filter((row) => snapshotIds.has(row.id));
  const ledger = intersection.map((row) => ({
    id: row.id,
    categoryName: row.categoryName,
    isTransfer: row.isTransfer,
  }));
  const applied = applyAdjudication(ledger, APRIL_JUNE_2026_V1.legs);
  const ledgerScore = score(intersection.flatMap((row) => row.categoryName ? [{ id: row.id, actual: row.categoryName }] : []), v8full);
  const goldScore = score(applied.strict.map((row) => ({ id: row.id, actual: row.actual })), v8full);
  const flips = applied.strict.flatMap((row) => {
    const live = byId.get(row.id);
    const predicted = v8full.get(row.id) ?? null;
    if (!live?.categoryName || live.categoryName === row.actual) return [];
    return [{
      id: row.id,
      ledger: live.categoryName,
      gold: row.actual,
      predicted,
      ledgerHit: predicted === live.categoryName,
      goldHit: predicted === row.actual,
    }];
  });
  const heldPredictions = applied.held.map((id) => ({
    id,
    ledger: byId.get(id)?.categoryName ?? null,
    predicted: v8full.get(id) ?? null,
  }));
  if (APRIL_JUNE_2026_V1.legs.some((leg) => sacred.some((row) => row.id === leg.id))) {
    throw new Error("overlay touches the sacred window");
  }
  const correctionIds = new Set([
    "ae8f0dcf-1445-47ea-813e-db4b9842f0b0",
    "11c9ee2f-cfdc-4225-9f7e-ca95c8edbe10",
    "6aa22e7f-a0d3-42bc-b862-93e60fdc92fa",
    "e030ed16-12e0-45a1-adca-93697f5925ba",
    "28ed9325-0914-43a0-bb8d-ef5e953b1b93",
  ]);
  const corrections = [...correctionIds].map((id) => {
    const row = byId.get(id);
    return row ? { id, utc: utcDay(row.date), sa: saDay(row.date), category: row.categoryName, isTransfer: row.isTransfer } : { id, missing: true };
  });
  const outsideUtc = saLabelled
    .filter((row) => !inWindow(utcDay(row.date)))
    .map((row) => ({ id: row.id, utc: utcDay(row.date), sa: saDay(row.date), category: row.categoryName }));
  const report = {
    generatedAt: new Date().toISOString(),
    overlay: APRIL_JUNE_2026_V1.version,
    jevCalls: 0,
    sacredUntouched: sacred.length,
    snapshot: {
      v8full: v8full.size,
      note: "Cached April-June predictions. Dates were sliced in UTC.",
    },
    live: {
      activeJohannesburgAprilJune: saActive.length,
      labelledJohannesburg: saLabelled.length,
      labelledUtcSlice: utcLabelled.length,
      onlyInSnapshot: onlySnapshot,
      onlyInLiveUtc: onlyLiveUtc,
      onlyInLiveJohannesburg: onlyLiveSa,
      johannesburgOutsideUtcSlice: outsideUtc,
      adjacentLedger: corrections,
    },
    scores: {
      ledgerOnSnapshotIntersection: ledgerScore,
      goldStrict: goldScore,
      heldOut: heldPredictions,
      labelFlips: flips,
    },
  };
  const outDir = path.join(root, "reports", "categoriser");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "adjudicated-rescore.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "rescore failed");
  process.exit(1);
});
