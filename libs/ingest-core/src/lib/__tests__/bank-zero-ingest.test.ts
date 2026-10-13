import { describe, expect, it } from "vitest";
import { statementAmountMinorUnits } from "../bank-zero-ingest.js";

describe("Bank Zero statement amount normalization", () => {
  it.each([
    [-5, 500],
    [-125.5, 12550],
    [2500, 250000],
  ])("stores the absolute minor-unit magnitude for %s", (amount, expected) => {
    expect(statementAmountMinorUnits(amount)).toBe(expected);
  });

  it("rejects zero", () => {
    expect(() => statementAmountMinorUnits(0)).toThrow(/exact positive minor-unit/);
  });
});
