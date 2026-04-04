import type { CanonicalTransaction } from "../../parsers/types.js";
import rawRules from "./category-rules.json" with { type: "json" };
import { combinedNormalizedText } from "./normalize.js";

export interface CategoryRule {
  id: string;
  categoryName: string;
  /** Case-insensitive regex tested against normalized counterparty + description. */
  combinedRegex: string;
  /** If set, amount must be strictly greater than this (e.g. 0 for credits only). */
  minAmountExclusive?: number;
  /** If set, amount must be strictly less than this (e.g. 0 for debits only). */
  maxAmountExclusive?: number;
}

function parseRules(data: unknown): CategoryRule[] {
  if (!Array.isArray(data)) return [];
  const out: CategoryRule[] = [];
  for (const item of data) {
    if (item == null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.categoryName !== "string") continue;
    if (typeof o.combinedRegex !== "string") continue;
    const rule: CategoryRule = {
      id: o.id,
      categoryName: o.categoryName,
      combinedRegex: o.combinedRegex,
    };
    if (typeof o.minAmountExclusive === "number") {
      rule.minAmountExclusive = o.minAmountExclusive;
    }
    if (typeof o.maxAmountExclusive === "number") {
      rule.maxAmountExclusive = o.maxAmountExclusive;
    }
    out.push(rule);
  }
  return out;
}

/** High-precision defaults from `category-rules.json`; extend over time. */
export const DEFAULT_CATEGORY_RULES: CategoryRule[] = parseRules(rawRules);

export interface RuleMatch {
  ruleId: string;
  categoryName: string;
}

export function matchFirstRule(
  tx: CanonicalTransaction,
  rules: CategoryRule[],
): RuleMatch | null {
  const text = combinedNormalizedText(tx.counterparty, tx.description);
  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.combinedRegex, "i");
    } catch {
      continue;
    }
    if (!re.test(text)) continue;
    if (
      rule.minAmountExclusive !== undefined &&
      !(tx.amount > rule.minAmountExclusive)
    ) {
      continue;
    }
    if (
      rule.maxAmountExclusive !== undefined &&
      !(tx.amount < rule.maxAmountExclusive)
    ) {
      continue;
    }
    return { ruleId: rule.id, categoryName: rule.categoryName };
  }
  return null;
}
