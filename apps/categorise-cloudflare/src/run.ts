import {
  buildCategoryOptions,
  buildContrastiveJevRequest,
  buildRetrieval,
  classifyTransaction,
  CONSERVATIVE_POLICY,
  correctionFingerprint,
  createBindingJevModel,
  resolveRelations,
  selectCandidates,
  notionalUsd,
  mayAutoApply,
  observeCategoryChange,
  toFeatures,
  txFeatureHash,
  type AiBinding,
} from "@investments/categoriser";
import { FinwiseHttp, merchantNameOf, signedAmount, type FinwiseTxn } from "./finwise.js";

export interface ClassifierEnv {
  AI: AiBinding;
  DB: D1Database;
  FINWISE_API_KEY: string;
  FINWISE_BASE_URL: string;
  CLASSIFIER_MODE: string;
  CLASSIFIER_VERSION: string;
  AI_GATEWAY_ID: string;
  POLL_LOOKBACK_DAYS: string;
  MAX_PER_RUN: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_KEY?: string;
}

export interface RunSummary {
  seen: number;
  classified: number;
  skipped: number;
  applied: number;
  corrections: number;
  inputTokens: number;
  notionalUsd: number;
  mode: string;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function runClassifier(env: ClassifierEnv): Promise<RunSummary> {
  const mode = env.CLASSIFIER_MODE === "auto" || env.CLASSIFIER_MODE === "suggest"
    ? env.CLASSIFIER_MODE
    : "shadow";
  const max = Math.min(5, Math.max(1, Number(env.MAX_PER_RUN) || 3));
  const lookback = Math.min(30, Math.max(1, Number(env.POLL_LOOKBACK_DAYS) || 14));
  const finwise = new FinwiseHttp(env.FINWISE_API_KEY, env.FINWISE_BASE_URL);
  const summary: RunSummary = {
    seen: 0,
    classified: 0,
    skipped: 0,
    applied: 0,
    corrections: 0,
    inputTokens: 0,
    notionalUsd: 0,
    mode,
  };

  const [categories, txns, merchants, accounts] = await Promise.all([
    finwise.listCategories(),
    finwise.listRecent(isoDaysAgo(lookback), 50),
    finwise.listMerchants(),
    finwise.listAccounts(),
  ]);
  const options = buildCategoryOptions(categories);
  const nameById = new Map(options.map((category) => [category.id, category.name]));
  const accountNameById = new Map(accounts.map((account) => [account.id, account.name]));
  const windowFeatures = txns.map((txn) =>
    toFeatures({
      id: txn.id,
      date: txn.date,
      description: txn.description,
      amount: signedAmount(txn),
      merchantId: txn.merchantId,
      merchantName: merchantNameOf(txn, merchants),
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
  const featuresById = new Map(windowFeatures.map((row) => [row.id, row]));
  const relations = resolveRelations(windowFeatures, accounts);
  const byName = new Map(options.map((category) => [category.name, category.id]));
  const model = createBindingJevModel({ ai: env.AI, gatewayId: env.AI_GATEWAY_ID });

  for (const txn of txns) {
    if (summary.classified >= max) break;
    summary.seen += 1;
    const features = featuresById.get(txn.id);
    if (!features) continue;
    const hash = txFeatureHash(features);
    const existing = await env.DB.prepare(
      "SELECT observed_category_id, predicted_category_name, applied FROM audits WHERE transaction_id = ? AND classifier_version = ? AND feature_hash = ?",
    )
      .bind(txn.id, env.CLASSIFIER_VERSION, hash)
      .first<{ observed_category_id: string | null; predicted_category_name: string | null; applied: number }>();

    const writes = await env.DB.prepare(
      "SELECT transaction_id, category_id, written_at FROM writes WHERE transaction_id = ?",
    )
      .bind(txn.id)
      .all<{ transaction_id: string; category_id: string; written_at: string }>();
    const writeRows = (writes.results ?? []).map((row) => ({
      transactionId: row.transaction_id,
      categoryId: row.category_id,
      writtenAt: row.written_at,
    }));
    const kind = observeCategoryChange({
      transactionId: txn.id,
      currentCategoryId: txn.transactionCategoryId,
      lastAppliedCategoryId: existing?.applied
        ? byName.get(existing.predicted_category_name ?? "") ?? null
        : null,
      writes: writeRows,
    });
    const categoryChanged = Boolean(
      existing && existing.observed_category_id !== txn.transactionCategoryId,
    );
    if (categoryChanged && txn.transactionCategoryId) {
      const name = options.find((c) => c.id === txn.transactionCategoryId)?.name ?? null;
      await recordCategoryEvent(env, {
        transactionId: txn.id,
        categoryId: txn.transactionCategoryId,
        categoryName: name,
        previousCategoryId: existing?.observed_category_id ?? null,
        merchantId: txn.merchantId,
        accountId: txn.accountId,
        descriptionFingerprint: correctionFingerprint(features),
        observedAt: txn.updatedAt,
      });
      summary.corrections += 1;
    }
    if (!existing && txn.transactionCategoryId) {
      await recordCategoryEvent(env, {
        transactionId: txn.id,
        categoryId: txn.transactionCategoryId,
        categoryName: nameById.get(txn.transactionCategoryId) ?? null,
        previousCategoryId: null,
        merchantId: txn.merchantId,
        accountId: txn.accountId,
        descriptionFingerprint: correctionFingerprint(features),
        observedAt: txn.updatedAt,
      });
    }
    if (existing && !categoryChanged) {
      summary.skipped += 1;
      continue;
    }
    if (kind === "our_write") {
      summary.skipped += 1;
      continue;
    }

    const history = windowFeatures.filter(
      (row) => row.id !== features.id && row.categoryName && row.date.slice(0, 10) < features.date.slice(0, 10),
    );
    const relation = relations.get(features.id) ?? {
      accountName: features.accountName,
      accountType: null,
      counterpartyKey: features.merchantKey,
      ownAccount: null,
      pair: null,
      nature: features.direction === "debit" ? "purchase" as const : "other" as const,
      pairKey: `${features.accountName} -> ${features.merchantKey}`,
    };
    const retrieval = buildRetrieval(history, relations);
    const candidates = selectCandidates({ tx: features, relation, retrieval, categories: options });
    const decision = await classifyTransaction({
      tx: features,
      categories: options.filter((category) => candidates.names.includes(category.name)),
      evidence: { byMerchant: new Map(), exemplarsByCategory: new Map() },
      corrections: new Map(),
      policy: CONSERVATIVE_POLICY,
      mode: "jev",
      model,
      jevRequest: buildContrastiveJevRequest({
        tx: features,
        relation,
        retrieval,
        categories: options,
        candidates,
      }),
    });
    summary.classified += 1;
    summary.inputTokens += decision.inputTokens;
    summary.notionalUsd += notionalUsd(decision.inputTokens);

    let applied = 0;
    const predictedId = decision.categoryName ? byName.get(decision.categoryName) ?? null : null;
    const uncategorised = !txn.transactionCategoryId;
    if (
      mayAutoApply({
        mode,
        accept: decision.accept,
        uncategorised,
        kind,
      }) &&
      predictedId
    ) {
      await finwise.updateCategory(txn.id, predictedId);
      await env.DB.prepare(
        "INSERT INTO writes (id, transaction_id, category_id, written_at) VALUES (?, ?, ?, ?)",
      )
        .bind(crypto.randomUUID(), txn.id, predictedId, new Date().toISOString())
        .run();
      applied = 1;
      summary.applied += 1;
    }

    await env.DB.prepare(
      `INSERT INTO audits (
        id, transaction_id, feature_hash, observed_category_id, predicted_category_name,
        source, confidence, margin, top_probability, model, classifier_version,
        input_tokens, notional_usd, applied, accept, mode, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        txn.id,
        hash,
        txn.transactionCategoryId,
        decision.categoryName,
        decision.source,
        decision.confidence,
        decision.margin,
        decision.topProbability,
        decision.model,
        env.CLASSIFIER_VERSION,
        decision.inputTokens,
        notionalUsd(decision.inputTokens),
        applied,
        decision.accept ? 1 : 0,
        mode,
        new Date().toISOString(),
      )
      .run();
  }

  return summary;
}

async function recordCategoryEvent(
  env: ClassifierEnv,
  event: {
    transactionId: string;
    categoryId: string;
    categoryName: string | null;
    previousCategoryId: string | null;
    merchantId: string | null;
    accountId: string;
    descriptionFingerprint: string;
    observedAt: string | null;
  },
): Promise<void> {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/classifier_category_events`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      transaction_id: event.transactionId,
      observed_at: event.observedAt ?? new Date().toISOString(),
      category_id: event.categoryId,
      category_name: event.categoryName,
      previous_category_id: event.previousCategoryId,
      merchant_id: event.merchantId,
      account_id: event.accountId,
      description_fingerprint: event.descriptionFingerprint,
      source: "poll",
    }),
  });
}

export function logSummary(summary: RunSummary): void {
  console.log(
    JSON.stringify({
      msg: "classifier_run",
      mode: summary.mode,
      seen: summary.seen,
      classified: summary.classified,
      skipped: summary.skipped,
      applied: summary.applied,
      corrections: summary.corrections,
      input_tokens: summary.inputTokens,
      notional_usd: Number(summary.notionalUsd.toFixed(6)),
    }),
  );
}

export type { FinwiseTxn };
