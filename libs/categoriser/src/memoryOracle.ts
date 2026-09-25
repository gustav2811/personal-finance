import { descriptorKey, recurringKey } from "./retrieve.js";
import type { ResolvedRelation } from "./relations.js";
import type { TxFeatures } from "./types.js";

export type MemorySignature =
  | "merchant"
  | "merchant_descriptor"
  | "account_merchant"
  | "account_counterparty"
  | "account_destination"
  | "account_description"
  | "recurring_amount_account"
  | "approved_relationship";

export interface ApprovedRelationship {
  sourceAccountId: string;
  destinationAccountId: string | null;
  counterpartyKey: string | null;
  direction: "debit" | "credit" | null;
  categoryName: string;
}

export interface OracleThresholds {
  minSupport: number;
  minPurity: number;
}

export const RELIABLE_MEMORY: OracleThresholds = { minSupport: 3, minPurity: 0.8 };
export const PURE_MEMORY: OracleThresholds = { minSupport: 5, minPurity: 1 };

export interface SignatureObservation {
  kind: MemorySignature;
  support: number;
  purity: number;
  majority: string | null;
}

export interface MemoryOracleRow {
  id: string;
  actual: string;
  observations: SignatureObservation[];
  selected: SignatureObservation | null;
  recoverable: boolean;
}

export interface SignatureReport {
  kind: MemorySignature;
  fired: number;
  coverage: number;
  correct: number;
  accuracyWhenFired: number | null;
  medianSupport: number | null;
  meanPurity: number | null;
}

export interface SelectorReport {
  fired: number;
  coverage: number;
  correct: number;
  accuracy: number;
  accuracyWhenFired: number | null;
  byKind: Record<string, number>;
}

export interface MemoryOracleReport {
  n: number;
  thresholds: OracleThresholds;
  signatures: SignatureReport[];
  selected: SelectorReport;
  recoverableFraction: number;
}

const SPECIFICITY: Record<MemorySignature, number> = {
  approved_relationship: 8,
  account_destination: 7,
  account_counterparty: 6,
  account_merchant: 5,
  merchant_descriptor: 4,
  account_description: 3,
  recurring_amount_account: 2,
  merchant: 1,
};

const AMBIGUOUS_PAIRS: readonly (readonly [string, string])[] = [
  ["Work Eats", "Eating Out & Takeaways"],
  ["Transfers", "Savings"],
  ["Transfers", "Investments"],
  ["Transfers", "Mortgage"],
  ["Transfers", "Card Repayments"],
  ["Cash", "Investments"],
  ["Groceries", "General Purchases"],
  ["Eating Out & Takeaways", "Coffee"],
];

const MOVEMENT_CATEGORIES = new Set([
  "Transfers",
  "Savings",
  "Investments",
  "Mortgage",
  "Card Repayments",
  "Loans",
]);

export type AdjudicationBucket =
  | "jev_definitely_wrong"
  | "label_conflicts_with_pure_history"
  | "both_defensible"
  | "insufficient_transaction_information"
  | "household_rule_missing"
  | "relationship_context_missing";

interface Bucket {
  total: number;
  counts: Record<string, number>;
}

function dayOf(row: TxFeatures): string {
  return row.date.slice(0, 10);
}

function majorityOf(bucket: Bucket): { majority: string | null; purity: number } {
  let majority: string | null = null;
  let count = 0;
  for (const [name, seen] of Object.entries(bucket.counts)) {
    if (seen > count || (seen === count && majority !== null && name < majority)) {
      majority = name;
      count = seen;
    }
  }
  return {
    majority,
    purity: bucket.total === 0 ? 0 : count / bucket.total,
  };
}

function add(index: Map<string, Bucket>, key: string, category: string): void {
  const bucket = index.get(key) ?? { total: 0, counts: {} };
  bucket.counts[category] = (bucket.counts[category] ?? 0) + 1;
  bucket.total += 1;
  index.set(key, bucket);
}

function observe(index: Map<string, Bucket>, kind: MemorySignature, key: string | null): SignatureObservation | null {
  if (!key) return null;
  const bucket = index.get(key);
  if (!bucket || bucket.total < 1) return null;
  const { majority, purity } = majorityOf(bucket);
  return { kind, support: bucket.total, purity, majority };
}

export function pastDestination(
  row: TxFeatures,
  relation: ResolvedRelation | undefined,
  byId: ReadonlyMap<string, TxFeatures>,
): { id: string; name: string } | null {
  if (!relation) return null;
  if (relation.pair) {
    const other = byId.get(relation.pair.otherId);
    if (other && dayOf(other) <= dayOf(row)) {
      return { id: relation.pair.otherAccountId, name: relation.pair.otherAccountName };
    }
  }
  if (relation.ownAccount) return relation.ownAccount;
  return null;
}

function descriptionPhrase(row: TxFeatures): string {
  const tokens = (row.notesNorm || row.descriptionNorm).split(" ").filter(Boolean).slice(0, 4);
  return tokens.join(" ");
}

function merchantIdentity(row: TxFeatures): string | null {
  const key = row.merchantId || row.merchantKey;
  if (!key || key === "unknown") return null;
  return key;
}

function approvedKey(
  row: TxFeatures,
  destinationId: string | null,
  counterpartyKey: string,
  relationships: readonly ApprovedRelationship[],
): string | null {
  const match = relationships.find((item) =>
    item.sourceAccountId === row.accountId &&
    (item.direction === null || item.direction === row.direction) &&
    (
      (destinationId !== null && item.destinationAccountId === destinationId) ||
      (item.counterpartyKey !== null && item.counterpartyKey === counterpartyKey)
    ),
  );
  if (!match) return null;
  return `${match.sourceAccountId}|${match.destinationAccountId ?? ""}|${match.counterpartyKey ?? ""}|${match.direction ?? ""}|${match.categoryName}`;
}

function keysFor(
  row: TxFeatures,
  relation: ResolvedRelation | undefined,
  byId: ReadonlyMap<string, TxFeatures>,
  relationships: readonly ApprovedRelationship[],
): Map<MemorySignature, string> {
  const keys = new Map<MemorySignature, string>();
  const merchant = merchantIdentity(row);
  if (merchant) keys.set("merchant", merchant);
  const described = descriptorKey(row);
  if (described) keys.set("merchant_descriptor", described);
  if (merchant) keys.set("account_merchant", `${row.accountId}|${merchant}`);
  const counterparty = relation?.counterpartyKey || row.merchantKey;
  if (counterparty && counterparty !== "unknown") {
    keys.set("account_counterparty", `${row.accountId}|${counterparty}|${row.direction}`);
  }
  const destination = pastDestination(row, relation, byId);
  if (destination) {
    keys.set("account_destination", `${row.accountId}->${destination.id}|${row.direction}`);
  }
  const phrase = descriptionPhrase(row);
  if (phrase) keys.set("account_description", `${row.accountId}|${phrase}`);
  keys.set("recurring_amount_account", recurringKey(row, relation?.accountName || row.accountName));
  const approved = approvedKey(row, destination?.id ?? null, counterparty, relationships);
  if (approved) keys.set("approved_relationship", approved);
  return keys;
}

function meets(observation: SignatureObservation, thresholds: OracleThresholds): boolean {
  return observation.support >= thresholds.minSupport &&
    observation.purity + 1e-9 >= thresholds.minPurity &&
    observation.majority !== null;
}

function choose(observations: readonly SignatureObservation[], thresholds: OracleThresholds): SignatureObservation | null {
  const firing = observations.filter((observation) => meets(observation, thresholds));
  firing.sort((a, b) =>
    b.purity - a.purity ||
    b.support - a.support ||
    SPECIFICITY[b.kind] - SPECIFICITY[a.kind] ||
    a.kind.localeCompare(b.kind),
  );
  return firing[0] ?? null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const left = sorted[mid - 1];
  const right = sorted[mid];
  if (sorted.length % 2 === 1) return right ?? null;
  if (left === undefined || right === undefined) return null;
  return (left + right) / 2;
}

export function runMemoryOracle(input: {
  corpus: readonly TxFeatures[];
  evalRows: readonly TxFeatures[];
  relations: ReadonlyMap<string, ResolvedRelation>;
  byId: ReadonlyMap<string, TxFeatures>;
  relationships?: readonly ApprovedRelationship[];
  thresholds?: OracleThresholds;
}): { rows: MemoryOracleRow[]; report: MemoryOracleReport } {
  const thresholds = input.thresholds ?? RELIABLE_MEMORY;
  const relationships = input.relationships ?? [];
  const indexes = new Map<MemorySignature, Map<string, Bucket>>();
  const kinds = Object.keys(SPECIFICITY) as MemorySignature[];
  for (const kind of kinds) indexes.set(kind, new Map());
  const corpus = [...input.corpus]
    .filter((row) => row.categoryName)
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.id.localeCompare(b.id));
  const evalRows = [...input.evalRows]
    .filter((row) => row.categoryName)
    .sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || a.id.localeCompare(b.id));
  let cursor = 0;
  const rows: MemoryOracleRow[] = [];
  for (const row of evalRows) {
    const actual = row.categoryName;
    if (!actual) continue;
    while (cursor < corpus.length && dayOf(corpus[cursor]!) < dayOf(row)) {
      const past = corpus[cursor]!;
      cursor += 1;
      if (!past.categoryName) continue;
      const keys = keysFor(past, input.relations.get(past.id), input.byId, relationships);
      for (const [kind, key] of keys) {
        add(indexes.get(kind)!, key, past.categoryName);
      }
    }
    const queryKeys = keysFor(row, input.relations.get(row.id), input.byId, relationships);
    const observations: SignatureObservation[] = [];
    for (const kind of kinds) {
      const seen = observe(indexes.get(kind)!, kind, queryKeys.get(kind) ?? null);
      if (seen) observations.push(seen);
    }
    const selected = choose(observations, thresholds);
    rows.push({
      id: row.id,
      actual,
      observations,
      selected,
      recoverable: observations.some((observation) => meets(observation, thresholds) && observation.majority === actual),
    });
  }
  return { rows, report: summarise(rows, thresholds) };
}

function hitFor(
  row: MemoryOracleRow,
  kind: MemorySignature,
  thresholds: OracleThresholds,
): SignatureObservation | undefined {
  return row.observations.find((observation) => observation.kind === kind && meets(observation, thresholds));
}

function summarise(rows: readonly MemoryOracleRow[], thresholds: OracleThresholds): MemoryOracleReport {
  const kinds = Object.keys(SPECIFICITY) as MemorySignature[];
  const signatures = kinds.map((kind) => {
    const matched = rows.flatMap((row) => {
      const hit = hitFor(row, kind, thresholds);
      return hit ? [{ row, hit }] : [];
    });
    const correct = matched.filter((item) => item.hit.majority === item.row.actual).length;
    return {
      kind,
      fired: matched.length,
      coverage: rows.length === 0 ? 0 : matched.length / rows.length,
      correct,
      accuracyWhenFired: matched.length === 0 ? null : correct / matched.length,
      medianSupport: median(matched.map((item) => item.hit.support)),
      meanPurity: matched.length === 0 ? null : matched.reduce((sum, item) => sum + item.hit.purity, 0) / matched.length,
    };
  });
  const selectedHits = rows.filter((row) => row.selected);
  const selectedCorrect = selectedHits.filter((row) => row.selected?.majority === row.actual).length;
  const byKind: Record<string, number> = {};
  for (const row of selectedHits) {
    const kind = row.selected?.kind;
    if (!kind) continue;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }
  return {
    n: rows.length,
    thresholds,
    signatures,
    selected: {
      fired: selectedHits.length,
      coverage: rows.length === 0 ? 0 : selectedHits.length / rows.length,
      correct: selectedCorrect,
      accuracy: rows.length === 0 ? 0 : selectedCorrect / rows.length,
      accuracyWhenFired: selectedHits.length === 0 ? null : selectedCorrect / selectedHits.length,
      byKind,
    },
    recoverableFraction: rows.length === 0 ? 0 : rows.filter((row) => row.recoverable).length / rows.length,
  };
}

export function ambiguousPair(left: string, right: string): boolean {
  return AMBIGUOUS_PAIRS.some((pair) =>
    (pair[0] === left && pair[1] === right) || (pair[0] === right && pair[1] === left),
  );
}

export function adjudicateDisagreement(input: {
  actual: string;
  predicted: string;
  observations: readonly SignatureObservation[];
}): { bucket: AdjudicationBucket; basis: string } {
  const pure = input.observations.filter((observation) => observation.support >= PURE_MEMORY.minSupport && observation.purity === 1);
  if (pure.some((observation) => observation.majority === input.actual)) {
    return {
      bucket: "jev_definitely_wrong",
      basis: "A past-only signature with support at least 5 and purity 1 already matches the label.",
    };
  }
  if (pure.some((observation) => observation.majority === input.predicted)) {
    return {
      bucket: "label_conflicts_with_pure_history",
      basis: "A past-only signature with support at least 5 and purity 1 matches the prediction, not the label. This is a review candidate, not a human correction.",
    };
  }
  const destination = input.observations.find((observation) => observation.kind === "account_destination");
  const movement = MOVEMENT_CATEGORIES.has(input.actual) || MOVEMENT_CATEGORIES.has(input.predicted);
  if (movement && (!destination || destination.support < 2)) {
    return {
      bucket: "relationship_context_missing",
      basis: "The disagreement is a movement category and there is no past source-to-destination signature with support 2.",
    };
  }
  if (ambiguousPair(input.actual, input.predicted)) {
    return {
      bucket: "both_defensible",
      basis: "The label and the prediction are a known close pair, and no pure historical signature separates them.",
    };
  }
  const anySupport = input.observations.some((observation) => observation.support >= 2);
  if (!anySupport) {
    return {
      bucket: "insufficient_transaction_information",
      basis: "No past-only signature has support 2.",
    };
  }
  return {
    bucket: "household_rule_missing",
    basis: "History exists, but no pure signature and no close-pair rule explains the disagreement.",
  };
}
