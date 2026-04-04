import { describe, it, expect } from "vitest";
import { matchFirstRule, DEFAULT_CATEGORY_RULES } from "../rules.js";
import type { CanonicalTransaction } from "../../../parsers/types.js";

const baseMeta = {
  bank: "bank_zero",
  source_email: "a@b.co",
  filename: "f.xlsx",
};

function tx(partial: Partial<CanonicalTransaction>): CanonicalTransaction {
  return {
    external_id: partial.external_id ?? "e1",
    account_id: partial.account_id ?? "a1",
    date: partial.date ?? "2026-03-24",
    amount: partial.amount ?? -100,
    currency: partial.currency ?? "ZAR",
    description: partial.description ?? "",
    counterparty: partial.counterparty,
    raw: partial.raw,
    meta: partial.meta ?? baseMeta,
  };
}

describe("matchFirstRule", () => {
  it("matches TFSA memo on debit", () => {
    const m = matchFirstRule(
      tx({
        counterparty: "Carina Van Der Colff",
        description: "TFSA",
        amount: -3000,
      }),
      DEFAULT_CATEGORY_RULES,
    );
    expect(m?.categoryName).toBe("Investments");
  });

  it("matches salary on credit with SAL token", () => {
    const m = matchFirstRule(
      tx({
        counterparty: "Standard bank",
        description: "BEF1 SAL 4226630029253311LLAL",
        amount: 77_083.53,
      }),
      DEFAULT_CATEGORY_RULES,
    );
    expect(m?.categoryName).toBe("Salaries & Wages");
  });

  it("does not match salary rule on debit", () => {
    const m = matchFirstRule(
      tx({
        description: "BEF1 SAL 4226630029253311LLAL",
        amount: -100,
      }),
      DEFAULT_CATEGORY_RULES,
    );
    expect(m).toBeNull();
  });

  it("matches Tsafrika office canteen supplier on debit", () => {
    const m = matchFirstRule(
      tx({
        counterparty: "Tsafrika Headoffice",
        description: "Sandton, Apple Pay on Caras I...",
        amount: -62,
      }),
      DEFAULT_CATEGORY_RULES,
    );
    expect(m?.ruleId).toBe("tsafrika-canteen");
    expect(m?.categoryName).toBe("Work Eats");
  });
});
