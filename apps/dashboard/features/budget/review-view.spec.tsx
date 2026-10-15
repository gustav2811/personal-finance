import "../transactions/test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanup, render, screen } from "@testing-library/react"
import { ReviewList } from "./review-view"
import type { ReviewQueue } from "@/domain/budget/review"

afterEach(cleanup)

const queue: ReviewQueue = {
  partial: false,
  reasons: [],
  items: [{
    reviewKey: "tx-1",
    kind: "bank",
    severity: "review",
    occurredOn: "2026-10-15",
    sourceTransactionId: "tx-1",
    utilityEntryId: null,
    amount: "R320.00",
    fundId: "fund-1",
    amountCents: "-32000",
    impactCents: "-32000",
    reasons: [],
    payerSentence: null,
    fingerprint: "fingerprint-1",
    setId: null,
    sourceAmountCents: "-32000",
    drifted: false,
    siblingCount: 1,
    submittable: true,
    unresolved: null,
    provisional: false,
    excluded: null,
    decisionsConfirmed: true,
  }],
}

test("retained review data disables financial actions until a fresh read is ready", () => {
  render(<ReviewList
    actionsReady={false}
    categories={[{ id: "cat-1", name: "Food" }]}
    funds={[{ id: "fund-1", name: "Everyday" }]}
    members={[]}
    onSaved={async () => {}}
    purchases={{ purchases: [], partial: false, unread: false }}
    queue={queue}
  />)

  const save = screen.getByRole("button", { name: "Save" })
  assert.equal(save.closest("fieldset")?.hasAttribute("disabled"), true)
})
