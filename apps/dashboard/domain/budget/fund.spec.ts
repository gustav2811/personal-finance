import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy, sharedExpensePaidBy } from "./copy"
import { projectFund } from "./fund"
import { formatCents } from "./money"

const CARA = "00000000-0000-0000-0000-000000000011"
const GUSTAV = "00000000-0000-0000-0000-000000000012"

const members = [
  { id: CARA, email: "cara@klingbiel.org" },
  { id: GUSTAV, email: "gustav@klingbiel.org" },
]

describe("projectFund", () => {
  it("includes funded-not-accessible when restricted cents are not zero", () => {
    const fromBalances = projectFund(
      {
        complete: true,
        fund: { name: "Retirement" },
        balances: {
          balance_cents: "150000",
          liquid_cents: "120000",
          restricted_cents: "30000",
          assigned_cents: "150000",
        },
      },
      members,
    )
    const fromWrapper = projectFund(
      {
        complete: true,
        fund: { name: "Retirement" },
        balances: { balance_cents: "150000", assigned_cents: "150000" },
        restricted_cents: "30000",
        liquid_cents: "120000",
      },
      members,
    )

    assert.equal(fromBalances.notices.includes(copy.fundedNotAccessible), true)
    assert.equal(fromBalances.restricted?.caption, copy.fundedNotAccessible)
    assert.equal(fromBalances.available.amount, "R1 200")
    assert.equal(fromWrapper.notices.includes(copy.fundedNotAccessible), true)
    assert.equal(fromWrapper.available.amount, "R1 200")
    assert.match(JSON.stringify(fromBalances), /Funded but not immediately accessible/)
  })

  it("names the payer of a shared purchase and does not show the UUID", () => {
    const view = projectFund(
      {
        complete: true,
        fund: { name: "Groceries" },
        balances: { balance_cents: "100", assigned_cents: "100", restricted_cents: "0" },
        entries: [
          {
            effective_on: "2026-10-02",
            effect_kind: "consumption",
            amount_cents: "-60000",
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
            active_effect: true,
          },
          {
            effective_on: "2026-10-03",
            entry_type: "purchase",
            signed_amount_cents: "-12000",
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
          },
          {
            effective_on: "2026-10-01",
            entry_type: "movement",
            effect_kind: "consumption",
            signed_amount_cents: "50000",
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
            active_effect: true,
          },
        ],
      },
      members,
    )

    assert.deepEqual(
      view.entries.map((entry) => entry.sentence),
      [sharedExpensePaidBy("Cara"), sharedExpensePaidBy("Cara"), ""],
    )
    assert.equal(view.entries[0]?.amount, "-R600")
    assert.equal(JSON.stringify(view).includes(CARA), false)
    assert.equal(JSON.stringify(view).includes(GUSTAV), false)
    assert.equal(view.entries.some((entry) => entry.sentence.includes("Shared expense")), true)
    assert.equal(view.entries.filter((entry) => entry.sentence.includes("Shared expense")).length, 2)
  })

  it("uses Needs reconciliation as the headline and still shows the ledger", () => {
    const incomplete = projectFund(
      {
        complete: false,
        fund: { name: "Groceries" },
        balances: { balance_cents: "-5000", assigned_cents: "0", restricted_cents: "0" },
        reasons: [{ code: "cutover_missing" }],
        entries: [
          {
            effective_on: "2026-10-02",
            effect_kind: "consumption",
            signed_amount_cents: "-1000",
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
          },
        ],
      },
      members,
    )
    const missing = projectFund(
      {
        fund: { name: "Groceries" },
        entries: [
          {
            effective_on: "2026-10-01",
            entry_type: "purchase",
            amount_cents: "-100",
            beneficiary_scope: "shared",
            paid_by_member_id: GUSTAV,
          },
        ],
      },
      members,
    )

    assert.equal(incomplete.headline, "Needs reconciliation")
    assert.equal(incomplete.headline, copy.needsReconciliation)
    assert.equal(incomplete.entries.length, 1)
    assert.equal(incomplete.entries[0]?.sentence, sharedExpensePaidBy("Cara"))
    assert.equal(incomplete.available.amount, copy.withheld)
    assert.match(incomplete.ledger?.amount ?? "", /Deficit/)
    assert.match(incomplete.ledger?.amount ?? "", /-R50/)
    assert.equal(incomplete.ledger?.label, copy.ledger)
    assert.equal(missing.headline, copy.needsReconciliation)
    assert.equal(missing.entries.length, 1)
    assert.equal(missing.entries[0]?.sentence, sharedExpensePaidBy("Gustav"))
  })

  it("does not label a suggestion as assigned", () => {
    const view = projectFund(
      {
        complete: true,
        fund: { name: "Gifts" },
        balances: {
          balance_cents: "30000",
          assigned_cents: "150000",
          restricted_cents: "0",
          liquid_cents: "30000",
        },
        plan_line: {
          funding_behaviour: "target_by_date",
          target_cents: "600000",
          due_on: "2026-11-23",
        },
        target_suggestion: {
          shortfall_cents: "570000",
          remaining_funding_dates: 5,
          suggested_contribution_cents: "50000",
          due_now: false,
        },
      },
      members,
    )

    assert.ok(view.suggestion)
    assert.equal(view.suggestion.caption, copy.suggestedNotAssigned)
    assert.equal(view.suggestion.label, copy.nextNeed)
    assert.notEqual(view.suggestion.label, copy.assigned)
    assert.equal(view.suggestion.amount, formatCents("50000"))
    assert.equal(view.assigned.label, copy.assigned)
    assert.equal(view.assigned.amount, formatCents("150000"))
    assert.notEqual(view.suggestion.amount, view.assigned.amount)
    assert.equal(JSON.stringify(view.suggestion).includes(copy.assigned), false)
    assert.match(view.suggestion.caption, /Suggested, not assigned/)
    assert.equal(view.dueOn, "2026-11-23")
    assert.equal(view.notices.includes(copy.staysInTheFund), false)
    assert.equal(JSON.stringify(view).includes("%"), false)
    assert.equal(JSON.stringify(view).toLowerCase().includes("monthly"), false)
    assert.equal(JSON.stringify(view).includes("remaining_funding_dates"), false)
    assert.ok(view.target)
    assert.equal(view.target.funded, "R300")
    assert.equal(view.target.target, "R6 000")
  })

  it("names a negative balance as a deficit", () => {
    const view = projectFund(
      {
        complete: true,
        fund: { name: "Groceries" },
        balances: { balance_cents: "-5000", assigned_cents: "0", restricted_cents: "0" },
      },
      members,
    )

    assert.equal(view.headline, `${copy.deficit}. -R50`)
    assert.equal(view.available.amount, `${copy.deficit}. -R50`)
    assert.equal(view.target, null)
  })

  it("withholds available money when reconciliation is incomplete and keeps the ledger", () => {
    const view = projectFund(
      {
        complete: false,
        fund: { name: "Groceries" },
        balances: {
          balance_cents: "100000",
          assigned_cents: "100000",
          restricted_cents: "0",
          liquid_cents: "100000",
        },
      },
      members,
    )

    assert.equal(view.headline, copy.needsReconciliation)
    assert.equal(view.available.amount, copy.withheld)
    assert.equal(view.available.amount.includes("1"), false)
    assert.equal(view.ledger?.amount, formatCents("100000"))
    assert.equal(view.ledger?.caption, copy.ledgerNotAvailable)
  })

  it("does not invent a target or accumulating timeline from fields the fund read does not return", () => {
    const view = projectFund(
      {
        complete: true,
        fund: { name: "Holiday", funding_behaviour: "accumulating" },
        balances: { balance_cents: "30000", assigned_cents: "30000", restricted_cents: "0" },
        target: { target_cents: "600000", funded_cents: "30000", due_on: "2026-12-01" },
        target_suggestion: {
          shortfall_cents: "0",
          remaining_funding_dates: 0,
          suggested_contribution_cents: "0",
          due_now: false,
        },
        entries: [
          { effective_on: "2026-10-01", entry_type: "movement", signed_amount_cents: "50000" },
          { effective_on: "2026-10-02", entry_type: "allocation", effect_kind: "consumption", signed_amount_cents: "-20000" },
        ],
      },
      members,
    )

    assert.equal(view.target, null)
    assert.equal(view.dueOn, null)
    assert.equal(view.timeline.length, 0)

    const fromPlanLine = projectFund(
      {
        complete: true,
        fund: { name: "Holiday" },
        balances: { balance_cents: "30000", assigned_cents: "80000", restricted_cents: "0" },
        plan_line: { funding_behaviour: "accumulating", target_cents: null, due_on: null },
        target_suggestion: {
          shortfall_cents: "0",
          remaining_funding_dates: 0,
          suggested_contribution_cents: "0",
          due_now: false,
        },
        entries: [
          { effective_on: "2026-10-01", entry_type: "movement", signed_amount_cents: "50000" },
          { effective_on: "2026-10-02", entry_type: "allocation", effect_kind: "consumption", signed_amount_cents: "-20000" },
        ],
      },
      members,
    )
    assert.equal(fromPlanLine.notices.includes(copy.staysInTheFund), true)
    assert.equal(fromPlanLine.timeline.length, 2)
    assert.equal(fromPlanLine.target, null)
  })
})
