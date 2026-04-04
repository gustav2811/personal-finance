import { describe, it, expect, vi } from "vitest";
import {
  createGeminiBatchCategoriser,
  canonicalToCategorisationRow,
} from "../gemini-batch.js";
import type { CanonicalTransaction } from "../../../parsers/types.js";

describe("createGeminiBatchCategoriser", () => {
  it("parses structured JSON array from Gemini response", async () => {
    const responseBody = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  {
                    id: "r1",
                    categoryName: "Coffee",
                    confidence: 0.9,
                    rationale: "cafe",
                  },
                ]),
              },
            ],
          },
        },
      ],
    };

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    } as Response);

    const cat = createGeminiBatchCategoriser({
      apiKey: "k",
      model: "gemini-3-flash-preview",
      apiBase: "https://generativelanguage.googleapis.com",
      timeoutMs: 5000,
      fetchFn,
    });

    const map = await cat.classifyBatch({
      rows: [
        {
          id: "r1",
          counterparty: "Starbucks",
          description: "x",
          amount: -10,
          transactionType: "Card purchase",
        },
      ],
      allowedCategoryNames: ["Coffee", "Groceries"],
    });

    expect(map.get("r1")?.categoryName).toBe("Coffee");
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("generateContent");
    expect(url).toContain("key=k");
    expect(init.method).toBe("POST");
  });

  it("drops category names not in allowlist", async () => {
    const responseBody = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify([
                  { id: "r1", categoryName: "FakeCat", confidence: 1 },
                ]),
              },
            ],
          },
        },
      ],
    };

    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    } as Response);

    const cat = createGeminiBatchCategoriser({
      apiKey: "k",
      model: "m",
      apiBase: "https://generativelanguage.googleapis.com",
      timeoutMs: 5000,
      fetchFn,
    });

    const map = await cat.classifyBatch({
      rows: [
        {
          id: "r1",
          counterparty: "x",
          description: "y",
          amount: -1,
          transactionType: "",
        },
      ],
      allowedCategoryNames: ["Coffee"],
    });

    expect(map.has("r1")).toBe(false);
  });

  it("returns empty map for empty rows without calling fetch", async () => {
    const fetchFn = vi.fn();
    const cat = createGeminiBatchCategoriser({
      apiKey: "k",
      model: "m",
      apiBase: "https://generativelanguage.googleapis.com",
      timeoutMs: 5000,
      fetchFn,
    });
    const map = await cat.classifyBatch({
      rows: [],
      allowedCategoryNames: ["A"],
    });
    expect(map.size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("canonicalToCategorisationRow", () => {
  it("reads Type from raw", () => {
    const tx: CanonicalTransaction = {
      external_id: "e",
      account_id: "a",
      date: "2026-01-01",
      amount: -5,
      currency: "ZAR",
      description: "d",
      counterparty: "c",
      raw: { Type: "Card purchase" },
      meta: {
        bank: "bank_zero",
        source_email: "x",
        filename: "f",
      },
    };
    const row = canonicalToCategorisationRow(tx);
    expect(row.transactionType).toBe("Card purchase");
    expect(row.id).toBe("e");
  });
});
