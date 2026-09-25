import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FinWiseClient, type Transaction } from "../../libs/finwise/src/index.js";
import {
  DEV_END,
  DEV_START,
  PURE_MEMORY,
  RELIABLE_MEMORY,
  SACRED_START,
  adjudicateDisagreement,
  isMovement,
  pastDestination,
  resolveRelations,
  runMemoryOracle,
  toFeatures,
  type AccountLookup,
  type MemoryOracleRow,
  type OracleThresholds,
  type ResolvedRelation,
  type TxFeatures,
} from "../../libs/categoriser/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

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

function dayOf(row: TxFeatures): string {
  return row.date.slice(0, 10);
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

async function merchantNames(client: FinWiseClient): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let page = 1; page <= 10; page++) {
    const batch = await client.request<{ id: string; name: string }[]>(
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
}

function pct(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

function sliceReport(
  name: string,
  items: readonly Joined[],
  thresholds: OracleThresholds,
): Record<string, unknown> {
  const wrong = items.filter((item) => !item.jevCorrect);
  const recoverable = wrong.filter((item) => item.oracle.recoverable);
  const unavailable = wrong.filter((item) => item.oracle.selected === null);
  const sameWrong = wrong.filter((item) =>
    item.oracle.selected !== null &&
    item.oracle.selected.majority === item.predicted &&
    item.predicted !== item.actual,
  );
  const pointsElsewhere = wrong.filter((item) =>
    !item.oracle.recoverable &&
    item.oracle.selected !== null &&
    item.oracle.selected.majority !== item.predicted,
  );
  const selectedCorrect = items.filter((item) => item.oracle.selected?.majority === item.actual).length;
  const selectedFired = items.filter((item) => item.oracle.selected).length;
  return {
    slice: name,
    thresholds,
    n: items.length,
    jevCorrect: items.filter((item) => item.jevCorrect).length,
    jevWrong: wrong.length,
    jevAccuracy: pct(items.filter((item) => item.jevCorrect).length, items.length),
    memorySelectedFired: selectedFired,
    memorySelectedAccuracyWhenFired: pct(selectedCorrect, selectedFired),
    memorySelectedCoverage: pct(selectedFired, items.length),
    jevWrongRecoverable: recoverable.length,
    jevWrongRecoverableFraction: pct(recoverable.length, wrong.length),
    jevWrongUnavailable: unavailable.length,
    jevWrongSameAnswer: sameWrong.length,
    jevWrongPointsElsewhere: pointsElsewhere.length,
    exclusive: {
      recoverable: recoverable.length,
      sameWrongOnly: sameWrong.filter((item) => !item.oracle.recoverable).length,
      unavailableOnly: unavailable.filter((item) => !item.oracle.recoverable).length,
      elsewhereOnly: pointsElsewhere.length,
    },
  };
}

interface Joined {
  row: TxFeatures;
  relation: ResolvedRelation | undefined;
  oracle: MemoryOracleRow;
  predicted: string | null;
  actual: string;
  jevCorrect: boolean;
  movement: boolean;
  purchase: boolean;
}

function pastLabels(
  row: TxFeatures,
  relation: ResolvedRelation | undefined,
  corpus: readonly TxFeatures[],
  relations: ReadonlyMap<string, ResolvedRelation>,
  byId: ReadonlyMap<string, TxFeatures>,
): { destination: Record<string, number>; counterparty: Record<string, number> } {
  const destination = pastDestination(row, relation, byId);
  const destKey = destination ? `${row.accountId}->${destination.id}|${row.direction}` : null;
  const counterparty = relation?.counterpartyKey || row.merchantKey;
  const counterKey = counterparty && counterparty !== "unknown"
    ? `${row.accountId}|${counterparty}|${row.direction}`
    : null;
  const destinationCounts: Record<string, number> = {};
  const counterpartyCounts: Record<string, number> = {};
  for (const past of corpus) {
    if (!past.categoryName || dayOf(past) >= dayOf(row)) continue;
    const pastRelation = relations.get(past.id);
    const pastDestinationAccount = pastDestination(past, pastRelation, byId);
    if (destKey && pastDestinationAccount && `${past.accountId}->${pastDestinationAccount.id}|${past.direction}` === destKey) {
      destinationCounts[past.categoryName] = (destinationCounts[past.categoryName] ?? 0) + 1;
    }
    const pastCounterparty = pastRelation?.counterpartyKey || past.merchantKey;
    if (counterKey && pastCounterparty && `${past.accountId}|${pastCounterparty}|${past.direction}` === counterKey) {
      counterpartyCounts[past.categoryName] = (counterpartyCounts[past.categoryName] ?? 0) + 1;
    }
  }
  return { destination: destinationCounts, counterparty: counterpartyCounts };
}

async function main(): Promise<void> {
  const client = new FinWiseClient({
    apiKey: required("FINWISE_API_KEY"),
    baseUrl: process.env.FINWISE_BASE_URL,
  });
  const [categories, rawTxns, merchants, accounts] = await Promise.all([
    client.transactionCategories.list({ pagination: { pageNumber: 1, pageSize: 100 } }),
    listAll(client),
    merchantNames(client),
    client.accounts.list({ pagination: { pageNumber: 1, pageSize: 100 } }),
  ]);
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const accountLookups: AccountLookup[] = accounts.map((account) => ({
    id: account.id,
    name: account.displayName || account.friendlyName || account.name,
    type: account.providerType || account.type || account.accountType,
    subType: account.providerSubtype || account.subType,
  }));
  const accountNameById = new Map(accountLookups.map((account) => [account.id, account.name]));
  const rows = rawTxns.map((txn) =>
    toFeatures({
      id: txn.id,
      date: txn.date,
      description: txn.description,
      amount: Number(txn.amount?.amount ?? 0),
      merchantId: txn.merchantId,
      merchantName: txn.merchantId ? merchants.get(txn.merchantId) ?? null : null,
      notes: txn.notes,
      categoryId: txn.transactionCategoryId,
      categoryName: txn.transactionCategoryId ? nameById.get(txn.transactionCategoryId) ?? null : null,
      originalCategoryId: txn.originalTransactionCategoryId,
      finwiseCategoryName: txn.originalTransactionCategoryId
        ? nameById.get(txn.originalTransactionCategoryId) ?? null
        : null,
      accountId: txn.accountId,
      accountName: accountNameById.get(txn.accountId) ?? txn.accountId,
      isTransfer: txn.isTransfer,
      needsReview: txn.needsReview,
      updatedAt: txn.updatedAt,
    }),
  );
  const labelled = rows.filter((row) => row.categoryName && dayOf(row) < SACRED_START);
  const dev = labelled.filter((row) => dayOf(row) >= DEV_START && dayOf(row) < DEV_END);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const relations = resolveRelations(labelled, accountLookups);
  const checkpointPath = path.join(root, "reports", "categoriser", "v2-checkpoint.json");
  if (!existsSync(checkpointPath)) throw new Error("missing v2 checkpoint");
  const saved = JSON.parse(readFileSync(checkpointPath, "utf8")) as SavedCall[];
  const v8full = new Map(saved.filter((call) => call.arm === "v8full").map((call) => [call.id, call.predicted]));
  const missing = dev.filter((row) => !v8full.has(row.id));
  if (missing.length > 0) throw new Error(`v8full missing ${missing.length} April-June rows`);

  const reliable = runMemoryOracle({
    corpus: labelled,
    evalRows: dev,
    relations,
    byId,
    thresholds: RELIABLE_MEMORY,
  });
  const pure = runMemoryOracle({
    corpus: labelled,
    evalRows: dev,
    relations,
    byId,
    thresholds: PURE_MEMORY,
  });
  const reliableById = new Map(reliable.rows.map((row) => [row.id, row]));
  const pureById = new Map(pure.rows.map((row) => [row.id, row]));
  const joined: Joined[] = dev.map((row) => {
    const actual = row.categoryName ?? "";
    const predicted = v8full.get(row.id) ?? null;
    const nature = relations.get(row.id)?.nature ?? "other";
    return {
      row,
      relation: relations.get(row.id),
      oracle: reliableById.get(row.id)!,
      predicted,
      actual,
      jevCorrect: predicted === actual,
      movement: isMovement(nature),
      purchase: nature === "purchase",
    };
  });

  function joinWith(oracleRows: readonly MemoryOracleRow[]): Joined[] {
    const lookup = new Map(oracleRows.map((item) => [item.id, item]));
    return joined.map((item) => ({ ...item, oracle: lookup.get(item.row.id)! }));
  }

  const reliableJoined = joinWith(reliable.rows);
  const pureJoined = joinWith(pure.rows);
  const buckets = ["all", "movement", "purchases", "jevCorrect", "jevWrong"] as const;
  function pick(items: readonly Joined[], bucket: (typeof buckets)[number]): Joined[] {
    if (bucket === "all") return [...items];
    if (bucket === "movement") return items.filter((item) => item.movement);
    if (bucket === "purchases") return items.filter((item) => item.purchase);
    if (bucket === "jevCorrect") return items.filter((item) => item.jevCorrect);
    return items.filter((item) => !item.jevCorrect);
  }

  const missedTransfers = reliableJoined.filter((item) => item.actual === "Transfers" && !item.jevCorrect);
  const transferRows = missedTransfers.map((item) => {
    const destination = pastDestination(item.row, item.relation, byId);
    const labels = pastLabels(item.row, item.relation, labelled, relations, byId);
    const adjudication = adjudicateDisagreement({
      actual: item.actual,
      predicted: item.predicted ?? "",
      observations: item.oracle.observations,
    });
    const other = item.relation?.pair ? byId.get(item.relation.pair.otherId) : undefined;
    return {
      id: item.row.id,
      date: dayOf(item.row),
      source: item.relation?.accountName ?? item.row.accountName,
      destination: destination?.name ?? item.relation?.ownAccount?.name ?? null,
      counterparty: item.relation?.counterpartyKey ?? item.row.merchantKey,
      direction: item.row.direction,
      amount: item.row.signedAmount,
      description: item.row.descriptionNorm,
      pairedLeg: other
        ? {
            date: dayOf(other),
            account: other.accountName,
            category: other.categoryName,
            visibleOnOrBefore: dayOf(other) <= dayOf(item.row),
          }
        : null,
      actual: item.actual,
      jev: item.predicted,
      recoverable: item.oracle.recoverable,
      selected: item.oracle.selected,
      pastDestinationLabels: labels.destination,
      pastCounterpartyLabels: labels.counterparty,
      adjudication: adjudication.bucket,
    };
  });

  const ruleKey = (item: (typeof transferRows)[number]): string =>
    `${item.source} -> ${item.destination ?? item.counterparty}|${item.direction}|${item.jev}`;
  const rules = new Map<string, { n: number; recoverable: number; labels: Record<string, number> }>();
  for (const item of transferRows) {
    const key = ruleKey(item);
    const rule = rules.get(key) ?? { n: 0, recoverable: 0, labels: {} };
    rule.n += 1;
    if (item.recoverable) rule.recoverable += 1;
    for (const [label, count] of Object.entries(item.pastDestinationLabels)) {
      rule.labels[label] = (rule.labels[label] ?? 0) + count;
    }
    rules.set(key, rule);
  }

  const report = {
    generatedAt: new Date().toISOString(),
    protocol: {
      dev: [DEV_START, DEV_END],
      sacredStart: SACRED_START,
      sacredUntouched: rows.filter((row) => dayOf(row) >= SACRED_START).length,
      corpus: labelled.length,
      evalRows: dev.length,
      jevCalls: 0,
      note: "Past-only memory oracle. Same-day and future rows are excluded. No JEV calls.",
    },
    reliable: {
      thresholds: RELIABLE_MEMORY,
      report: reliable.report,
      slices: buckets.map((bucket) => sliceReport(bucket, pick(reliableJoined, bucket), RELIABLE_MEMORY)),
    },
    pure: {
      thresholds: PURE_MEMORY,
      report: pure.report,
      slices: buckets.map((bucket) => sliceReport(bucket, pick(pureJoined, bucket), PURE_MEMORY)),
    },
    missedTransfers: {
      n: transferRows.length,
      of: reliableJoined.filter((item) => item.actual === "Transfers").length,
      rules: [...rules.entries()]
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.n - a.n),
      rows: transferRows,
    },
  };
  const outDir = path.join(root, "reports", "categoriser");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "memory-oracle.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    evalRows: dev.length,
    reliable: report.reliable.slices,
    pureMovementWrong: report.pure.slices.find((item) => item.slice === "movement"),
    missedTransferRules: report.missedTransfers.rules,
  }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "oracle failed");
  process.exit(1);
});
