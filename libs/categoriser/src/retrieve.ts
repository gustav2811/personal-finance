import { criterionFor } from "./criteria.js";
import { slugOf } from "./jev/build.js";
import { matchFirstRule } from "./rules.js";
import type { ResolvedRelation } from "./relations.js";
import type { CategoryOption, TxFeatures } from "./types.js";

export interface SignatureStat {
  total: number;
  counts: Record<string, number>;
  majority: string | null;
  purity: number;
}

export interface RetrievalIndex {
  merchant: Map<string, SignatureStat>;
  descriptor: Map<string, SignatureStat>;
  pair: Map<string, SignatureStat>;
  recurring: Map<string, SignatureStat>;
  description: Map<string, SignatureStat>;
  token: Map<string, SignatureStat>;
  rows: readonly TxFeatures[];
}

export interface CandidateSet {
  names: string[];
  reasons: Record<string, string>;
}

const MAX_CANDIDATES = 8;
const MOVEMENT_FAMILY = ["Transfers", "Mortgage", "Investments", "Savings", "Card Repayments"];

export function buildRetrieval(
  history: readonly TxFeatures[],
  relations: ReadonlyMap<string, ResolvedRelation>,
): RetrievalIndex {
  const merchant = new Map<string, SignatureStat>();
  const descriptor = new Map<string, SignatureStat>();
  const pair = new Map<string, SignatureStat>();
  const recurring = new Map<string, SignatureStat>();
  const description = new Map<string, SignatureStat>();
  const token = new Map<string, SignatureStat>();
  for (const row of history) {
    if (!row.categoryName) continue;
    addCount(merchant, row.merchantId || row.merchantKey, row.categoryName);
    const described = descriptorKey(row);
    if (described) addCount(descriptor, described, row.categoryName);
    const relation = relations.get(row.id);
    if (relation) {
      addCount(pair, relation.pairKey, row.categoryName);
      addCount(recurring, recurringKey(row, relation.accountName), row.categoryName);
    }
    addCount(description, descriptionKey(row), row.categoryName);
    for (const word of contentTokens(row)) addCount(token, word, row.categoryName);
  }
  return { merchant, descriptor, pair, recurring, description, token, rows: history };
}

export function selectCandidates(input: {
  tx: TxFeatures;
  relation: ResolvedRelation;
  retrieval: RetrievalIndex;
  categories: readonly CategoryOption[];
}): CandidateSet {
  const known = new Set(input.categories.map((category) => category.name));
  const names: string[] = [];
  const reasons: Record<string, string> = {};
  const push = (name: string | null | undefined, reason: string) => {
    if (!name || !known.has(name) || names.includes(name) || names.length >= MAX_CANDIDATES) return;
    names.push(name);
    reasons[name] = reason;
  };
  push(input.tx.finwiseCategoryName, "finwise_hint");
  const described = input.retrieval.descriptor.get(descriptorKey(input.tx));
  if (described && described.total >= 2) push(described.majority, "descriptor_history");
  const merchant = input.retrieval.merchant.get(input.tx.merchantId || input.tx.merchantKey);
  for (const name of topNames(merchant, 3)) push(name, "merchant_history");
  const pair = input.retrieval.pair.get(input.relation.pairKey);
  if (pair && pair.total >= 3 && pair.purity >= 0.8) push(pair.majority, "account_pair_history");
  const recurring = input.retrieval.recurring.get(recurringKey(input.tx, input.relation.accountName));
  if (recurring && recurring.total >= 3 && recurring.purity >= 0.8) push(recurring.majority, "recurring_amount");
  const description = input.retrieval.description.get(descriptionKey(input.tx));
  if (description && description.total >= 2) push(description.majority, "description_history");
  for (const name of lexiconCategories(input.tx, input.retrieval.token)) {
    push(name, "token_lexicon");
  }
  push(matchFirstRule(input.tx)?.categoryName ?? null, "rule");
  for (const example of nearestExamples(input.tx, input.retrieval.rows, 4)) {
    push(example.categoryName, "nearest");
  }
  if (input.relation.nature !== "purchase" && input.relation.nature !== "other") {
    for (const name of MOVEMENT_FAMILY) push(name, "movement_family");
  }
  if (names.length < 2) {
    push(secondCount(merchant), "merchant_runner_up");
    push(secondCount(pair), "account_pair_runner_up");
  }
  if (names.length < 2) {
    const fallback = input.relation.nature === "purchase" ? "Groceries" : "Transfers";
    push(fallback, "fallback");
    push("Other", "fallback");
  }
  return { names, reasons };
}

export function buildContrastiveJevRequest(input: {
  tx: TxFeatures;
  relation: ResolvedRelation;
  retrieval: RetrievalIndex;
  categories: readonly CategoryOption[];
  candidates: CandidateSet;
  businessHint?: string | null;
}): { state: Record<string, unknown>; questions: Record<string, unknown> } {
  const chosen = input.categories.filter((category) => input.candidates.names.includes(category.name));
  const merchant = input.retrieval.merchant.get(input.tx.merchantId || input.tx.merchantKey);
  const descriptor = input.retrieval.descriptor.get(descriptorKey(input.tx));
  const pair = input.retrieval.pair.get(input.relation.pairKey);
  const recurring = input.retrieval.recurring.get(recurringKey(input.tx, input.relation.accountName));
  const examples = nearestExamples(input.tx, input.retrieval.rows, 3).map((example) => ({
    description: example.descriptionNorm.slice(0, 60),
    category: example.categoryName,
  }));
  const state: Record<string, unknown> = {
    merchant_id: input.tx.merchantId,
    merchant_name: input.tx.merchantKey,
    raw_description: input.tx.descriptionNorm.slice(0, 80),
    direction: input.tx.direction,
    exact_amount: Number(input.tx.signedAmount.toFixed(2)),
    account_name: input.relation.accountName,
    account_type: input.relation.accountType,
    transfer: input.tx.isTransfer,
    nature: input.relation.nature,
    recurring_hint: pair && pair.total >= 3 ? "recurring_account_pattern" : null,
  };
  if (input.tx.notesNorm) state.memo = input.tx.notesNorm.slice(0, 80);
  if (input.businessHint) state.business_hint = input.businessHint.slice(0, 80);
  if (input.tx.finwiseCategoryName || input.tx.needsReview) {
    state.finwise = {
      proposed_category: input.tx.finwiseCategoryName,
      needs_review: input.tx.needsReview,
    };
  }
  if (input.relation.pair) {
    state.pair = {
      other_account: input.relation.pair.otherAccountName,
      day_gap: input.relation.pair.dayGap,
      amount_match: input.relation.pair.amountMatch,
      history: topCounts(pair),
    };
  } else if (input.relation.ownAccount) {
    state.own_account_mention = input.relation.ownAccount.name;
  }
  state.history = {
    merchant: topCounts(merchant),
    account_pair: topCounts(pair),
  };
  if (examples.length) state.nearest = examples;

  const criteria: Record<string, string> = {};
  for (const category of chosen) {
    const others = chosen
      .filter((item) => item.name !== category.name)
      .map((item) => item.name)
      .join(", ");
    const userCounts = [
      countPhrase("merchant", merchant, category.name),
      countPhrase("descriptor", descriptor, category.name),
      countPhrase("account pair", pair, category.name),
      countPhrase("recurring amount", recurring, category.name),
    ].filter(Boolean).join(" ");
    criteria[category.slug] =
      `${criterionFor(category.name)}. ${userCounts} Prefer this over ${others || "the other candidates"} only when those counts, the account, and the memo support it. FinWise's proposed category is a weak hint, not the answer.`.replace(/\s+/g, " ");
  }
  return {
    state,
    questions: {
      category: {
        type: "choice",
        instructions:
          "Choose one category from the criteria only. Discriminate between those candidates. Do not treat FinWise's proposed category as correct. Use the account, the exact amount, any paired opposite transaction, and this user's history.",
        criteria,
      },
    },
  };
}

export function categoryNameForSlug(
  slug: string,
  categories: readonly CategoryOption[],
): string | null {
  return categories.find((category) => category.slug === slug)?.name ?? null;
}

export function descriptorKey(row: TxFeatures): string {
  const merchantTokens = new Set(row.merchantKey.split(" ").filter((token) => token.length >= 3));
  const extra = [...new Set(
    `${row.descriptionNorm} ${row.notesNorm}`
      .split(" ")
      .filter((token) => token.length >= 4 && !merchantTokens.has(token)),
  )].sort().slice(0, 3);
  if (extra.length === 0) return "";
  return `${row.merchantId || row.merchantKey}|${extra.join(" ")}`;
}

export function recurringKey(row: TxFeatures, accountName: string): string {
  const rounded = row.amountAbs >= 1000 ? Math.round(row.amountAbs / 50) * 50 : Math.round(row.amountAbs);
  return `${accountName}|${row.direction}|${rounded}`;
}

const TOKEN_STOP = new Set([
  "payment", "transfer", "debit", "credit", "purchase", "card", "from", "with", "this", "that",
]);

export function contentTokens(row: TxFeatures): string[] {
  return [...new Set(
    `${row.merchantKey} ${row.descriptionNorm} ${row.notesNorm}`
      .split(" ")
      .filter((token) => token.length >= 4 && !TOKEN_STOP.has(token)),
  )];
}

function lexiconCategories(tx: TxFeatures, tokens: ReadonlyMap<string, SignatureStat>): string[] {
  const ranked = contentTokens(tx)
    .map((token) => tokens.get(token))
    .filter((stat): stat is SignatureStat => Boolean(stat && stat.total >= 2 && stat.purity >= 0.8 && stat.majority))
    .sort((a, b) => b.purity - a.purity || b.total - a.total || (a.majority ?? "").localeCompare(b.majority ?? ""));
  const names: string[] = [];
  for (const stat of ranked) {
    if (stat.majority && !names.includes(stat.majority)) names.push(stat.majority);
    if (names.length >= 3) break;
  }
  return names;
}

function countPhrase(label: string, stat: SignatureStat | undefined, category: string): string {
  if (!stat || !stat.counts[category]) return "";
  return `${label}: ${category} ${stat.counts[category]} of ${stat.total}.`;
}

function descriptionKey(row: TxFeatures): string {
  const tokens = (row.notesNorm || row.descriptionNorm).split(" ").filter(Boolean).slice(0, 4);
  return tokens.join(" ") || row.merchantKey;
}

function addCount(index: Map<string, SignatureStat>, key: string, category: string): void {
  const current = index.get(key) ?? { total: 0, counts: {}, majority: null, purity: 0 };
  current.counts[category] = (current.counts[category] ?? 0) + 1;
  current.total += 1;
  let majority: string | null = null;
  let majorityCount = 0;
  for (const [name, count] of Object.entries(current.counts)) {
    if (count > majorityCount) {
      majority = name;
      majorityCount = count;
    }
  }
  current.majority = majority;
  current.purity = current.total === 0 ? 0 : majorityCount / current.total;
  index.set(key, current);
}

function topNames(stat: SignatureStat | undefined, limit: number): string[] {
  if (!stat || stat.total < 1) return [];
  return Object.entries(stat.counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

function secondCount(stat: SignatureStat | undefined): string | null {
  if (!stat) return null;
  const ranked = Object.entries(stat.counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return ranked[1]?.[0] ?? null;
}

function topCounts(stat: SignatureStat | undefined): Record<string, number> | null {
  if (!stat || stat.total === 0) return null;
  return Object.fromEntries(
    Object.entries(stat.counts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 4),
  );
}

function nearestExamples(
  tx: TxFeatures,
  rows: readonly TxFeatures[],
  limit: number,
): TxFeatures[] {
  const query = new Set(tokensOf(tx));
  if (query.size === 0) return [];
  return rows
    .filter((row) => row.id !== tx.id && row.categoryName)
    .map((row) => ({ row, score: jaccard(query, tokensOf(row)) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id))
    .slice(0, limit)
    .map((item) => item.row);
}

function tokensOf(row: TxFeatures): Set<string> {
  return new Set(
    `${row.merchantKey} ${row.descriptionNorm} ${row.notesNorm}`
      .split(" ")
      .filter((token) => token.length >= 3),
  );
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function slugForCandidate(name: string): string {
  return slugOf(name);
}
