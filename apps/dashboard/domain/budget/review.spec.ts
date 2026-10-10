import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy, reasonSentence, sharedExpensePaidBy } from "./copy"
import { formatCents } from "./money"
import { projectReviewQueue } from "./review"

const CARA = "00000000-0000-0000-0000-000000000011"
const GUSTAV = "00000000-0000-0000-0000-000000000012"

const members = [
  { id: CARA, email: "cara@klingbiel.org" },
  { id: GUSTAV, email: "gustav@klingbiel.org" },
]

function item(overrides: Record<string, unknown>) {
  return {
    review_key: "transaction:tx",
    kind: "unallocated_outflow",
    severity: "high",
    occurred_on: "2026-10-01",
    source_transaction_id: "tx",
    utility_entry_id: null,
    amount_cents: "-12500",
    impact_cents: "-12500",
    reasons: [{ code: "unallocated_outflow" }],
    provenance: {
      source_snapshot: { source_fingerprint: "live-fingerprint" },
    },
    ...overrides,
  }
}

describe("projectReviewQueue", () => {
  it("orders by money impact, most negative first, with a missing impact last", () => {
    const view = projectReviewQueue({
      queue: {
        items: [
          item({ review_key: "small-negative", impact_cents: "-1", amount_cents: "-1" }),
          item({ review_key: "missing-impact", impact_cents: null, amount_cents: "-900" }),
          item({ review_key: "large-negative", impact_cents: "-100", amount_cents: "-100" }),
          item({ review_key: "ten", impact_cents: "10", amount_cents: "10" }),
          item({ review_key: "nine", impact_cents: "9", amount_cents: "9" }),
        ],
      },
      members,
    })

    assert.deepEqual(
      view.items.map((row) => row.reviewKey),
      ["large-negative", "small-negative", "nine", "ten", "missing-impact"],
    )
    assert.equal(view.items[0]?.reasons[0]?.sentence, reasonSentence("unallocated_outflow"))
  })

  it("does not show a null amount as zero", () => {
    const view = projectReviewQueue({
      queue: {
        items: [item({ review_key: "unknown-amount", amount_cents: null, impact_cents: null })],
      },
      members,
    })

    assert.equal(view.items[0]?.amount, formatCents(null))
    assert.notEqual(view.items[0]?.amount, formatCents("0"))
    assert.equal(view.items[0]?.amountCents, null)
  })

  it("does not allow a save when no fingerprint is present", () => {
    const view = projectReviewQueue({
      queue: {
        items: [
          item({
            review_key: "no-fingerprint",
            provenance: { source_snapshot: { owner_member_id: CARA } },
          }),
          item({
            review_key: "blank-fingerprint",
            provenance: {
              current_fingerprint: "",
              frozen_fingerprint: "   ",
              source_snapshot: { source_fingerprint: "" },
            },
          }),
          item({
            review_key: "snapshot-fingerprint",
            provenance: { source_snapshot: { source_fingerprint: "snap" } },
          }),
          item({
            review_key: "current-fingerprint",
            provenance: { current_fingerprint: "current" },
          }),
          item({
            review_key: "frozen-fingerprint",
            provenance: { frozen_fingerprint: "frozen" },
          }),
          item({
            review_key: "utility-only",
            source_transaction_id: null,
            utility_entry_id: "00000000-0000-0000-0000-000000000099",
            provenance: { current_fingerprint: "utility" },
          }),
        ],
      },
      members,
    })
    const byKey = new Map(view.items.map((row) => [row.reviewKey, row]))

    assert.equal(byKey.get("no-fingerprint")?.submittable, false)
    assert.equal(byKey.get("no-fingerprint")?.fingerprint, null)
    assert.equal(byKey.get("no-fingerprint")?.unresolved, copy.somethingUnresolved)
    assert.equal(byKey.get("blank-fingerprint")?.submittable, false)
    assert.equal(byKey.get("blank-fingerprint")?.unresolved, copy.somethingUnresolved)
    assert.equal(byKey.get("snapshot-fingerprint")?.submittable, true)
    assert.equal(byKey.get("snapshot-fingerprint")?.fingerprint, "snap")
    assert.equal(byKey.get("snapshot-fingerprint")?.unresolved, null)
    assert.equal(byKey.get("current-fingerprint")?.submittable, true)
    assert.equal(byKey.get("current-fingerprint")?.fingerprint, "current")
    assert.equal(byKey.get("frozen-fingerprint")?.submittable, true)
    assert.equal(byKey.get("frozen-fingerprint")?.fingerprint, "frozen")
    assert.equal(byKey.get("utility-only")?.submittable, false)
  })

  it("keeps a shared payer sentence from reading as personal overspending", () => {
    const view = projectReviewQueue({
      queue: {
        items: [
          item({
            review_key: "shared-paid-by-cara",
            provenance: {
              source_snapshot: {
                source_fingerprint: "live",
                owner_scope: "member",
                owner_member_id: CARA,
              },
              paid_by_member_id: CARA,
            },
          }),
        ],
      },
      members,
    })
    const sentence = view.items[0]?.payerSentence

    assert.equal(sentence, sharedExpensePaidBy("Cara"))
    assert.equal(sentence?.toLowerCase().includes("overspending"), false)
    assert.equal(sentence?.toLowerCase().includes("overspent"), false)
    assert.equal(sentence?.includes("'s expense"), false)
    assert.equal(sentence?.includes(CARA), false)
    assert.equal(JSON.stringify(view.items[0]?.reasons).includes(CARA), false)
  })
})
