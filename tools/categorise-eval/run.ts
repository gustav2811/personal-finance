import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FinWiseClient, type Transaction } from "../../libs/finwise/src/index.js";
import {
  accuracy,
  bestThreshold,
  buildCategoryOptions,
  buildEvidence,
  buildJevRequest,
  classScores,
  classifyTransaction,
  confusionPairs,
  CONSERVATIVE_POLICY,
  coverageCurve,
  createCloudflareJevModel,
  ExperimentBudget,
  macroF1,
  matchFirstRule,
  merchantHoldout,
  selective,
  temporalSplit,
  toFeatures,
  weightedF1,
  type AcceptancePolicy,
  type DecisionModel,
  type JevVariant,
  type ScoredRow,
  type TxFeatures,
} from "../../libs/categoriser/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

const ACCOUNT_ID = "0975bb8e042b737788a61583e2ec6cfc";
const GATEWAY_ID = "finance-ai-gateway";
const TUNE_CAP = 280;
const FINAL_CAP = 500;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function cloudflareToken(): string {
  const fromEnv = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return execFileSync("npx", ["wrangler", "auth", "token"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim().split("\n").pop() ?? "";
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
  try {
    for (let page = 1; page <= 10; page++) {
      const batch = await client.request<{ id: string; name: string }[]>(
        "GET",
        "/merchants",
        undefined,
        { pagination: { pageNumber: page, pageSize: 100 } },
      );
      if (!Array.isArray(batch)) break;
      for (const merchant of batch) names.set(merchant.id, merchant.name);
      if (batch.length < 100) break;
    }
  } catch {
    return names;
  }
  return names;
}

function sampleStratified(rows: TxFeatures[], perClass: number, cap: number): TxFeatures[] {
  const groups = new Map<string, TxFeatures[]>();
  for (const row of rows) {
    if (!row.categoryName) continue;
    const list = groups.get(row.categoryName) ?? [];
    list.push(row);
    groups.set(row.categoryName, list);
  }
  const out: TxFeatures[] = [];
  for (const list of groups.values()) out.push(...list.slice(0, perClass));
  return out.slice(0, cap);
}

function scoredFrom(
  rows: TxFeatures[],
  predict: (row: TxFeatures) => { name: string | null; accept: boolean; confidence: number; margin: number; top: number },
): ScoredRow[] {
  return rows
    .filter((row) => row.categoryName)
    .map((row) => {
      const prediction = predict(row);
      return {
        actual: row.categoryName as string,
        predicted: prediction.name,
        accept: prediction.accept,
        confidence: prediction.confidence,
        margin: prediction.margin,
        topProbability: prediction.top,
      };
    });
}

function summarise(name: string, rows: ScoredRow[], extra: Record<string, unknown> = {}) {
  const sel = selective(rows);
  return {
    name,
    n: rows.length,
    accuracy: Number(accuracy(rows).toFixed(4)),
    macroF1: Number(macroF1(rows).toFixed(4)),
    weightedF1: Number(weightedF1(rows).toFixed(4)),
    coverage: Number(sel.coverage.toFixed(4)),
    selectivePrecision: Number(sel.precision.toFixed(4)),
    accepted: sel.accepted,
    lowSupport: classScores(rows).filter((score) => score.support > 0 && score.support < 5).map((score) => score.category),
    confusion: confusionPairs(rows, 8),
    ...extra,
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let wait = 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (!/429|529|HTTP 5/.test(message) || attempt === 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, wait));
      wait *= 2;
    }
  }
  throw new Error("retry exhausted");
}

async function probePatch(client: FinWiseClient, before: Transaction): Promise<Record<string, unknown>> {
  const previousNotes = before.notes;
  const marker = "classifier-probe";
  try {
    const patched = await client.transactions.update(before.id, { notes: marker });
    const restored = await client.transactions.update(before.id, { notes: previousNotes });
    return {
      ok: patched.notes === marker && restored.notes === previousNotes,
      categoryUnchanged: restored.transactionCategoryId === before.transactionCategoryId,
      originalUnchanged: restored.originalTransactionCategoryId === before.originalTransactionCategoryId,
      originalPresent: before.originalTransactionCategoryId != null,
    };
  } catch (err) {
    await client.transactions.update(before.id, { notes: previousNotes }).catch(() => undefined);
    return { ok: false, error: err instanceof Error ? err.message : "patch failed" };
  }
}

async function main(): Promise<void> {
  if (process.env.LIVE_EVAL !== "1") {
    console.log("refusing live eval without LIVE_EVAL=1");
    process.exit(1);
  }
  const client = new FinWiseClient({
    apiKey: required("FINWISE_API_KEY"),
    baseUrl: process.env.FINWISE_BASE_URL,
  });
  const token = cloudflareToken();
  if (!token) throw new Error("missing cloudflare token");
  const budget = new ExperimentBudget();
  const model: DecisionModel = createCloudflareJevModel({
    accountId: ACCOUNT_ID,
    apiToken: token,
    gatewayId: GATEWAY_ID,
    budget,
    collectLog: false,
    fetchImpl: async (url, init) => {
      return withRetry(() => fetch(url, init));
    },
  });

  const [categories, rawTxns, merchants] = await Promise.all([
    client.transactionCategories.list({ pagination: { pageNumber: 1, pageSize: 100 } }),
    listAll(client),
    merchantNames(client),
  ]);
  const nameById = new Map(categories.map((category) => [category.id, category.name]));
  const rows = rawTxns.map((txn) =>
    toFeatures({
      id: txn.id,
      date: txn.date,
      description: txn.description,
      amount: Number(txn.amount?.amount ?? 0),
      merchantName: txn.merchantId ? merchants.get(txn.merchantId) ?? null : null,
      notes: txn.notes,
      categoryId: txn.transactionCategoryId,
      categoryName: txn.transactionCategoryId ? nameById.get(txn.transactionCategoryId) ?? null : null,
      originalCategoryId: txn.originalTransactionCategoryId,
      accountId: txn.accountId,
      isTransfer: txn.isTransfer,
      needsReview: txn.needsReview,
      updatedAt: txn.updatedAt,
    }),
  );
  const labelled = rows.filter((row) => row.categoryName);
  const split = temporalSplit(labelled);
  const options = buildCategoryOptions(categories);
  const probeSource = rawTxns.find((txn) => !txn.isPending && txn.transactionCategoryId) ?? rawTxns[0];
  const probe = await probePatch(client, probeSource);

  const originalComparable = labelled.filter((row) => row.originalCategoryId);
  const originalHits = originalComparable.filter(
    (row) => row.originalCategoryId === row.categoryId,
  ).length;

  const referenceEvidence = buildEvidence(split.reference);
  const historyRows = scoredFrom(split.final, (row) => {
    const stat = referenceEvidence.byMerchant.get(row.merchantKey);
    const accept = Boolean(stat && stat.total >= 5 && stat.purity === 1 && stat.majority);
    return {
      name: accept ? stat?.majority ?? null : null,
      accept,
      confidence: stat?.purity ?? 0,
      margin: 1,
      top: stat?.purity ?? 0,
    };
  });
  const ruleRows = scoredFrom(split.final, (row) => {
    const rule = matchFirstRule(row);
    return { name: rule?.categoryName ?? null, accept: Boolean(rule), confidence: rule ? 1 : 0, margin: 1, top: rule ? 1 : 0 };
  });

  const checkpointPath = path.join(root, "reports", "categoriser", "checkpoint.json");
  mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const checkpoint: Record<string, unknown> = existsSync(checkpointPath)
    ? JSON.parse(readFileSync(checkpointPath, "utf8")) as Record<string, unknown>
    : {};
  function saveCheckpoint(key: string, value: unknown): void {
    checkpoint[key] = value;
    writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
  }

  async function runModel(
    name: string,
    evalRows: TxFeatures[],
    evidenceRows: TxFeatures[],
    variant: JevVariant,
    mode: "jev" | "hybrid",
    policy: AcceptancePolicy = CONSERVATIVE_POLICY,
  ) {
    const cached = checkpoint[name];
    if (cached) return cached as Awaited<ReturnType<typeof summarise>> & {
      threshold98: { confidence: number; probability: number; margin: number; coverage: number; precision: number } | null;
    };
    const evidence = buildEvidence(evidenceRows, new Set(evalRows.map((row) => row.id)));
    const cats = buildCategoryOptions(categories, evidence, variant === "exemplars");
    const started = Date.now();
    const decisions = await mapPool(evalRows, 2, async (row, index) => {
      if (index > 0 && index % 50 === 0) {
        console.log(JSON.stringify({ phase: name, done: index, of: evalRows.length, notionalUsd: Number(budget.spentNotionalUsd.toFixed(4)) }));
      }
      const jevRequest = buildJevRequest({
        tx: row,
        categories: cats,
        variant,
        evidence,
        includeAmount: true,
      });
      const t0 = Date.now();
      const decision = await classifyTransaction({
        tx: row,
        categories: cats,
        evidence,
        corrections: new Map(),
        policy,
        mode,
        model,
        jevRequest,
      });
      return { decision, ms: Date.now() - t0 };
    });
    const scored: ScoredRow[] = decisions.map((item, index) => ({
      actual: evalRows[index].categoryName as string,
      predicted: item.decision.categoryName,
      accept: item.decision.accept,
      confidence: item.decision.confidence,
      margin: item.decision.margin,
      topProbability: item.decision.topProbability,
    }));
    const latencies = decisions.map((item) => item.ms).sort((a, b) => a - b);
    const grid = [0.8, 0.9, 0.95, 0.97, 0.99].flatMap((confidence) =>
      [0.1, 0.3, 0.5].map((margin) => ({ confidence, probability: confidence, margin })),
    );
    const curve = coverageCurve(scored, grid);
    const result = summarise(name, scored, {
      elapsedMs: Date.now() - started,
      latencyP50: latencies[Math.floor(latencies.length / 2)] ?? 0,
      inputTokens: decisions.reduce((sum, item) => sum + item.decision.inputTokens, 0),
      jevCalls: decisions.filter((item) => item.decision.source === "jev" || item.decision.inputTokens > 0).length,
      sources: decisions.reduce<Record<string, number>>((acc, item) => {
        acc[item.decision.source] = (acc[item.decision.source] ?? 0) + 1;
        return acc;
      }, {}),
      threshold98: bestThreshold(curve, 0.98),
      threshold95: bestThreshold(curve, 0.95),
    });
    saveCheckpoint(name, result);
    console.log(JSON.stringify({ phase: name, done: "complete", accuracy: result.accuracy, selectivePrecision: result.selectivePrecision, coverage: result.coverage }));
    return result;
  }

  const tuneSample = sampleStratified(split.tune, 8, TUNE_CAP);
  const tuneNames = await runModel("tune-names", tuneSample, split.reference, "names", "jev");
  const tuneDescriptions = await runModel("tune-descriptions", tuneSample, split.reference, "descriptions", "jev");
  const tuneHybrid = await runModel("tune-hybrid", tuneSample, split.reference, "history_hint", "hybrid");
  const winner: JevVariant = "history_hint";
  const finalSample = split.final.slice(0, FINAL_CAP);
  const finalHybrid = await runModel("final-hybrid", finalSample, [...split.reference, ...split.tune], winner, "hybrid");
  const unseen = merchantHoldout(labelled, 20);
  const unseenEval = sampleStratified(
    unseen.heldOut.filter((row) => row.date.slice(0, 10) >= "2026-04-01"),
    4,
    120,
  );
  const merchantUnseen = await runModel(
    "merchant-unseen",
    unseenEval,
    unseen.reference.filter((row) => row.date.slice(0, 10) < "2026-07-01"),
    "descriptions",
    "jev",
  );

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      total: rows.length,
      labelled: labelled.length,
      merchantsResolved: merchants.size,
      dateMin: labelled.map((row) => row.date).sort()[0]?.slice(0, 10),
      dateMax: labelled.map((row) => row.date).sort().at(-1)?.slice(0, 10),
      split: {
        reference: split.reference.length,
        tune: split.tune.length,
        final: split.final.length,
      },
    },
    finwiseOriginal: {
      comparable: originalComparable.length,
      agreement: originalComparable.length === 0 ? null : Number((originalHits / originalComparable.length).toFixed(4)),
    },
    patchProbe: probe,
    baselines: {
      historyFinal: summarise("history-purity-1-support-5", historyRows),
      rulesFinal: summarise("rules", ruleRows),
    },
    tune: [tuneNames, tuneDescriptions, tuneHybrid],
    final: finalHybrid,
    merchantUnseen,
    budget: budget.snapshot(),
    policy: CONSERVATIVE_POLICY satisfies AcceptancePolicy,
  };
  const outDir = path.join(root, "reports", "categoriser");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "metrics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    dataset: report.dataset,
    finwiseOriginal: report.finwiseOriginal,
    patchProbe: report.patchProbe,
    baselines: report.baselines,
    tune: report.tune.map((item) => ({
      name: item.name,
      n: item.n,
      accuracy: item.accuracy,
      selectivePrecision: item.selectivePrecision,
      coverage: item.coverage,
      threshold98: item.threshold98,
    })),
    final: {
      name: finalHybrid.name,
      n: finalHybrid.n,
      accuracy: finalHybrid.accuracy,
      macroF1: finalHybrid.macroF1,
      selectivePrecision: finalHybrid.selectivePrecision,
      coverage: finalHybrid.coverage,
      threshold98: finalHybrid.threshold98,
      confusion: finalHybrid.confusion,
    },
    merchantUnseen: {
      n: merchantUnseen.n,
      accuracy: merchantUnseen.accuracy,
      selectivePrecision: merchantUnseen.selectivePrecision,
      coverage: merchantUnseen.coverage,
    },
    budget: report.budget,
  }, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "eval failed");
  process.exit(1);
});
