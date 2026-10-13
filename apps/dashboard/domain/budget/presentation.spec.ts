import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PlanLine } from "./plan"
import { placeGroup, suggestGroup } from "./presentation"

function line(patch: Partial<PlanLine> = {}): PlanLine {
  return {
    stableLineId: "line-1",
    fundId: "fund-1",
    name: "Groceries",
    kind: "consumption",
    contributionCents: "600000",
    fundingBehaviour: "cycle_allowance",
    beneficiaryScope: "shared",
    beneficiaryMemberId: null,
    plannedPayerMemberId: null,
    targetCents: null,
    dueOn: null,
    recurrence: "cycle",
    rolloverPolicy: "carry",
    categoryId: null,
    categoryNameSnapshot: null,
    groupNameSnapshot: null,
    expectedPaymentOn: null,
    expectedPaymentAccountId: null,
    matchCategoryId: null,
    ...patch,
  }
}

describe("placeGroup", () => {
  it("does not file an ambiguous monthly allowance as everyday spending", () => {
    const groceries = line()
    assert.equal(suggestGroup(groceries).ambiguous, true)
    assert.equal(placeGroup(groceries, undefined).group, "ungrouped")
    assert.equal(placeGroup(groceries, "everyday").group, "everyday")
    assert.equal(placeGroup(groceries, "everyday").persisted, false)
    assert.equal(placeGroup(groceries, "bills").group, "bills")
  })

  it("keeps a dated bill, a sinking fund, and a gift in distinct groups without rewriting kind", () => {
    const rates = line({ name: "Rates", expectedPaymentOn: "2026-11-01" })
    const insurance = line({
      name: "Annual insurance",
      fundingBehaviour: "target_by_date",
      targetCents: "600000",
      dueOn: "2026-12-01",
    })
    const gifts = line({ name: "Gifts", fundingBehaviour: "accumulating" })
    assert.equal(placeGroup(rates, undefined).group, "bills")
    assert.equal(placeGroup(insurance, undefined).group, "saved")
    assert.equal(placeGroup(gifts, undefined).group, "saved")
    assert.equal(gifts.kind, "consumption")
    assert.equal(placeGroup(gifts, "everyday").group, "saved")
  })
})
