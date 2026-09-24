import { describe, expect, it } from "vitest";
import { createTransactionsApi } from "../../finwise/src/api/transactions.js";
import { classifyTransaction } from "./classify.js";
import { mayAutoApply, observeCategoryChange, shouldSkipRewrite } from "./corrections.js";
import { ExperimentBudget } from "./cost.js";
import { buildEvidence } from "./evidence.js";
import { correctionFingerprint, toFeatures } from "./features.js";
import { buildCategoryOptions, buildJevRequest } from "./jev/build.js";
import { parseJevChoice } from "./jev/parse.js";
import { accuracy, bestThreshold, coverageCurve, selective } from "./metrics.js";
import { merchantKey, normalizeText } from "./normalize.js";
import { CONSERVATIVE_POLICY } from "./policy.js";
import { matchFirstRule } from "./rules.js";

const categories = buildCategoryOptions([
  { id: "cat-groceries", name: "Groceries" },
  { id: "cat-coffee", name: "Coffee" },
  { id: "cat-investments", name: "Investments" },
]);

function tx(partial: {
  id: string;
  description: string;
  amount: number;
  merchantName?: string;
  notes?: string;
  categoryName?: string;
  date?: string;
}) {
  return toFeatures({
    id: partial.id,
    date: partial.date ?? "2026-01-15",
    description: partial.description,
    amount: partial.amount,
    merchantName: partial.merchantName,
    notes: partial.notes,
    categoryName: partial.categoryName ?? null,
    categoryId: partial.categoryName ? "id" : null,
    accountId: "acc",
  });
}

describe("normalize", () => {
  it("strips apple pay noise and store numbers", () => {
    expect(normalizeText("Woolworths, Apple Pay on 1234")).toBe("woolworths");
    expect(merchantKey(null, "Checkers 11169")).toBe("checkers");
  });
});

describe("evidence", () => {
  it("computes purity and ignores the held-out id", () => {
    const rows = [
      tx({ id: "1", description: "Woolworths", amount: -100, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "2", description: "Woolworths", amount: -80, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "3", description: "Woolworths", amount: -20, merchantName: "Woolworths", categoryName: "Coffee" }),
    ];
    const full = buildEvidence(rows);
    expect(full.byMerchant.get("woolworths")?.purity).toBeCloseTo(2 / 3);
    const held = buildEvidence(rows, new Set(["3"]));
    expect(held.byMerchant.get("woolworths")?.purity).toBe(1);
    expect(held.byMerchant.get("woolworths")?.total).toBe(2);
  });
});

describe("corrections", () => {
  it("treats our write as ours and a later different category as human", () => {
    expect(
      observeCategoryChange({
        transactionId: "t1",
        currentCategoryId: "b",
        lastAppliedCategoryId: "a",
        writes: [{ transactionId: "t1", categoryId: "a", writtenAt: "2026-01-01" }],
      }),
    ).toBe("human_correction");
    expect(
      observeCategoryChange({
        transactionId: "t1",
        currentCategoryId: "a",
        lastAppliedCategoryId: "a",
        writes: [{ transactionId: "t1", categoryId: "a", writtenAt: "2026-01-01" }],
      }),
    ).toBe("our_write");
    expect(
      shouldSkipRewrite({
        kind: "human_correction",
        predictedCategoryId: "a",
        currentCategoryId: "b",
      }),
    ).toBe(true);
    expect(
      mayAutoApply({ mode: "shadow", accept: true, uncategorised: true, kind: "external_label" }),
    ).toBe(false);
    expect(
      mayAutoApply({ mode: "auto", accept: true, uncategorised: true, kind: "human_correction" }),
    ).toBe(false);
    expect(
      mayAutoApply({ mode: "auto", accept: true, uncategorised: true, kind: "external_label" }),
    ).toBe(true);
  });
});

describe("rules", () => {
  it("matches TFSA debits to Investments", () => {
    const row = tx({ id: "1", description: "payment", amount: -100, notes: "TFSA" });
    expect(matchFirstRule(row)?.categoryName).toBe("Investments");
  });
});

describe("jev parse", () => {
  const choice = {
    type: "choice",
    choice: "groceries",
    confidence: 0.91,
    probabilities: { groceries: 0.8, coffee: 0.2 },
  };
  it("parses the binding shape and the gateway wrapper", () => {
    const direct = parseJevChoice(
      { model: "jev-1.13.0", answers: { category: choice }, usage: { input_tokens: 10, output_tokens: 2 } },
      "category",
    );
    const wrapped = parseJevChoice(
      { result: { state: "Completed", result: { model: "jev-1.13.0", answers: { category: choice }, usage: { input_tokens: 11, output_tokens: 1 } } }, success: true },
      "category",
    );
    expect(direct.choice).toBe("groceries");
    expect(wrapped.usage.inputTokens).toBe(11);
  });
  it("rejects malformed answers", () => {
    expect(() => parseJevChoice({ answers: { category: { type: "noul", noul: 1 } } }, "category")).toThrow();
  });
});

describe("classify", () => {
  it("uses history before the model and resolves categories by name when ids change", () => {
    const row = tx({ id: "9", description: "Woolworths", amount: -100, merchantName: "Woolworths" });
    const evidence = buildEvidence([
      tx({ id: "1", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "2", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "3", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "4", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "5", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
    ]);
    const renamed = buildCategoryOptions([{ id: "new-id", name: "Groceries" }]);
    return classifyTransaction({
      tx: row,
      categories: renamed,
      evidence,
      corrections: new Map(),
      policy: CONSERVATIVE_POLICY,
      mode: "hybrid",
      model: { classify: () => Promise.reject(new Error("should not call")) },
    }).then((decision) => {
      expect(decision.source).toBe("history");
      expect(decision.categoryName).toBe("Groceries");
      expect(decision.accept).toBe(true);
    });
  });

  it("does not overwrite a correction fingerprint", async () => {
    const row = tx({ id: "9", description: "Cafe", amount: -40, merchantName: "Cafe", notes: "latte" });
    const decision = await classifyTransaction({
      tx: row,
      categories,
      evidence: buildEvidence([]),
      corrections: new Map([[correctionFingerprint(row), "Coffee"]]),
      policy: CONSERVATIVE_POLICY,
      mode: "hybrid",
    });
    expect(decision.source).toBe("correction");
    expect(decision.categoryName).toBe("Coffee");
  });
});

describe("metrics and cost", () => {
  it("scores selective precision and stops the budget", () => {
    const rows = [
      { actual: "Coffee", predicted: "Coffee", accept: true, confidence: 0.99, margin: 0.9, topProbability: 0.99 },
      { actual: "Groceries", predicted: "Coffee", accept: false, confidence: 0.4, margin: 0.1, topProbability: 0.4 },
    ];
    expect(accuracy(rows)).toBe(0.5);
    expect(selective(rows).precision).toBe(1);
    const curve = coverageCurve(rows, [{ confidence: 0.9, probability: 0.9, margin: 0.5 }]);
    expect(bestThreshold(curve, 0.98)?.coverage).toBe(0.5);
    const budget = new ExperimentBudget(0.0000001);
    expect(() => budget.record(1000)).toThrow(/budget/);
  });
});

describe("jev request", () => {
  it("does not put the label into the state", () => {
    const row = tx({ id: "1", description: "Spar", amount: -20, categoryName: "Groceries" });
    const request = buildJevRequest({ tx: row, categories, variant: "descriptions" });
    expect(JSON.stringify(request.state)).not.toContain("Groceries");
  });
});

describe("finwise patch client", () => {
  it("PATCHes /transactions/:id with the category body", async () => {
    const calls: { method: string; path: string; body?: unknown }[] = [];
    const api = createTransactionsApi(async (method, path, body) => {
      calls.push({ method, path, body });
      return { id: "t1" };
    });
    await api.update("t 1", { transactionCategoryId: "cat", needsReview: false });
    expect(calls[0]).toEqual({
      method: "PATCH",
      path: "/transactions/t%201",
      body: { transactionCategoryId: "cat", needsReview: false },
    });
  });
});
