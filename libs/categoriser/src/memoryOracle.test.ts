import { describe, expect, it } from "vitest";
import { toFeatures } from "./features.js";
import { adjudicateDisagreement, pastDestination, runMemoryOracle, type ApprovedRelationship } from "./memoryOracle.js";
import type { ResolvedRelation } from "./relations.js";
import type { TxFeatures } from "./types.js";

function row(partial: {
  id: string;
  date: string;
  description: string;
  amount: number;
  categoryName: string;
  accountId?: string;
  accountName?: string;
  merchantName?: string;
}): TxFeatures {
  return toFeatures({
    id: partial.id,
    date: partial.date,
    description: partial.description,
    amount: partial.amount,
    merchantName: partial.merchantName,
    categoryName: partial.categoryName,
    accountId: partial.accountId ?? "current",
    accountName: partial.accountName ?? "Current",
  });
}

function relation(partial: Partial<ResolvedRelation> & Pick<ResolvedRelation, "accountName" | "pairKey">): ResolvedRelation {
  return {
    accountType: null,
    otherAccountKind: null,
    counterpartyKey: "unknown",
    ownAccount: null,
    pair: null,
    nature: "other",
    ...partial,
  };
}

describe("memory oracle", () => {
  it("predicts a pure past merchant without using the label", () => {
    const history = [1, 2, 3].map((n) => row({
      id: `h${n}`,
      date: `2026-01-0${n}`,
      description: "Checkers",
      amount: -100,
      categoryName: "Groceries",
      merchantName: "Checkers",
    }));
    const query = row({
      id: "q",
      date: "2026-04-02",
      description: "Checkers",
      amount: -80,
      categoryName: "Groceries",
      merchantName: "Checkers",
    });
    const { rows, report } = runMemoryOracle({
      corpus: [...history, query],
      evalRows: [query],
      relations: new Map(),
      byId: new Map(),
      thresholds: { minSupport: 3, minPurity: 0.8 },
    });
    expect(rows[0]?.selected?.kind).toBe("account_counterparty");
    expect(rows[0]?.selected?.majority).toBe("Groceries");
    expect(rows[0]?.recoverable).toBe(true);
    expect(report.selected.accuracy).toBe(1);
  });

  it("prefers a pure destination over a pure merchant without peeking", () => {
    const history = [1, 2, 3, 4, 5].flatMap((n) => {
      const day = `2026-01-${String(n).padStart(2, "0")}`;
      return [
        row({
          id: `src-${n}`,
          date: day,
          description: "Checkers",
          amount: -100,
          categoryName: "Transfers",
          accountId: "current",
          merchantName: "Checkers",
        }),
        row({
          id: `shop-${n}`,
          date: day,
          description: "Checkers",
          amount: -40,
          categoryName: "Groceries",
          accountId: "card",
          merchantName: "Checkers",
        }),
      ];
    });
    const query = row({
      id: "q",
      date: "2026-04-02",
      description: "Checkers",
      amount: -100,
      categoryName: "Groceries",
      accountId: "current",
      merchantName: "Checkers",
    });
    const relations = new Map<string, ResolvedRelation>();
    for (const item of [...history, query]) {
      if (item.accountId !== "current") continue;
      relations.set(item.id, relation({
        accountName: "Current",
        pairKey: "Current -> Reserve",
        pair: {
          otherId: `other-${item.id}`,
          otherAccountId: "reserve",
          otherAccountName: "Reserve",
          dayGap: 0,
          amountMatch: "exact",
        },
      }));
    }
    const byId = new Map<string, TxFeatures>();
    for (const item of [...history, query]) {
      byId.set(item.id, item);
      if (item.accountId === "current") {
        byId.set(`other-${item.id}`, row({
          id: `other-${item.id}`,
          date: item.date,
          description: "in",
          amount: 100,
          categoryName: "Transfers",
          accountId: "reserve",
        }));
      }
    }
    const { rows } = runMemoryOracle({
      corpus: [...history, query],
      evalRows: [query],
      relations,
      byId,
      thresholds: { minSupport: 3, minPurity: 1 },
    });
    expect(rows[0]?.selected?.kind).toBe("account_destination");
    expect(rows[0]?.selected?.majority).toBe("Transfers");
    expect(rows[0]?.recoverable).toBe(false);
  });

  it("does not use a counterpart dated after the row", () => {
    const query = row({
      id: "q",
      date: "2026-04-02",
      description: "payment",
      amount: -500,
      categoryName: "Transfers",
    });
    const future = row({
      id: "future",
      date: "2026-04-06",
      description: "in",
      amount: 500,
      categoryName: "Transfers",
      accountId: "reserve",
    });
    const byId = new Map<string, TxFeatures>([[query.id, query], [future.id, future]]);
    const seen = pastDestination(query, relation({
      accountName: "Current",
      pairKey: "Current -> Reserve",
      pair: {
        otherId: future.id,
        otherAccountId: "reserve",
        otherAccountName: "Reserve",
        dayGap: 4,
        amountMatch: "exact",
      },
    }), byId);
    expect(seen).toBeNull();
  });

  it("does not count a same-day row as past", () => {
    const earlier = row({
      id: "same",
      date: "2026-04-02",
      description: "Checkers",
      amount: -20,
      categoryName: "Groceries",
      merchantName: "Checkers",
    });
    const query = row({
      id: "q",
      date: "2026-04-02",
      description: "Checkers",
      amount: -20,
      categoryName: "Groceries",
      merchantName: "Checkers",
    });
    const { rows } = runMemoryOracle({
      corpus: [earlier, query],
      evalRows: [query],
      relations: new Map(),
      byId: new Map(),
      thresholds: { minSupport: 1, minPurity: 1 },
    });
    expect(rows[0]?.observations.find((item) => item.kind === "merchant")).toBeUndefined();
    expect(rows[0]?.selected).toBeNull();
  });

  it("leaves approved relationships unfired when none are passed", () => {
    const approved: ApprovedRelationship[] = [];
    const history = row({
      id: "h",
      date: "2026-01-02",
      description: "Checkers",
      amount: -10,
      categoryName: "Groceries",
      merchantName: "Checkers",
    });
    const query = row({
      id: "q",
      date: "2026-04-02",
      description: "Checkers",
      amount: -10,
      categoryName: "Groceries",
      merchantName: "Checkers",
    });
    const { report } = runMemoryOracle({
      corpus: [history, query],
      evalRows: [query],
      relations: new Map(),
      byId: new Map(),
      relationships: approved,
      thresholds: { minSupport: 1, minPurity: 1 },
    });
    expect(report.signatures.find((item) => item.kind === "approved_relationship")?.fired).toBe(0);
  });
});

describe("disagreement triage", () => {
  it("calls a pure historical match a JEV error, not a label error", () => {
    const result = adjudicateDisagreement({
      actual: "Groceries",
      predicted: "General Purchases",
      observations: [{ kind: "merchant", support: 8, purity: 1, majority: "Groceries" }],
    });
    expect(result.bucket).toBe("jev_definitely_wrong");
  });

  it("does not declare the label wrong, only that it conflicts with pure history", () => {
    const result = adjudicateDisagreement({
      actual: "Transfers",
      predicted: "Housekeeping",
      observations: [{ kind: "account_destination", support: 14, purity: 1, majority: "Housekeeping" }],
    });
    expect(result.bucket).toBe("label_conflicts_with_pure_history");
  });

  it("marks an unseen movement as missing relationship context", () => {
    const result = adjudicateDisagreement({
      actual: "Transfers",
      predicted: "Savings",
      observations: [{ kind: "merchant", support: 1, purity: 1, majority: "Transfers" }],
    });
    expect(result.bucket).toBe("relationship_context_missing");
  });
});
