import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy, sharedExpensePaidBy } from "./copy"
import { projectBudget } from "./overview"

const CARA = "00000000-0000-0000-0000-000000000011"
const GUSTAV = "00000000-0000-0000-0000-000000000012"
const GIFTS = "00000000-0000-0000-0000-000000000201"
const GROCERIES = "00000000-0000-0000-0000-000000000202"
const RETIREMENT = "00000000-0000-0000-0000-000000000203"

const members = [
  { id: CARA, email: "cara@klingbiel.org" },
  { id: GUSTAV, email: "gustav@klingbiel.org" },
]

function line(overrides: Record<string, unknown>) {
  return {
    fund_id: GROCERIES,
    name: "Groceries",
    kind: "consumption",
    contribution_cents: "600000",
    funding_behaviour: "cycle_allowance",
    beneficiary_scope: "shared",
    beneficiary_member_id: null,
    planned_payer_member_id: GUSTAV,
    ...overrides,
  }
}

function overview(overrides: Record<string, unknown> = {}) {
  return {
    complete: true,
    cycle_start: "2026-09-23",
    end_exclusive: "2026-10-23",
    as_of: "2026-10-10T10:00:00Z",
    current_version_id: "00000000-0000-0000-0000-000000000102",
    unassigned_cents: "200000",
    forecast_gap_cents: "25000",
    reasons: [],
    current_plan: {
      version_number: 2,
      lines: [line({})],
    },
    original_plan: {
      lines: [line({ contribution_cents: "600000" })],
    },
    funds: [
      {
        fund_id: GROCERIES,
        name: "Groceries",
        status: "active",
        beneficiary_scope: "shared",
        balance_cents: "140000",
        assigned_cents: "200000",
        liquid_cents: "140000",
        restricted_cents: "0",
      },
    ],
    provenance: {
      resources: {
        reconciliation_id: "00000000-0000-0000-0000-000000000301",
        reconciliation_fingerprint: "abc",
      },
    },
    ...overrides,
  }
}

describe("projectBudget", () => {
  it("withholds a spendable unassigned total when the read is incomplete", () => {
    const view = projectBudget({
      overview: overview({
        complete: false,
        unassigned_cents: "800000",
        reasons: [{ code: "cutover_missing" }],
      }),
      actuals: { entries: [], household_totals: { by_group: { consumption: "-60000" } }, next_cursor: null },
      liquidity: { complete: false, reasons: [{ code: "resource_balance_unknown" }], accounts: [] },
      members,
      filter: { kind: "household" },
    })

    assert.equal(view.complete, false)
    assert.equal(view.unassigned.withheld, true)
    assert.equal(view.unassigned.amount, null)
    assert.equal(view.canAssign, false)
    assert.equal(view.reasons.includes("Opening balances have not been reconciled."), true)
    assert.equal(JSON.stringify(view).includes("800000"), false)
    assert.equal(JSON.stringify(view).includes("R8 000"), false)
  })

  it("does not call a forecast or a target available money", () => {
    const view = projectBudget({
      overview: overview(),
      actuals: { entries: [], next_cursor: null, household_totals: { by_group: {} } },
      liquidity: {
        complete: true,
        card_debt_cents: "300000",
        accounts: [{ account_id: "acc", owner_member_id: CARA, normalized_cash_cents: "2000000" }],
        forecast: { uncertainty_reasons: ["no_statement_forecast"] },
      },
      members,
      filter: { kind: "household" },
    })

    assert.equal(view.forecast.label, copy.forecast)
    assert.match(view.forecast.caption, /Not currently available money/)
    assert.match(view.forecast.caption, /Not a statement forecast/)
    assert.equal(view.liquidity.caption.includes("Not the spending allowance"), true)
    assert.equal(view.cardDebt, "R3 000")
    assert.equal(view.unassigned.amount, "R2 000")
  })

  it("keeps an accumulating gift balance from looking like monthly overspending", () => {
    const view = projectBudget({
      overview: overview({
        current_plan: {
          version_number: 2,
          lines: [
            line({
              fund_id: GIFTS,
              name: "Gifts",
              contribution_cents: "50000",
              funding_behaviour: "accumulating",
            }),
          ],
        },
        funds: [
          {
            fund_id: GIFTS,
            name: "Gifts",
            status: "active",
            balance_cents: "30000",
            assigned_cents: "150000",
            restricted_cents: "0",
            target_suggestion: { suggested_contribution_cents: "50000", due_now: false },
          },
        ],
      }),
      actuals: {
        next_cursor: null,
        entries: [
          {
            allocation_id: "a1",
            amount_cents: "-120000",
            effect_kind: "consumption",
            fund_id: GIFTS,
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
          },
        ],
        household_totals: { by_group: { consumption: "-120000" } },
      },
      liquidity: { complete: true, accounts: [], card_debt_cents: "0" },
      members,
      filter: { kind: "household" },
    })

    const gifts = view.purposes.find((row) => row.name === "Gifts")
    assert.ok(gifts)
    assert.equal(gifts.available, "R300")
    assert.equal(gifts.nextNeed, copy.staysInTheFund)
    assert.equal(JSON.stringify(gifts).toLowerCase().includes("overspent"), false)
    assert.match(gifts.disclosure.join(" "), /Suggested, not assigned/)
  })

  it("names a shared grocery purchase by the person who paid", () => {
    const view = projectBudget({
      overview: overview(),
      actuals: {
        next_cursor: null,
        household_totals: { by_group: { consumption: "-60000" } },
        entries: [
          {
            allocation_id: "g1",
            amount_cents: "-60000",
            effect_kind: "consumption",
            fund_id: GROCERIES,
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
          },
          {
            allocation_id: "t1",
            amount_cents: "-60000",
            effect_kind: "movement",
            fund_id: null,
            beneficiary_scope: "shared",
            paid_by_member_id: GUSTAV,
          },
        ],
      },
      liquidity: { complete: true, accounts: [] },
      members,
      filter: { kind: "household" },
    })

    assert.deepEqual(
      view.purchases.map((row) => row.attribution),
      [sharedExpensePaidBy("Cara")],
    )
    assert.equal(view.purchases[0]?.purpose, "Groceries")
    assert.equal(JSON.stringify(view.purchases).includes(CARA), false)
  })

  it("filters beneficiary rows without changing the household total", () => {
    const actuals = {
      next_cursor: null,
      household_totals: { by_group: { consumption: "-60000" } },
      entries: [
        {
          allocation_id: "g1",
          amount_cents: "-60000",
          effect_kind: "consumption",
          fund_id: GROCERIES,
          beneficiary_scope: "shared",
          paid_by_member_id: CARA,
        },
      ],
    }
    const household = projectBudget({
      overview: overview(),
      actuals,
      liquidity: { complete: true, accounts: [] },
      members,
      filter: { kind: "household" },
    })
    const cara = projectBudget({
      overview: overview(),
      actuals,
      liquidity: { complete: true, accounts: [] },
      members,
      filter: { kind: "member", memberId: CARA },
    })

    assert.equal(household.householdConsumption, "-R600")
    assert.equal(cara.householdConsumption, household.householdConsumption)
    assert.equal(cara.purchases.length, 0)
    assert.equal(cara.unassigned.amount, household.unassigned.amount)
  })

  it("keeps a debt commitment out of the consumption table", () => {
    const view = projectBudget({
      overview: overview({
        current_plan: {
          version_number: 2,
          lines: [
            line({}),
            line({
              fund_id: RETIREMENT,
              name: "Retirement",
              kind: "debt_commitment",
              funding_behaviour: "cycle_allowance",
              contribution_cents: "100000",
            }),
          ],
        },
        funds: [
          {
            fund_id: GROCERIES,
            name: "Groceries",
            status: "active",
            beneficiary_scope: "shared",
            balance_cents: "100",
            assigned_cents: "100",
            restricted_cents: "0",
          },
          {
            fund_id: RETIREMENT,
            name: "Retirement",
            status: "active",
            beneficiary_scope: "shared",
            balance_cents: "100000",
            assigned_cents: "100000",
            restricted_cents: "0",
          },
        ],
      }),
      actuals: { entries: [], next_cursor: null, household_totals: { by_group: {} } },
      liquidity: { complete: true, accounts: [] },
      members,
      filter: { kind: "household" },
    })

    assert.equal(view.purposes.some((row) => row.name === "Retirement"), false)
    assert.equal(view.commitments.some((row) => row.name === "Retirement"), true)
  })

  it("shows a restricted balance as funded but not immediately accessible", () => {
    const view = projectBudget({
      overview: overview({
        funds: [
          {
            fund_id: GROCERIES,
            name: "Groceries",
            status: "active",
            beneficiary_scope: "shared",
            balance_cents: "150000",
            assigned_cents: "150000",
            liquid_cents: "120000",
            restricted_cents: "30000",
          },
        ],
      }),
      actuals: { entries: [], next_cursor: null, household_totals: { by_group: {} } },
      liquidity: { complete: true, accounts: [] },
      members,
      filter: { kind: "household" },
    })

    const row = view.purposes[0]
    assert.equal(row?.available, "R1 200")
    assert.match(row?.disclosure.join(" ") ?? "", /Funded but not immediately accessible/)
  })

  it("does not invent cycle spend from a partial actuals page", () => {
    const view = projectBudget({
      overview: overview(),
      actuals: {
        next_cursor: "opaque",
        entries: [
          {
            allocation_id: "g1",
            amount_cents: "-60000",
            effect_kind: "consumption",
            fund_id: GROCERIES,
            beneficiary_scope: "shared",
            paid_by_member_id: CARA,
          },
        ],
        household_totals: { by_group: { consumption: "-60000" } },
      },
      liquidity: { complete: true, accounts: [] },
      members,
      filter: { kind: "household" },
    })

    assert.equal(view.listPartial, true)
    assert.equal(view.purposes[0]?.spent, copy.withheld)
  })
})
