import { describe, expect, it } from "vitest";
import { createTransactionsApi } from "../../finwise/src/api/transactions.js";
import { classifyTransaction } from "./classify.js";
import { mayAutoApply, observeCategoryChange, shouldSkipRewrite } from "./corrections.js";
import { ExperimentBudget } from "./cost.js";
import { buildEvidence } from "./evidence.js";
import { correctionFingerprint, toFeatures } from "./features.js";
import { buildCategoryOptions, buildJevRequest } from "./jev/build.js";
import { parseJevChoice } from "./jev/parse.js";
import { accuracy, bestThreshold, coverageCurve, labelledAccuracy, pairedLift, selective } from "./metrics.js";
import { resolveRelations } from "./relations.js";
import { householdState } from "./household.js";
import { buildContrastiveJevRequest, buildRetrieval, candidatesForNature, descriptorKey, selectCandidates } from "./retrieve.js";
import { sampleStratifiedSeeded } from "./splits.js";
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
    ).toBe(false);
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
  it("keeps history as a baseline mode and does not short-circuit hybrid", async () => {
    const row = tx({ id: "9", description: "Woolworths", amount: -100, merchantName: "Woolworths" });
    const evidence = buildEvidence([
      tx({ id: "1", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "2", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "3", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "4", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
      tx({ id: "5", description: "Woolworths", amount: -1, merchantName: "Woolworths", categoryName: "Groceries" }),
    ]);
    const renamed = buildCategoryOptions([{ id: "new-id", name: "Groceries" }, { id: "coffee", name: "Coffee" }]);
    const history = await classifyTransaction({
      tx: row,
      categories: renamed,
      evidence,
      corrections: new Map(),
      policy: CONSERVATIVE_POLICY,
      mode: "history",
    });
    expect(history.source).toBe("history");
    expect(history.categorySlug).toBe("groceries");
    let called = false;
    const hybrid = await classifyTransaction({
      tx: row,
      categories: renamed,
      evidence,
      corrections: new Map([[correctionFingerprint(row), "Coffee"]]),
      policy: CONSERVATIVE_POLICY,
      mode: "hybrid",
      jevRequest: { state: {}, questions: {} },
      model: {
        classify: () => {
          called = true;
          return Promise.resolve({
            choice: "coffee",
            confidence: 0.4,
            probabilities: { coffee: 0.4, groceries: 0.3 },
            model: "test",
            usage: { inputTokens: 3, outputTokens: 0 },
          });
        },
      },
    });
    expect(called).toBe(true);
    expect(hybrid.source).toBe("jev");
    expect(hybrid.categoryName).toBe("Coffee");
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

describe("relations and candidates", () => {
  it("pairs an opposite transfer and does not leak the gold label into candidates", () => {
    const accounts = [
      { id: "everyday", name: "Everyday", type: "depository" },
      { id: "bond", name: "Home Loan", type: "loan" },
    ];
    const debit = tx({
      id: "d",
      description: "bond payment",
      amount: -12500,
      date: "2026-05-01",
      notes: "Bond",
    });
    debit.accountId = "everyday";
    debit.accountName = "Everyday";
    debit.categoryName = "Mortgage";
    const credit = tx({
      id: "c",
      description: "received",
      amount: 12500,
      date: "2026-05-01",
    });
    credit.accountId = "bond";
    credit.accountName = "Home Loan";
    const relations = resolveRelations([debit, credit], accounts);
    expect(relations.get("d")?.pair?.otherId).toBe("c");
    expect(relations.get("d")?.nature).toBe("loan_payment");
    const history = tx({
      id: "h",
      description: "woolworths",
      amount: -100,
      merchantName: "Woolworths",
      categoryName: "Groceries",
      date: "2026-01-01",
    });
    const query = tx({
      id: "q",
      description: "woolworths",
      amount: -80,
      merchantName: "Woolworths",
      categoryName: "Clothing",
    });
    const catalogue = buildCategoryOptions([
      { id: "g", name: "Groceries" },
      { id: "c", name: "Coffee" },
      { id: "cl", name: "Clothing" },
      { id: "o", name: "Other" },
    ]);
    const retrieval = buildRetrieval([history], resolveRelations([history], accounts));
    const queryRelation = resolveRelations([query], accounts).get("q");
    if (!queryRelation) throw new Error("missing relation");
    const candidates = selectCandidates({
      tx: query,
      relation: queryRelation,
      retrieval,
      categories: catalogue,
    });
    expect(candidates.names).not.toContain("Clothing");
    const request = buildContrastiveJevRequest({
      tx: query,
      relation: resolveRelations([query], [{ id: "acc", name: "Everyday", type: "depository" }]).get("q")!,
      retrieval,
      categories,
      candidates: selectCandidates({
        tx: query,
        relation: resolveRelations([query], [{ id: "acc", name: "Everyday", type: "depository" }]).get("q")!,
        retrieval,
        categories,
      }),
    });
    expect(JSON.stringify(request.state)).not.toContain("Clothing");
    const clothing = tx({
      id: "cloth-hist",
      description: "Woolworths school shirts",
      amount: -200,
      merchantName: "Woolworths",
      categoryName: "Clothing",
      date: "2026-01-02",
    });
    const clothingAgain = tx({
      id: "cloth-hist-2",
      description: "Woolworths school shirts",
      amount: -180,
      merchantName: "Woolworths",
      categoryName: "Clothing",
      date: "2026-02-02",
    });
    const queryClothing = tx({
      id: "cloth-q",
      description: "Woolworths school shirts",
      amount: -150,
      merchantName: "Woolworths",
      categoryName: "Groceries",
    });
    expect(descriptorKey(queryClothing)).toContain("school");
    const split = buildRetrieval(
      [clothing, clothingAgain],
      resolveRelations([clothing, clothingAgain], accounts),
    );
    const splitCandidates = selectCandidates({
      tx: queryClothing,
      relation: resolveRelations([queryClothing], accounts).get("cloth-q")!,
      retrieval: split,
      categories: catalogue,
    });
    expect(splitCandidates.names).toContain("Clothing");
    expect(splitCandidates.reasons.Clothing).toBe("descriptor_history");
    const expanded = candidatesForNature(
      "purchase",
      { names: ["Eating Out & Takeaways"], reasons: {} },
      buildCategoryOptions([
        { id: "eat", name: "Eating Out & Takeaways" },
        { id: "work", name: "Work Eats" },
      ]),
    );
    expect(expanded.names).toContain("Work Eats");
    expect(request.state).toMatchObject({ exact_amount: -80, merchant_name: "woolworths" });
  });

  it("samples by seed instead of file order", () => {
    const rows = [
      tx({ id: "a", description: "a", amount: -1, categoryName: "Coffee", date: "2026-04-02" }),
      tx({ id: "b", description: "b", amount: -1, categoryName: "Coffee", date: "2026-04-03" }),
      tx({ id: "c", description: "c", amount: -1, categoryName: "Groceries", date: "2026-04-04" }),
    ];
    const sample = sampleStratifiedSeeded(rows, 1, 2, "v2");
    expect(sample).toHaveLength(2);
    expect(sampleStratifiedSeeded(rows, 1, 2, "v2").map((row) => row.id)).toEqual(sample.map((row) => row.id));
    expect(labelledAccuracy([{ actual: "Coffee", predicted: "Coffee" }, { actual: "Groceries", predicted: null }])).toBe(0.5);
    const lift = pairedLift([
      { actual: "Coffee", a: "Groceries", b: "Coffee" },
      { actual: "Groceries", a: "Groceries", b: "Coffee" },
    ]);
    expect(lift.bOnly).toBe(1);
    expect(lift.aOnly).toBe(1);
  });
});

describe("household memory", () => {
  it("injects owned account meaning instead of inferring it from a transfer flag", () => {
    const state = householdState({
      accountId: "cheque",
      destinationAccountId: "reserve",
      counterpartyKey: "housekeeping",
      accounts: [
        {
          finwiseAccountId: "reserve",
          displayName: "Housekeeping Holding",
          role: "expense_reserve",
          ownerScope: "household",
          context: "Monthly transfers into this account are recognised Housekeeping expense.",
        },
      ],
      relationships: [
        {
          sourceFinwiseAccountId: "cheque",
          destinationFinwiseAccountId: "reserve",
          counterpartyKey: null,
          context: "Cheque to Housekeeping Holding is Housekeeping, not Transfers.",
        },
      ],
    });
    const ownedTx = tx({ id: "owned", description: "groceries", amount: -20 });
    const request = buildContrastiveJevRequest({
      tx: ownedTx,
      relation: resolveRelations([ownedTx], [{ id: "acc", name: "Everyday", type: "depository" }]).get("owned")!,
      retrieval: buildRetrieval([], new Map()),
      categories,
      candidates: { names: ["Groceries"], reasons: {} },
      householdAccounts: [
        {
          finwiseAccountId: "acc",
          displayName: "Everyday",
          role: "current",
          ownerScope: "household",
          context: "Everyday spending account.",
        },
      ],
      householdRelationships: [],
    });
    expect(JSON.stringify(request.state)).toContain("Everyday spending account.");
    expect(state).toMatchObject({
      destination_account: { role: "expense_reserve" },
      relationship_context: "Cheque to Housekeeping Holding is Housekeeping, not Transfers.",
    });
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
