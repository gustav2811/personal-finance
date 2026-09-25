import { correctionFingerprint } from "./features.js";
import { historyAccepts, jevAccepts, probabilityMargin } from "./policy.js";
import { matchFirstRule } from "./rules.js";
import type {
  AcceptancePolicy,
  CategoryOption,
  ClassificationDecision,
  DecisionModel,
  EvidenceIndex,
  TxFeatures,
} from "./types.js";

export type ClassifyMode = "history" | "rules" | "jev" | "hybrid";

function emptyDecision(
  source: ClassificationDecision["source"],
  accept: boolean,
): ClassificationDecision {
  return {
    categoryName: null,
    categorySlug: null,
    source,
    confidence: 0,
    margin: 0,
    topProbability: 0,
    probabilities: {},
    model: null,
    inputTokens: 0,
    accept,
  };
}

function named(
  categoryName: string,
  categories: readonly CategoryOption[],
  source: ClassificationDecision["source"],
  confidence: number,
  accept: boolean,
): ClassificationDecision {
  const match = categories.find((category) => category.name === categoryName);
  return {
    categoryName,
    categorySlug: match?.slug ?? null,
    source,
    confidence,
    margin: 1,
    topProbability: confidence,
    probabilities: { [match?.slug ?? categoryName]: confidence },
    model: null,
    inputTokens: 0,
    accept: Boolean(match) && accept,
  };
}

export async function classifyTransaction(input: {
  tx: TxFeatures;
  categories: readonly CategoryOption[];
  evidence: EvidenceIndex;
  corrections: ReadonlyMap<string, string>;
  policy: AcceptancePolicy;
  mode: ClassifyMode;
  model?: DecisionModel | null;
  jevRequest?: { state: unknown; questions: Record<string, unknown> };
}): Promise<ClassificationDecision> {
  if (input.mode === "history") {
    const corrected = input.corrections.get(correctionFingerprint(input.tx));
    if (corrected) return named(corrected, input.categories, "correction", 1, true);
    const stat = input.evidence.byMerchant.get(input.tx.merchantKey);
    if (stat?.majority && historyAccepts(stat, input.policy)) {
      return named(stat.majority, input.categories, "history", stat.purity, true);
    }
    return emptyDecision("abstain", false);
  }

  if (input.mode === "rules") {
    const rule = matchFirstRule(input.tx);
    if (rule) return named(rule.categoryName, input.categories, "rule", 1, true);
    return emptyDecision("abstain", false);
  }

  if (!input.model || !input.jevRequest) return emptyDecision("abstain", false);
  const choice = await input.model.classify(input.jevRequest);
  const margin = probabilityMargin(choice.probabilities);
  const category = input.categories.find((item) => item.slug === choice.choice);
  const top = margin.top || choice.confidence;
  const accept = Boolean(category) && jevAccepts(choice.confidence, top, margin.margin, input.policy);
  return {
    categoryName: category?.name ?? null,
    categorySlug: category?.slug ?? null,
    source: category ? "jev" : "abstain",
    confidence: choice.confidence,
    margin: margin.margin,
    topProbability: top,
    probabilities: choice.probabilities,
    model: choice.model,
    inputTokens: choice.usage.inputTokens,
    accept,
  };
}
