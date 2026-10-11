import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { commandFailureIsUncertain, holdCommand } from "./command-attempt"

describe("holdCommand", () => {
  it("reuses the command id and payload when a lost response is retried", () => {
    let minted = 0
    const mint = () => `command-${++minted}`
    const first = holdCommand(
      null,
      { name: "budget_move_funds_v1", fingerprint: "assign:100000", payload: { amount_cents: "100000", effective_on: "2026-10-11" } },
      mint,
    )
    const retry = holdCommand(
      first,
      { name: "budget_move_funds_v1", fingerprint: "assign:100000", payload: { amount_cents: "100000", effective_on: "2026-10-12" } },
      mint,
    )

    assert.equal(retry.id, first.id)
    assert.equal(retry.payload.effective_on, "2026-10-11")
    assert.equal(minted, 1)
  })

  it("mints a new command when the movement itself changed", () => {
    const first = holdCommand(null, { name: "budget_move_funds_v1", fingerprint: "assign:100000", payload: { amount_cents: "100000" } }, () => "one")
    const next = holdCommand(first, { name: "budget_move_funds_v1", fingerprint: "assign:50000", payload: { amount_cents: "50000" } }, () => "two")
    assert.equal(next.id, "two")
    assert.equal(next.payload.amount_cents, "50000")
  })
})

describe("commandFailureIsUncertain", () => {
  it("treats a validation rejection as definite and a lost response as uncertain", () => {
    assert.equal(commandFailureIsUncertain("budget_invalid: amount"), false)
    assert.equal(commandFailureIsUncertain("budget_stale: reconciliation"), false)
    assert.equal(commandFailureIsUncertain("Failed to fetch"), true)
    assert.equal(commandFailureIsUncertain(""), true)
  })
})
