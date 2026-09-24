import { criterionFor } from "../criteria.js";
import type { CategoryOption, EvidenceIndex, JevVariant, TxFeatures } from "../types.js";

export const CATEGORY_QUESTION = "category";

export function buildCategoryOptions(
  categories: readonly { id: string; name: string }[],
  evidence?: EvidenceIndex,
  includeExemplars = false,
): CategoryOption[] {
  return categories.map((category) => {
    const base = criterionFor(category.name);
    const exemplars = includeExemplars
      ? evidence?.exemplarsByCategory.get(category.name) ?? []
      : [];
    const criterion = exemplars.length
      ? `${base}. Frequent merchants: ${exemplars.join(", ")}`
      : base;
    return {
      id: category.id,
      name: category.name,
      slug: slugOf(category.name),
      criterion,
    };
  });
}

export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export function buildJevRequest(input: {
  tx: TxFeatures;
  categories: readonly CategoryOption[];
  variant: JevVariant;
  evidence?: EvidenceIndex;
  includeAmount?: boolean;
}): { state: Record<string, unknown>; questions: Record<string, unknown> } {
  const includeAmount = input.includeAmount !== false;
  const state: Record<string, unknown> = {
    merchant: input.tx.merchantKey,
    description: input.tx.descriptionNorm,
    direction: input.tx.direction,
    transfer: input.tx.isTransfer,
  };
  if (input.tx.notesNorm) state.memo = input.tx.notesNorm.slice(0, 80);
  if (includeAmount) state.amountBucket = input.tx.amountBucket;
  if (input.variant === "history_hint" && input.evidence) {
    const stat = input.evidence.byMerchant.get(input.tx.merchantKey);
    if (stat && stat.total >= 2 && stat.majority) {
      state.prior = {
        support: stat.total,
        majority: stat.majority,
        purity: Number(stat.purity.toFixed(2)),
      };
    }
  }
  const criteria: Record<string, string> = {};
  for (const category of input.categories) {
    criteria[category.slug] =
      input.variant === "names" ? category.name : category.criterion;
  }
  return {
    state,
    questions: {
      [CATEGORY_QUESTION]: {
        type: "choice",
        instructions:
          "Choose the single best personal-finance category. Use the merchant, description, direction, and any prior counts. Do not pick a category the text does not support.",
        criteria,
      },
    },
  };
}
