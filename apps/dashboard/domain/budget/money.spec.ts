import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { formatCents, parseCents } from "./money"

describe("formatCents", () => {
  it("formats whole rands and cents without treating a number as money", () => {
    assert.equal(formatCents("60000"), "R600")
    assert.equal(formatCents("150000"), "R1 500")
    assert.equal(formatCents("-60000"), "-R600")
    assert.equal(formatCents("50"), "R0,50")
    assert.equal(formatCents("0"), "R0")
    assert.equal(parseCents(60000), null)
    assert.equal(formatCents(null), "—")
  })
})
