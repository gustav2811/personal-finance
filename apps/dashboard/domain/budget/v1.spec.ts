import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { forecastGap, freshnessSentence, groupActualsByMonth, projectCashNeed, projectTransfers, provisionalSentence } from "./v1"

const CARA = "00000000-0000-0000-0000-000000000011"

describe("projectCashNeed", () => {
  it("says how short the paying account is before the next income and ignores mortgage backing", () => {
    const view = projectCashNeed({
      complete: true,
      accounts: [
        { id: "pay", ownerId: CARA, ownerScope: "member", resourceClass: "liquid", cashCents: "20000" },
        { id: "bond", ownerId: CARA, ownerScope: "member", resourceClass: "mortgage", cashCents: "900000" },
      ],
      expected: [
        { kind: "income", date: "2026-10-25", amountCents: "100000", payerId: CARA, accountId: null },
        { kind: "payment", date: "2026-10-15", amountCents: "40000", payerId: CARA, accountId: "pay" },
        { kind: "payment", date: "2026-10-28", amountCents: "90000", payerId: CARA, accountId: "pay" },
      ],
      members: [{ id: CARA, email: "cara@klingbiel.org" }],
    })

    const paying = view.needs.find((need) => need.id === "pay")
    const bond = view.needs.find((need) => need.id === "bond")
    assert.equal(view.nextIncome, "2026-10-25")
    assert.equal(paying?.shortfall, "R200")
    assert.equal(paying?.sentence.includes("short"), true)
    assert.equal(bond?.shortfall, null)
    assert.match(bond?.sentence ?? "", /Not the account that pays the bill/)
    assert.equal(JSON.stringify(paying).includes("900000"), false)
  })

  it("withholds the shortfall when income date is unknown", () => {
    const view = projectCashNeed({
      complete: true,
      accounts: [{ id: "pay", ownerId: null, ownerScope: "shared", resourceClass: "liquid", cashCents: "100" }],
      expected: [{ kind: "payment", date: "2026-10-15", amountCents: "40000", payerId: null, accountId: "pay" }],
      members: [],
    })
    assert.equal(view.incomeKnown, false)
    assert.equal(view.needs[0]?.shortfall, null)
    assert.match(view.needs[0]?.sentence ?? "", /income date is not known/)
  })
})

describe("freshness and provisional", () => {
  it("names a stale observation and keeps provisional money out of available", () => {
    assert.match(
      freshnessSentence({
        asOf: "2026-10-10T10:00:00Z",
        accounts: [{ observedAt: "2026-10-01T10:00:00Z", freshnessHours: 24, included: true }],
      }),
      /stale/i,
    )
    assert.match(provisionalSentence("800000") ?? "", /Not currently available money/)
  })
})

describe("forecastGap", () => {
  it("shows an overcommitted forecast as a gap, not as missing money to invent", () => {
    assert.equal(forecastGap(["100000"], ["60000", "50000"]), "-10000")
  })
})

describe("transfers and calendar months", () => {
  it("does not call a transfer a purchase or a debt, and groups spend by calendar month", () => {
    const transfers = projectTransfers(
      [{ allocation_id: "m1", effect_kind: "movement", amount_cents: "-60000", paid_by_member_id: CARA, source_transaction_id: "tx" }],
      [{ id: CARA, email: "cara@klingbiel.org" }],
    )
    assert.match(transfers[0]?.sentence ?? "", /Not a purchase, and not a debt/)
    assert.equal(transfers[0]?.sentence.toLowerCase().includes("spouse"), false)
    const months = groupActualsByMonth([
      { occurred_on: "2026-09-28", effect_kind: "consumption", amount_cents: "-1000" },
      { occurred_on: "2026-10-02", effect_kind: "consumption", amount_cents: "-2000" },
    ])
    assert.deepEqual(months.map((month) => month.month), ["2026-09", "2026-10"])
  })
})
