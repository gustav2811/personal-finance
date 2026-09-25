import { describe, expect, it } from "vitest";
import { applyAdjudication, type AdjudicatedLeg } from "./adjudication.js";

const overlay: AdjudicatedLeg[] = [
  {
    id: "confirmed",
    status: "gold",
    categoryName: "Transfers",
    isTransfer: true,
    eventId: null,
    legRole: "mirror",
    note: "confirmed movement",
  },
  {
    id: "hold",
    status: "hold",
    categoryName: null,
    isTransfer: true,
    eventId: null,
    legRole: "internal_conversion",
    note: "policy",
  },
  {
    id: "correct",
    status: "gold",
    categoryName: "Transfers",
    isTransfer: true,
    eventId: "evt:receipt",
    legRole: "mirror",
    note: "internal receipt was labelled as an expense",
  },
];

describe("adjudication overlay", () => {
  it("keeps confirmed labels, applies corrections, and drops holds from strict scoring", () => {
    const applied = applyAdjudication([
      { id: "confirmed", categoryName: "Transfers", isTransfer: true },
      { id: "hold", categoryName: "Transfers", isTransfer: true },
      { id: "correct", categoryName: "Home & Garden", isTransfer: false },
      { id: "untouched", categoryName: "Groceries", isTransfer: false },
    ], overlay);
    expect(applied.held).toEqual(["hold"]);
    expect(applied.strict).toEqual([
      { id: "confirmed", actual: "Transfers", isTransfer: true, source: "gold" },
      { id: "correct", actual: "Transfers", isTransfer: true, source: "gold" },
      { id: "untouched", actual: "Groceries", isTransfer: false, source: "ledger" },
    ]);
    expect(applied.unknownOverlay).toEqual([]);
  });

  it("rejects a gold row with no category", () => {
    expect(() => applyAdjudication(
      [{ id: "bad", categoryName: "Transfers", isTransfer: true }],
      [{ ...overlay[0]!, id: "bad", categoryName: null }],
    )).toThrow(/no category/);
  });
});
