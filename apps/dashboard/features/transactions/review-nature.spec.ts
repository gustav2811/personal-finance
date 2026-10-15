import assert from "node:assert/strict"
import { test } from "node:test"
import { reviewNature } from "./review-nature"
import type { TransactionFeedItem } from "./model"

const item = {
  category: { id: "investment" },
  treatment: { nature: "investment_contribution", isTransfer: true, excludeFromSpend: true, provenance: "jev" },
  event: null,
} as TransactionFeedItem

test("correcting an investment to a gift clears the old nature", () => {
  assert.equal(reviewNature(item, { categoryId: "gift", isTransfer: false, excludeFromSpend: false }), null)
})
test("a category correction invalidates an inferred nature", () => {
  assert.equal(reviewNature(item, { categoryId: "gift", isTransfer: true, excludeFromSpend: true }), null)
})
test("description-only edits preserve the original treatment", () => {
  assert.equal(reviewNature(item, { categoryId: "investment", isTransfer: true, excludeFromSpend: true }), "investment_contribution")
})
test("an earlier confirmed investment label cannot persist on ordinary spending", () => {
  const stale = { ...item, treatment: { ...item.treatment, provenance: "user" as const, isTransfer: false, excludeFromSpend: false } }
  assert.equal(reviewNature(stale, { categoryId: "investment", isTransfer: false, excludeFromSpend: false }), null)
})
test("event-owned treatment remains authoritative", () => {
  assert.equal(reviewNature({ ...item, event: { id: "event" } as NonNullable<TransactionFeedItem["event"]> }, { categoryId: "gift", isTransfer: false, excludeFromSpend: false }), "investment_contribution")
})

test("saving a corrected gift persists the cleared nature", async () => {
  const { demoRpc } = await import("../../lib/demo/transactions")
  demoRpc("finance_set_transaction_treatment_v1", {
    p_transaction_id: "demo-admyt", p_is_transfer: true,
    p_exclude_from_spend: true, p_nature: "investment_contribution",
  })
  const { item: current } = demoRpc("finance_get_transaction_v1", { p_transaction_id: "demo-admyt" }) as { item: TransactionFeedItem }
  const draft = { categoryId: "demo-gifts", isTransfer: false, excludeFromSpend: false }
  const result = demoRpc("finance_review_transaction_v1", {
    p_transaction_id: current.id, p_category_id: draft.categoryId,
    p_description: current.description, p_notes: current.notes ?? null,
    p_is_transfer: draft.isTransfer, p_exclude_from_spend: draft.excludeFromSpend,
    p_nature: reviewNature(current, draft),
    p_expected: { description: current.description, notes: current.notes ?? null, ...current.revision },
    p_review_command_id: "correct-gift",
  }) as { conflict: boolean; item: TransactionFeedItem }
  assert.equal(result.conflict, false)
  assert.equal(result.item.category.name, "Gifts")
  assert.equal(result.item.treatment.nature, null)
  assert.equal(result.item.treatment.isTransfer, false)
  assert.equal(result.item.treatment.excludeFromSpend, false)
})
