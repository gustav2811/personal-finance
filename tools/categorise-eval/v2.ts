import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FinWiseClient, type Transaction } from "../../libs/finwise/src/index.js";
import {
  DEV_END,
  DEV_START,
  SACRED_START,
  buildCategoryOptions,
  buildContrastiveJevRequest,
  buildJevRequest,
  buildRetrieval,
  classScores,
  classifyTransaction,
  confusionPairs,
  createCloudflareJevModel,
  ExperimentBudget,
  isMovement,
  fnv1a,
  labelledAccuracy,
  macroF1,
  pairedLift,
  resolveRelations,
  sampleStratifiedSeeded,
  selectCandidates,
  toFeatures,
  type AccountLookup,
  type DecisionModel,
  type ResolvedRelation,
  type TxFeatures,
} from "../../libs/categoriser/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(root, ".env") });

const ACCOUNT_ID = "0975bb8e042b737788a61583e2ec6cfc";
const GATEWAY_ID = "finance-ai-gateway";
const SAMPLE_CAP = 80;
const SEED = "v2-dev-2026-09-25";

interface SavedCall {
  id: string;
  arm: string;
  predicted: string | null;
  confidence: number;
  margin: number;
  topProbability: number;
  inputTokens: number;
}

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

function dayOf(row: TxFeatures): string {
  return row.date.slice(0, 10);
}

function visibleRelation(
  row: TxFeatures,
  relation: ResolvedRelation,
  byId: ReadonlyMap<string, TxFeatures>,
): ResolvedRelation {
  const other = relation.pair ? byId.get(relation.pair.otherId) : undefined;
  if (!relation.pair || !other || dayOf(other) <= dayOf(row)) return relation;
  return {
    ...relation,
    pair: null,
    nature: row.direction === "debit" ? "purchase" : "other",
    pairKey: `${relation.accountName} -> ${relation.counterpartyKey}`,
  };
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
    fetchImpl: (url, init) => withRetry(() => fetch(url, init)),
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
    type: account.type,
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
  const sacred = rows.filter((row) => dayOf(row) >= SACRED_START);
  const devPool = labelled.filter((row) => dayOf(row) >= DEV_START && dayOf(row) < DEV_END);
  const natural = process.env.NATURAL === "1";
  const fresh = process.env.FRESH === "1";
  const escalate = process.env.ESCALATE === "1";
  const rankedDev = [...devPool].sort((a, b) => {
    const left = fnv1a(`${SEED}|${a.id}`);
    const right = fnv1a(`${SEED}|${b.id}`);
    return left < right ? -1 : left > right ? 1 : a.id.localeCompare(b.id);
  });
  const sample = escalate
    ? rankedDev.slice(SAMPLE_CAP * 2, SAMPLE_CAP * 3)
    : fresh
    ? rankedDev.slice(SAMPLE_CAP, SAMPLE_CAP * 2)
    : natural
      ? rankedDev.slice(0, SAMPLE_CAP)
      : sampleStratifiedSeeded(devPool, 2, SAMPLE_CAP, SEED);
  const options = buildCategoryOptions(categories);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const relations = resolveRelations(labelled, accountLookups);
  if (process.env.AUDIT_ONLY === "1") {
    const auditRows = labelled.filter((row) => dayOf(row) >= DEV_START && dayOf(row) < DEV_END);
    let goldInCandidates = 0;
    let paired = 0;
    let pairLabelDisagree = 0;
    const misses = new Map<string, number>();
    const reasons = new Map<string, number>();
    let workEatsN = 0;
    let workEatsIn = 0;
    let transfersN = 0;
    let transfersIn = 0;
    for (const row of auditRows) {
      const history = labelled.filter((item) => item.id !== row.id && dayOf(item) < dayOf(row));
      const relation = visibleRelation(
        row,
        relations.get(row.id) ?? {
          accountName: row.accountName,
          accountType: null,
          counterpartyKey: row.merchantKey,
          ownAccount: null,
          pair: null,
          nature: row.direction === "debit" ? "purchase" : "other",
          pairKey: `${row.accountName} -> ${row.merchantKey}`,
        },
        byId,
      );
      if (relation.pair) {
        paired += 1;
        const other = byId.get(relation.pair.otherId);
        if (other?.categoryName && other.categoryName !== row.categoryName) pairLabelDisagree += 1;
      }
      const retrieval = buildRetrieval(history, relations);
      const candidates = selectCandidates({ tx: row, relation, retrieval, categories: options });
      const gold = row.categoryName;
      if (gold === "Work Eats") {
        workEatsN += 1;
        if (candidates.names.includes(gold)) workEatsIn += 1;
      }
      if (gold === "Transfers") {
        transfersN += 1;
        if (candidates.names.includes(gold)) transfersIn += 1;
      }
      if (gold && candidates.names.includes(gold)) goldInCandidates += 1;
      else {
        misses.set(gold ?? "none", (misses.get(gold ?? "none") ?? 0) + 1);
        const merchant = retrieval.merchant.get(row.merchantId || row.merchantKey);
        const ranked = merchant
          ? Object.entries(merchant.counts).sort((a, b) => b[1] - a[1]).map(([name]) => name)
          : [];
        const reason = !merchant
          ? "merchant_unseen"
          : !gold || !merchant.counts[gold]
            ? "gold_absent_from_merchant"
            : ranked.indexOf(gold) >= 3
              ? "crowded_out"
              : candidates.names.length >= 8
                ? "cap"
                : "other";
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
    }
    const early = labelled.filter((row) => dayOf(row) < "2026-01-01");
    const calibrate = labelled.filter((row) => dayOf(row) >= "2026-01-01" && dayOf(row) < DEV_START);
    const beforeDev = labelled.filter((row) => dayOf(row) < DEV_START);
    const earlyRelations = resolveRelations(beforeDev, accountLookups);
    const earlyRetrieval = buildRetrieval(early, earlyRelations);
    let pairFired = 0;
    let pairHits = 0;
    for (const row of calibrate) {
      const relation = earlyRelations.get(row.id);
      const stat = relation ? earlyRetrieval.pair.get(relation.pairKey) : undefined;
      if (!stat || stat.total < 5 || stat.purity < 1 || !stat.majority) continue;
      pairFired += 1;
      if (stat.majority === row.categoryName) pairHits += 1;
    }
    const third = rankedDev.slice(SAMPLE_CAP * 2, SAMPLE_CAP * 3);
    const checkpointFile = path.join(root, "reports", "categoriser", "v2-checkpoint.json");
    const prior = existsSync(checkpointFile)
      ? JSON.parse(readFileSync(checkpointFile, "utf8")) as { id: string; arm: string; predicted: string | null }[]
      : [];
    const cand = new Map(prior.filter((call) => call.arm === "v4cand").map((call) => [call.id, call.predicted]));
    let thirdFired = 0;
    let thirdHits = 0;
    let combinedHits = 0;
    let combinedN = 0;
    for (const row of third) {
      const history = labelled.filter((item) => item.id !== row.id && dayOf(item) < dayOf(row));
      const retrieval = buildRetrieval(history, relations);
      const stat = retrieval.pair.get(relations.get(row.id)?.pairKey ?? "");
      const ruled = stat && stat.total >= 5 && stat.purity === 1 ? stat.majority : null;
      if (ruled) {
        thirdFired += 1;
        if (ruled === row.categoryName) thirdHits += 1;
      }
      if (!cand.has(row.id)) continue;
      combinedN += 1;
      if ((ruled ?? cand.get(row.id)) === row.categoryName) combinedHits += 1;
    }
    console.log(JSON.stringify({
      devPool: auditRows.length,
      candidateRecall: goldInCandidates / auditRows.length,
      paired,
      pairLabelDisagree,
      topMisses: [...misses.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
      missReasons: Object.fromEntries(reasons),
      workEatsInCandidates: workEatsIn,
      workEatsN: workEatsN,
      transfersInCandidates: transfersIn,
      transfersN,
      pairRuleOnReference: {
        fired: pairFired,
        precision: pairFired === 0 ? null : pairHits / pairFired,
      },
      pairRuleOnThirdSlice: {
        fired: thirdFired,
        precision: thirdFired === 0 ? null : thirdHits / thirdFired,
        combinedAccuracy: combinedN === 0 ? null : combinedHits / combinedN,
        combinedN,
      },
    }, null, 2));
    return;
  }
  const checkpointPath = path.join(root, "reports", "categoriser", "v2-checkpoint.json");
  mkdirSync(path.dirname(checkpointPath), { recursive: true });
  const saved: SavedCall[] = existsSync(checkpointPath)
    ? JSON.parse(readFileSync(checkpointPath, "utf8")) as SavedCall[]
    : [];
  const savedKey = new Map(saved.map((call) => [`${call.arm}:${call.id}`, call]));

  async function businessHint(row: TxFeatures): Promise<string | null> {
    const response = await withRetry(() => fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/ai/run`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "cf-aig-gateway-id": GATEWAY_ID,
          "cf-aig-collect-log": "false",
        },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.1-8b-instruct-fast",
          input: {
            messages: [{
              role: "user",
              content: `What kind of business or payment is this? Eight words or fewer. Merchant: ${row.merchantKey}. Text: ${row.descriptionNorm.slice(0, 80)}`,
            }],
          },
        }),
      },
    ));
    if (!response.ok) return null;
    const payload = await response.json() as { result?: { response?: string } };
    const text = payload.result?.response?.replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 80) : null;
  }

  async function predict(arm: "v1" | "v3" | "v4full" | "v4cand" | "v5hint", row: TxFeatures): Promise<SavedCall> {
    const key = `${arm}:${row.id}`;
    const cached = savedKey.get(key);
    if (cached) return cached;
    const history = labelled.filter((item) => item.id !== row.id && dayOf(item) < dayOf(row));
    const relation = visibleRelation(
      row,
      relations.get(row.id) ?? {
        accountName: row.accountName,
        accountType: null,
        counterpartyKey: row.merchantKey,
        ownAccount: null,
        pair: null,
        nature: row.direction === "debit" ? "purchase" : "other",
        pairKey: `${row.accountName} -> ${row.merchantKey}`,
      },
      byId,
    );
    const retrieval = buildRetrieval(history, relations);
    const candidates = selectCandidates({ tx: row, relation, retrieval, categories: options });
    const fullSet = { names: options.map((category) => category.name), reasons: {} };
    const jevRequest = arm === "v1"
      ? buildJevRequest({ tx: row, categories: options, variant: "descriptions" })
      : buildContrastiveJevRequest({
          tx: row,
          relation,
          retrieval,
          categories: options,
          candidates: arm === "v4full" ? fullSet : candidates,
          businessHint: arm === "v5hint" ? await businessHint(row) : null,
        });
    const decision = await classifyTransaction({
      tx: row,
      categories: arm === "v4cand" || arm === "v3"
        ? options.filter((category) => candidates.names.includes(category.name))
        : options,
      evidence: { byMerchant: new Map(), exemplarsByCategory: new Map() },
      corrections: new Map(),
      policy: { historyMinSupport: 99, historyMinPurity: 1, jevMinConfidence: 0, jevMinProbability: 0, jevMinMargin: 0 },
      mode: "jev",
      model,
      jevRequest,
    });
    const call: SavedCall = {
      id: row.id,
      arm,
      predicted: decision.categoryName,
      confidence: decision.confidence,
      margin: decision.margin,
      topProbability: decision.topProbability,
      inputTokens: decision.inputTokens,
    };
    saved.push(call);
    savedKey.set(key, call);
    writeFileSync(checkpointPath, JSON.stringify(saved));
    return call;
  }

  const v1: SavedCall[] = [];
  const v2: SavedCall[] = [];
  for (let index = 0; index < sample.length; index++) {
    const row = sample[index];
    if (!row) continue;
    const history = labelled.filter((item) => item.id !== row.id && dayOf(item) < dayOf(row));
    const merchantSupport = buildRetrieval(history, relations).merchant.get(row.merchantId || row.merchantKey)?.total ?? 0;
    const [first, second] = escalate
      ? await (async () => {
          const base = await predict("v4cand", row);
          if (merchantSupport >= 2) return [base, { ...base, arm: "v5hint" }] as const;
          return [base, await predict("v5hint", row)] as const;
        })()
      : await Promise.all(
          fresh
            ? [predict("v4full", row), predict("v4cand", row)]
            : [predict("v1", row), predict("v3", row)],
        );
    v1.push(first);
    v2.push(second);
    if (index % 10 === 0) {
      console.log(JSON.stringify({
        done: index,
        of: sample.length,
        notionalUsd: Number(budget.spentNotionalUsd.toFixed(4)),
      }));
    }
  }

  const scored = sample.map((row, index) => ({
    actual: row.categoryName as string,
    v1: v1[index]?.predicted ?? null,
    v2: v2[index]?.predicted ?? null,
    finwise: row.finwiseCategoryName,
    nature: (relations.get(row.id)?.nature ?? "other"),
    movement: isMovement(relations.get(row.id)?.nature ?? "other"),
  }));
  const asRows = (pick: "v1" | "v2" | "finwise") =>
    scored.map((row) => ({
      actual: row.actual,
      predicted: row[pick],
      accept: true,
      confidence: 1,
      margin: 1,
      topProbability: 1,
    }));
  const sliceAccuracy = (rows: typeof scored, pick: "v1" | "v2") =>
    labelledAccuracy(rows.map((row) => ({ actual: row.actual, predicted: row[pick] })));
  const movement = scored.filter((row) => row.movement);
  const purchases = scored.filter((row) => row.nature === "purchase");
  const comparable = scored.filter((row) => row.finwise);
  const report = {
    generatedAt: new Date().toISOString(),
    protocol: {
      seed: SEED,
      dev: [DEV_START, DEV_END],
      sacredStart: SACRED_START,
      sacredUntouched: sacred.length,
      devPool: devPool.length,
      sample: sample.length,
      natural,
      fresh,
      arms: escalate ? ["v4cand", "v5hint"] : fresh ? ["v4full", "v4cand"] : ["v1", "v3"],
      note: "April-June development sample only. Post-2026-07-01 and the sacred window were not sent to JEV.",
    },
    v1: {
      accuracy: labelledAccuracy(asRows("v1")),
      macroF1: macroF1(asRows("v1")),
      confusion: confusionPairs(asRows("v1"), 8),
    },
    v2: {
      accuracy: labelledAccuracy(asRows("v2")),
      macroF1: macroF1(asRows("v2")),
      confusion: confusionPairs(asRows("v2"), 8),
      perClass: classScores(asRows("v2")).filter((score) => score.support > 0),
    },
    finwise: {
      comparable: comparable.length,
      accuracy: labelledAccuracy(comparable.map((row) => ({ actual: row.actual, predicted: row.finwise }))),
    },
    paired: {
      v2VersusV1: pairedLift(scored.map((row) => ({ actual: row.actual, a: row.v1, b: row.v2 })), SEED),
      v2VersusFinwise: pairedLift(
        comparable.map((row) => ({ actual: row.actual, a: row.finwise, b: row.v2 })),
        SEED,
      ),
    },
    slices: {
      movement: { n: movement.length, v1: sliceAccuracy(movement, "v1"), v2: sliceAccuracy(movement, "v2") },
      purchases: { n: purchases.length, v1: sliceAccuracy(purchases, "v1"), v2: sliceAccuracy(purchases, "v2") },
    },
    efficiency: {
      calls: saved.filter((call) => call.inputTokens > 0).length,
      inputTokens: saved.reduce((sum, call) => sum + call.inputTokens, 0),
      notionalUsd: budget.spentNotionalUsd,
      perThousandUsd: sample.length === 0 ? null : (budget.spentNotionalUsd / sample.length) * 1000,
    },
  };
  const outDir = path.join(root, "reports", "categoriser");
  writeFileSync(path.join(outDir, "v2-metrics.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "eval failed");
  process.exit(1);
});
