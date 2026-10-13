import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { incomeFromPlan, incomePayload, startingFunding } from "../../features/budget/agreement-form"

describe("agreement form round trips", () => {
  it("keeps every dated income assumption and its provenance for one member", () => {
    const rows = incomeFromPlan([
      { memberId: "cara", expectedNetCents: "720000", expectedOn: "2026-10-25", provenance: "salary" },
      { memberId: "cara", expectedNetCents: "180000", expectedOn: "2026-10-30", provenance: "rental income" },
    ], ["cara", "gustav"])

    assert.equal(rows.length, 3)
    assert.deepEqual(incomePayload(rows), [
      { memberId: "cara", expectedNetCents: "720000", expectedOn: "2026-10-25", provenance: "salary" },
      { memberId: "cara", expectedNetCents: "180000", expectedOn: "2026-10-30", provenance: "rental income" },
    ])
  })

  it("keeps a purpose's funding behaviour separate from its economic kind", () => {
    assert.deepEqual(startingFunding("everyday", "contribution"), {
      kind: "contribution",
      fundingBehaviour: "cycle_allowance",
      recurrence: "cycle",
    })
    assert.deepEqual(startingFunding("saved", "debt_commitment"), {
      kind: "debt_commitment",
      fundingBehaviour: "accumulating",
      recurrence: "cycle",
    })
  })
})
