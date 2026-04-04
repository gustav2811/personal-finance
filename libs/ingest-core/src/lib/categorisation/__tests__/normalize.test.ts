import { describe, it, expect } from "vitest";
import {
  normalizeForMatch,
  combinedNormalizedText,
  normalizeYocoMerchant,
  stripTrailingStoreNumbers,
  extractMemoTokens,
} from "../normalize.js";

describe("normalizeForMatch", () => {
  it("lowercases and strips Apple Pay tail", () => {
    expect(
      normalizeForMatch(
        "Seattle Liberty, Gauteng, Apple Pay on Caras Iphone",
      ),
    ).toBe("seattle liberty, gauteng");
  });

  it("collapses whitespace", () => {
    expect(normalizeForMatch("  Foo   Bar  ")).toBe("foo bar");
  });
});

describe("combinedNormalizedText", () => {
  it("joins counterparty and description", () => {
    expect(
      combinedNormalizedText("Tsafrika Headoffice", "Sandton, Apple Pay on X"),
    ).toContain("tsafrika headoffice");
    expect(
      combinedNormalizedText("Tsafrika Headoffice", "Sandton, Apple Pay on X"),
    ).toContain("sandton");
  });
});

describe("normalizeYocoMerchant", () => {
  it("normalises yoco star prefix", () => {
    expect(normalizeYocoMerchant("Yoco  *father Coffee")).toContain("yoco");
  });
});

describe("stripTrailingStoreNumbers", () => {
  it("removes trailing numeric suffix", () => {
    expect(stripTrailingStoreNumbers("Create Lonehill 11169")).toBe(
      "Create Lonehill",
    );
  });
});

describe("extractMemoTokens", () => {
  it("finds memo keywords", () => {
    const t = extractMemoTokens("pay out tfsa and mortgage");
    expect(t).toContain("tfsa");
    expect(t).toContain("mortgage");
  });
});
