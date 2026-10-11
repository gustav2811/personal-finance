import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy } from "./copy"
import { chartRows, projectHistory } from "./history"
import { formatCents } from "./money"

const CARA = "00000000-0000-0000-0000-000000000011"
const GROCERIES = "00000000-0000-0000-0000-000000000202"
const CARE = "00000000-0000-0000-0000-000000000204"
const RETIREMENT = "00000000-0000-0000-0000-000000000203"

function version(lines: Record<string, unknown>[]) {
  return { version: { lines } }
}

function line(overrides: Record<string, unknown>) {
  return {
    fund_id: GROCERIES,
    name: "Groceries",
    kind: "consumption",
    contribution_cents: "600000",
    beneficiary_scope: "shared",
    beneficiary_member_id: null,
    ...overrides,
  }
}

describe("projectHistory", () => {
  it("does not label a contribution as spent", () => {
    const view = projectHistory({
      version: version([
        line({
          fund_id: RETIREMENT,
          name: "Retirement",
          kind: "contribution",
          contribution_cents: "400000",
        }),
      ]),
      parent: version([
        line({
          fund_id: RETIREMENT,
          name: "Retirement",
          kind: "contribution",
          contribution_cents: "300000",
        }),
      ]),
      actuals: {
        next_cursor: null,
        entries: [
          {
            fund_id: RETIREMENT,
            effect_kind: "contribution",
            amount_cents: "400000",
          },
        ],
        household_totals: { by_group: { consumption: "0", contribution: "400000" } },
      },
    })

    const row = view.rows[0]
    assert.ok(row)
    assert.equal(row.original.label, copy.originalPlan)
    assert.equal(row.original.text, formatCents("300000"))
    assert.equal(row.revised.label, copy.revisedPlan)
    assert.equal(row.revised.text, formatCents("400000"))
    assert.equal(row.spent.label, copy.spent)
    assert.equal(row.spent.text, formatCents("0"))
    const withRefund = projectHistory({
      version: version([line({ contribution_cents: "50000" })]),
      parent: version([line({ contribution_cents: "50000" })]),
      actuals: {
        next_cursor: null,
        entries: [
          { fund_id: GROCERIES, effect_kind: "consumption", amount_cents: "-120000" },
          { fund_id: GROCERIES, effect_kind: "refund", amount_cents: "20000" },
          { fund_id: GROCERIES, effect_kind: "contribution", amount_cents: "-999" },
        ],
        household_totals: { by_group: { consumption: "-100000" } },
      },
    })
    assert.equal(withRefund.rows[0]?.spent.text, formatCents("-100000"))
    assert.equal(row.spent.text === row.revised.text, false)
    assert.equal(JSON.stringify(row.spent).includes("400000"), false)
    assert.equal(JSON.stringify(row.spent).includes("R4 000"), false)
  })

  it("keeps the household total when a beneficiary filter hides rows", () => {
    const actuals = {
      next_cursor: null,
      entries: [
        {
          fund_id: GROCERIES,
          effect_kind: "consumption",
          amount_cents: "-60000",
          beneficiary_scope: "shared",
        },
        {
          fund_id: CARE,
          effect_kind: "consumption",
          amount_cents: "-20000",
          beneficiary_scope: "member",
          beneficiary_member_id: CARA,
        },
      ],
      household_totals: { by_group: { consumption: "-80000" } },
      filtered_totals: { by_group: { consumption: "-20000" } },
    }
    const plan = version([
      line({}),
      line({
        fund_id: CARE,
        name: "Care",
        contribution_cents: "50000",
        beneficiary_scope: "member",
        beneficiary_member_id: CARA,
      }),
    ])
    const household = projectHistory({ version: plan, parent: plan, actuals, filter: { kind: "household" } })
    const cara = projectHistory({
      version: plan,
      parent: plan,
      actuals,
      filter: { kind: "member", memberId: CARA },
    })

    assert.equal(household.householdTotal, formatCents("-80000"))
    assert.equal(cara.householdTotal, household.householdTotal)
    assert.equal(cara.householdTotalLabel, copy.householdTotal)
    assert.equal(cara.householdTotalDetail, copy.householdTotalDetail)
    assert.equal(cara.rows.some((row) => row.name === "Groceries"), false)
    assert.equal(cara.rows.some((row) => row.name === "Care"), true)
    assert.notEqual(cara.householdTotal, formatCents("-20000"))
    assert.equal(JSON.stringify(cara).includes("filtered_totals"), false)
  })

  it("omits a zero bar when the actual is unknown", () => {
    const input = {
      version: version([line({ contribution_cents: "250000" })]),
      parent: version([line({ contribution_cents: "200000" })]),
      actuals: {
        entries: [],
        next_cursor: "opaque",
        household_totals: { by_group: { consumption: "-250000" } },
      },
    }
    const view = projectHistory(input)

    assert.equal(view.rows[0]?.spent.text, "—")
    assert.equal(view.rows[0]?.spent.cents, null)
    assert.equal(view.listPartial, true)
    assert.equal(view.partialList, "This list is not the full cycle.")
    assert.equal(chartRows(view.rows), null)
    assert.equal(chartRows(input), null)
  })

  it("does not plot a zero original when the version has no parent", () => {
    const input = {
      version: version([line({ contribution_cents: "250000" })]),
      parent: null,
      actuals: {
        entries: [{ fund_id: GROCERIES, effect_kind: "consumption", amount_cents: "-100" }],
        next_cursor: null,
        household_totals: { by_group: { consumption: "-100" } },
      },
    }
    const view = projectHistory(input)

    assert.equal(view.rows[0]?.original.text, copy.withheld)
    assert.equal(view.rows[0]?.original.cents, null)
    assert.equal(view.rows[0]?.revised.text, formatCents("250000"))
    assert.equal(chartRows(input), null)
  })

  it("plots a known zero actual instead of treating it as missing", () => {
    const view = projectHistory({
      version: version([line({ contribution_cents: "100" })]),
      parent: version([line({ contribution_cents: "100" })]),
      actuals: {
        entries: [],
        next_cursor: null,
        household_totals: { by_group: { consumption: "0" } },
      },
    })
    const rows = chartRows(view.rows)

    assert.ok(rows)
    assert.equal(rows[0]?.spent, 0)
    assert.equal(rows[0]?.original, 100)
    assert.equal(rows[0]?.revised, 100)
  })
})
