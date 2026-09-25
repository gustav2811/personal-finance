import type { TxFeatures } from "./types.js";

export interface CategoryRule {
  id: string;
  categoryName: string;
  combinedRegex: string;
  minAmountExclusive?: number;
  maxAmountExclusive?: number;
}

export const DEFAULT_CATEGORY_RULES: CategoryRule[] = [
  {
    id: "tfsa",
    categoryName: "Investments",
    combinedRegex: "tfsa",
    maxAmountExclusive: 0,
  },
  {
    id: "mortgage-memo",
    categoryName: "Mortgage",
    combinedRegex: "mortgage",
    maxAmountExclusive: 0,
  },
  {
    id: "gods-money",
    categoryName: "Donations",
    combinedRegex: "gods money",
    maxAmountExclusive: 0,
  },
  {
    id: "salary-sal",
    categoryName: "Salaries & Wages",
    combinedRegex: "\\bsal\\b",
    minAmountExclusive: 0,
  },
  {
    id: "tsafrika-canteen",
    categoryName: "Work Eats",
    combinedRegex: "tsafrika",
    maxAmountExclusive: 0,
  },
];

export function signedAmount(tx: Pick<TxFeatures, "direction" | "amountAbs">): number {
  return tx.direction === "debit" ? -tx.amountAbs : tx.amountAbs;
}

export function matchFirstRule(
  tx: TxFeatures,
  rules: readonly CategoryRule[] = DEFAULT_CATEGORY_RULES,
): { ruleId: string; categoryName: string } | null {
  const text = `${tx.merchantKey} ${tx.descriptionNorm} ${tx.notesNorm}`;
  const amount = signedAmount(tx);
  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.combinedRegex, "i");
    } catch {
      continue;
    }
    if (!re.test(text)) continue;
    if (rule.minAmountExclusive !== undefined && !(amount > rule.minAmountExclusive)) continue;
    if (rule.maxAmountExclusive !== undefined && !(amount < rule.maxAmountExclusive)) continue;
    return { ruleId: rule.id, categoryName: rule.categoryName };
  }
  return null;
}
