import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildMoveFundsPayload } from "./commands"
import { copy } from "./copy"
import { moveConfirmCopy, randsToCents } from "./move"

const FORBIDDEN = ["plan changed", "overspent"]

function movement(amountCents: string) {
  return {
    kind: "assign" as const,
    toFundId: "00000000-0000-4000-8000-000000000201",
    amountCents,
    effectiveOn: "2026-10-10",
    expectedVersionId: "00000000-0000-4000-8000-000000000102",
    expectedReconciliationId: "00000000-0000-4000-8000-000000000301",
    expectedReconciliationFingerprint: "fingerprint",
    reason: copy.moveBetweenPurposes,
  }
}

describe("moveConfirmCopy", () => {
  it("names both ends and the amount, and does not say the plan changed", () => {
    const sentences = moveConfirmCopy({
      kind: "reallocate",
      fromName: "Entertainment",
      toName: "Gifts",
      amountCents: "30000",
    })
    const text = sentences.join("\n")
    assert.deepEqual(sentences, [
      "reallocate",
      "Entertainment",
      "Gifts",
      "R300",
      copy.planUnchanged,
    ])
    assert.equal(sentences.includes(copy.planUnchanged), true)
    for (const phrase of FORBIDDEN) {
      assert.equal(text.includes(phrase), false)
    }
  })

  it("does not decide whether an assignment fits", () => {
    for (const kind of ["assign", "release", "reallocate"] as const) {
      const sentences = moveConfirmCopy({
        kind,
        fromName: copy.unassigned,
        toName: "Groceries",
        amountCents: "999999999",
      })
      const text = sentences.join("\n")
      assert.equal(sentences.includes(copy.planUnchanged), true)
      assert.equal(sentences.includes(kind), true)
      assert.equal(sentences.includes("R9 999 999,99"), true)
      for (const phrase of FORBIDDEN) {
        assert.equal(text.includes(phrase), false)
      }
    }
  })
})

describe("buildMoveFundsPayload amount", () => {
  it("rejects a zero or negative amount", () => {
    for (const amountCents of ["0", "-1", "-100"]) {
      assert.throws(
        () => buildMoveFundsPayload(movement(amountCents)),
        (error: unknown) => {
          assert.ok(error instanceof Error)
          assert.equal(error.message, "budget_invalid: amount")
          return true
        },
      )
    }
    assert.equal(buildMoveFundsPayload(movement("1")).amount_cents, "1")
  })
})

describe("randsToCents", () => {
  it("turns a rand entry into cents and leaves zero and negative for the payload to reject", () => {
    assert.equal(randsToCents("300"), "30000")
    assert.equal(randsToCents("R1 500,50"), "150050")
    assert.equal(randsToCents("0"), "0")
    assert.equal(randsToCents("-1"), "-100")
    assert.equal(randsToCents("abc"), null)
  })
})
