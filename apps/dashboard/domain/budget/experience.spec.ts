import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy, paidBySentence, planChangedSentence } from "./copy"
import { projectFund } from "./fund"
import { projectHistory } from "./history"
import { projectBudget } from "./overview"
import { alreadyApproved, isDriftedReview } from "./review"

const CARA = "00000000-0000-0000-0000-000000000011"
const NOTICE = "00000000-0000-0000-0000-000000000401"
const GIFTS = "00000000-0000-0000-0000-000000000201"

const members = [{ id: CARA, email: "cara@klingbiel.org" }]

describe("overview facts", () => {
  it("separates mortgage backing from the account that pays the bill and does not call a payer comparison overspending", () => {
    const view = projectBudget({
      overview: {
        complete: true,
        cycle_start: "2026-09-23",
        end_exclusive: "2026-10-23",
        as_of: "2026-10-10T10:00:00Z",
        current_version_id: "v",
        unassigned_cents: "100",
        forecast_gap_cents: "0",
        reasons: [],
        current_plan: { version_number: 1, lines: [] },
        funds: [],
      },
      actuals: {
        entries: [],
        next_cursor: null,
        household_totals: { by_group: {}, by_actual_payer: { [CARA]: { consumption: "-60000" } } },
      },
      liquidity: {
        complete: true,
        accounts: [
          { account_id: "pay", owner_member_id: CARA, resource_class: "liquid", normalized_cash_cents: "200000" },
          { account_id: "bond", owner_member_id: CARA, resource_class: "mortgage", normalized_cash_cents: "900000" },
        ],
        expected: [{ kind: "payment", date: "2026-10-15", amount_cents: "40000", planned_payer_member_id: CARA }],
      },
      members,
      filter: { kind: "household" },
    })

    assert.equal(view.accounts.some((account) => account.id === "bond"), false)
    assert.equal(view.restrictedBacking[0]?.id, "bond")
    assert.equal(view.restrictedBacking[0]?.backing, "mortgage")
    assert.equal(view.calendar[0]?.date, "2026-10-15")
    assert.equal(view.calendar[0]?.label, copy.expectedPayments)
    assert.equal(view.payers[0]?.sentence, paidBySentence("Cara"))
    assert.equal(view.payers[0]?.sentence.includes("overspent"), false)
    assert.match(view.payers[0]?.sentence ?? "", /not personal overspending/)
    assert.equal(view.moveCash.detail.includes("not sent from here"), true)
  })
})

describe("fund detail", () => {
  it("says where the restricted part sits and links the purchase", () => {
    const view = projectFund(
      {
        complete: true,
        as_of: "2026-10-10T10:00:00Z",
        fund: { fund_id: GIFTS, name: "Gifts" },
        balances: { balance_cents: "30000", liquid_cents: "0", restricted_cents: "30000", assigned_cents: "30000" },
        plan_line: { funding_behaviour: "accumulating", target_cents: "60000", due_on: "2026-12-01" },
        target_suggestion: {
          shortfall_cents: "30000",
          remaining_funding_dates: 0,
          suggested_contribution_cents: "30000",
          due_now: false,
        },
        entries: [
          {
            effective_on: "2026-10-02",
            effect_kind: "consumption",
            amount_cents: "-1000",
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
            source_transaction_id: "tx-1",
          },
        ],
      },
      members,
      {
        fundId: GIFTS,
        earmarks: [{ fundId: GIFTS, accountId: NOTICE, amountCents: "30000", effectiveOn: "2026-09-23" }],
        accountNames: new Map([[NOTICE, "Notice"]]),
      },
    )

    assert.equal(view.holdings[0]?.accountName, "Notice")
    assert.equal(view.holdings[0]?.asOf, "2026-09-23")
    assert.equal(view.entries[0]?.sourceTransactionId, "tx-1")
    assert.equal(view.dueOn, "2026-12-01")
    assert.equal(view.timeline.length, 1)
    assert.equal(view.timeline[0]?.spending.includes("R"), true)
  })
})

describe("history explanation", () => {
  it("does not call a plan increase a corrected transaction", () => {
    const view = projectHistory({
      version: { version: { lines: [{ fund_id: GIFTS, name: "Groceries", contribution_cents: "80000", beneficiary_scope: "shared" }] } },
      parent: { version: { lines: [{ fund_id: GIFTS, name: "Groceries", contribution_cents: "60000", beneficiary_scope: "shared" }] } },
      actuals: {
        next_cursor: null,
        entries: [
          {
            fund_id: GIFTS,
            effect_kind: "consumption",
            amount_cents: "-1000",
            source_transaction_id: "tx-2",
            supersedes_id: "old-allocation",
          },
        ],
        household_totals: { by_group: { consumption: "-1000" } },
      },
    })

    assert.equal(view.rows[0]?.planChange, planChangedSentence("Groceries", "increased"))
    assert.equal(view.rows[0]?.correction, copy.correctedSpend)
    assert.equal(view.planChangeNote, copy.planChangeIsNotCorrection)
    assert.equal(view.corrections[0]?.supersedesId, "old-allocation")
    assert.notEqual(view.rows[0]?.planChange, view.rows[0]?.correction)
  })
})

describe("already approved", () => {
  it("does not ask again when the current decision is not in the queue", () => {
    assert.equal(alreadyApproved({ inQueue: false, status: "current", drifted: false }), true)
    assert.equal(alreadyApproved({ inQueue: true, status: "current", drifted: false }), false)
    assert.equal(isDriftedReview({ kind: "source_drift", reasons: [] }), true)
  })
})
