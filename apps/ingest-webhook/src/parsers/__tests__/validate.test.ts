import { describe, it, expect } from "vitest";
import { validateCanonicalTransaction, validateAll } from "../validate.js";

describe("validateCanonicalTransaction", () => {
  const valid = {
    external_id: "abc123",
    account_id: "acc1",
    date: "2026-01-15",
    amount: -50,
    currency: "ZAR",
    description: "Test",
    meta: { bank: "bank_zero", source_email: "a@b.co", filename: "f.xlsx" },
  };

  it("accepts valid transaction", () => {
    expect(validateCanonicalTransaction(valid)).toBe(true);
  });

  it("rejects null", () => {
    expect(validateCanonicalTransaction(null)).toBe(false);
  });

  it("rejects missing date", () => {
    expect(validateCanonicalTransaction({ ...valid, date: "invalid" })).toBe(false);
  });

  it("rejects non-ISO date", () => {
    expect(validateCanonicalTransaction({ ...valid, date: "01/15/2026" })).toBe(false);
  });

  it("rejects missing meta", () => {
    expect(validateCanonicalTransaction({ ...valid, meta: null })).toBe(false);
  });
});

describe("validateAll", () => {
  it("splits valid and invalid", () => {
    const valid = {
      external_id: "a",
      account_id: "b",
      date: "2026-01-01",
      amount: 1,
      currency: "ZAR",
      description: "x",
      meta: { bank: "b", source_email: "e", filename: "f" },
    };
    const result = validateAll([valid, null, { ...valid, date: "bad" }]);
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(2);
  });
});
