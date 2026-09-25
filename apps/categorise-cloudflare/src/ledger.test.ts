import { describe, expect, it } from "vitest";
import {
  JEV_TAG_ID,
  categorySlug,
  mergeJevTag,
  occurredOn,
  ownedCategoryIdForName,
  payloadHash,
  projectionBody,
  proposedTreatment,
  tagIdsOf,
} from "./ledger.js";

describe("ledger mapping", () => {
  it("keeps a Johannesburg calendar day for a UTC evening timestamp", () => {
    expect(occurredOn("2026-09-24T22:00:00.000Z")).toBe("2026-09-25");
    expect(occurredOn("2026-09-25")).toBe("2026-09-25");
  });

  it("hashes the same payload once, independent of key order", async () => {
    const left = await payloadHash({ b: 1, a: { d: 2, c: 3 } });
    const right = await payloadHash({ a: { c: 3, d: 2 }, b: 1 });
    expect(left).toBe(right);
    expect(left).toHaveLength(64);
    expect(await payloadHash({ a: 2 })).not.toBe(left);
  });

  it("resolves a predicted name only through the synced owned catalogue", () => {
    const owned = new Map([["Groceries", "owned-1"]]);
    expect(ownedCategoryIdForName(owned, "Groceries")).toBe("owned-1");
    expect(ownedCategoryIdForName(owned, "Made Up")).toBeNull();
    expect(ownedCategoryIdForName(owned, null)).toBeNull();
  });

  it("falls back to a stable source slug when the name has no letters", () => {
    expect(categorySlug("Groceries", "abc")).toBe("groceries");
    expect(categorySlug("???", "abc-def")).toBe("source_abcdef");
  });

  it("preserves existing tags and does not duplicate JEV", () => {
    expect(mergeJevTag(["rent"])).toEqual(["rent", JEV_TAG_ID]);
    expect(mergeJevTag([JEV_TAG_ID, "rent"])).toEqual([JEV_TAG_ID, "rent"]);
    expect(projectionBody("cat-1", ["rent"])).toEqual({
      transactionCategoryId: "cat-1",
      needsReview: false,
      tagIds: ["rent", JEV_TAG_ID],
    });
  });

  it("reads tag ids from whichever FinWise field is populated", () => {
    expect(tagIdsOf({ tagIds: ["a"] })).toEqual(["a"]);
    expect(tagIdsOf({ transactionTags: [{ id: "b" }] })).toEqual(["b"]);
    expect(tagIdsOf({ tags: [{ id: "c" }] })).toEqual(["c"]);
    expect(tagIdsOf({})).toEqual([]);
  });

  it("treats movement as excluded spend", () => {
    expect(proposedTreatment("internal_transfer", false)).toEqual({
      isTransfer: true,
      excludeFromSpend: true,
      nature: "internal_transfer",
    });
    expect(proposedTreatment("purchase", true)).toEqual({
      isTransfer: true,
      excludeFromSpend: false,
      nature: "purchase",
    });
  });
});
