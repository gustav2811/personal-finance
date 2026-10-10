import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy } from "./copy"
import { projectLiquidity } from "./liquidity"

const CARA = "00000000-0000-0000-0000-000000000011"
const GUSTAV = "00000000-0000-0000-0000-000000000012"
const UNKNOWN = "00000000-0000-0000-0000-000000000099"
const CHEQUE = "00000000-0000-0000-0000-0000000000a1"
const NOTICE = "00000000-0000-0000-0000-0000000000a2"

const members = [
  { id: CARA, email: "cara@klingbiel.org" },
  { id: GUSTAV, email: "gustav@klingbiel.org" },
]

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === "object") return Object.values(value).flatMap(strings)
  return []
}

function keys(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  if (Array.isArray(value)) return value.flatMap(keys)
  return Object.entries(value).flatMap(([key, child]) => [key, ...keys(child)])
}

describe("projectLiquidity", () => {
  it("hides a present card debt string when the read is incomplete", () => {
    const debt = "424242"
    const view = projectLiquidity(
      {
        complete: false,
        reasons: [{ code: "resource_balance_unknown" }],
        card_debt_cents: debt,
        accounts: [
          {
            account_id: CHEQUE,
            owner_member_id: CARA,
            owner_scope: "member",
            resource_class: "card",
            normalized_cash_cents: "800000",
            normalized_debt_cents: debt,
          },
        ],
        forecast: {
          expected_income_cents: "500000",
          expected_payment_cents: "125000",
          indicative_net_gap_cents: debt,
          uncertainty_reasons: ["no_statement_forecast"],
          entries: [{ kind: "payment", date: "2026-10-20", amount_cents: debt }],
        },
      },
      members,
    )

    const formatted = JSON.stringify(view)
    assert.equal(formatted.includes(debt), false)
    assert.equal(formatted.includes("R4 242,42"), false)
    assert.equal(formatted.includes("800000"), false)
    assert.equal(formatted.includes("R8 000"), false)
    assert.equal(view.headline, copy.needsReconciliation)
    assert.equal(view.cardDebt.amount, null)
    assert.equal(view.cardDebt.caption, copy.cardDebtDetail)
    assert.equal(view.accounts[0]?.cash, null)
    assert.equal(view.expectedIncome.amount, null)
    assert.equal(view.expectedPayments.amount, null)
    assert.equal(view.gap.amount, null)
    assert.equal(view.entries[0]?.amount, null)
    assert.equal(projectLiquidity({ complete: "true", card_debt_cents: "0" }, members).cardDebt.amount, null)
    assert.equal(projectLiquidity({ card_debt_cents: debt }, members).cardDebt.amount, null)
  })

  it("does not call the indicative gap available money", () => {
    const forecast = {
      expected_income_cents: "100000",
      expected_payment_cents: "40000",
      indicative_net_gap_cents: "60000",
      entries: [{ kind: "income", date: "2026-10-23", amount_cents: "100000" }],
    }
    const fromCode = projectLiquidity(
      {
        complete: true,
        card_debt_cents: "0",
        accounts: [],
        forecast: { ...forecast, uncertainty_reasons: [{ code: "no_statement_forecast" }] },
      },
      members,
    )
    const fromString = projectLiquidity(
      {
        complete: true,
        card_debt_cents: "0",
        accounts: [],
        forecast: { ...forecast, uncertainty_reasons: ["no_statement_forecast"] },
      },
      members,
    )

    for (const view of [fromCode, fromString]) {
      assert.equal(view.gap.label, copy.forecast)
      assert.match(view.gap.caption, /Not currently available money/)
      assert.match(view.gap.caption, /Not a statement forecast/)
      assert.equal(view.gap.amount, "R600")
      assert.equal(view.expectedIncome.amount, "R1 000")
      assert.equal(view.expectedIncome.caption, copy.forecastDetail)
      assert.equal(view.expectedPayments.amount, "R400")
      assert.equal(view.expectedPayments.caption, copy.forecastDetail)
      assert.notEqual(view.expectedIncome.amount, view.gap.amount)
      assert.notEqual(view.expectedPayments.amount, view.gap.amount)
    }

    const known = projectLiquidity(
      {
        complete: true,
        accounts: [],
        forecast: { ...forecast, uncertainty_reasons: [] },
      },
      members,
    )
    assert.match(known.gap.caption, /Not currently available money/)
    assert.equal(known.gap.caption.includes(copy.notStatementForecast), false)
    assert.equal(known.moveCash.label, copy.moveCash)
    assert.equal(known.moveCash.detail, copy.moveCashDetail)
  })

  it("lists accounts individually and has no field that is their sum", () => {
    const view = projectLiquidity(
      {
        complete: true,
        reasons: [],
        card_debt_cents: "900000",
        accounts: [
          {
            account_id: CHEQUE,
            owner_member_id: CARA,
            owner_scope: "member",
            resource_class: "liquid",
            normalized_cash_cents: "100000",
            normalized_debt_cents: "900000",
          },
          {
            account_id: NOTICE,
            owner_member_id: GUSTAV,
            owner_scope: "member",
            resource_class: "restricted",
            normalized_cash_cents: "250000",
            normalized_debt_cents: "0",
          },
          {
            account_id: "00000000-0000-0000-0000-0000000000aa",
            owner_member_id: null,
            owner_scope: "shared",
            resource_class: "liquid",
            normalized_cash_cents: "50",
            normalized_debt_cents: null,
          },
        ],
        forecast: {
          expected_income_cents: "1",
          expected_payment_cents: "2",
          indicative_net_gap_cents: "3",
          uncertainty_reasons: [],
          entries: [],
        },
      },
      members,
    )

    assert.deepEqual(
      view.accounts.map((account) => account.cash),
      ["R1 000", "R2 500", "R0,50"],
    )
    assert.deepEqual(
      view.accounts.map((account) => account.owner),
      ["Cara", "Gustav", copy.shared],
    )
    assert.match(view.accounts[1]?.note ?? "", /Funded but not immediately accessible/)
    assert.equal(view.cardDebt.amount, "R9 000")
    assert.equal(view.cardDebt.caption, copy.cardDebtDetail)
    assert.equal(view.accounts[0]?.cash, "R1 000")
    assert.equal(strings(view).includes("350000"), false)
    assert.equal(strings(view).includes("R3 500"), false)
    assert.equal(strings(view).includes("900000"), false)
    assert.equal(strings(view).includes(CARA), false)
    assert.equal(strings(view).includes(GUSTAV), false)
    assert.equal(
      keys(view).some((key) => /sum|total|allowance/i.test(key)),
      false,
    )

    const unnamed = projectLiquidity(
      {
        complete: true,
        accounts: [
          {
            account_id: CHEQUE,
            owner_member_id: UNKNOWN,
            owner_scope: "member",
            resource_class: "liquid",
            normalized_cash_cents: "100",
          },
        ],
      },
      members,
    )
    assert.equal(unnamed.accounts[0]?.owner, "A household member")
    assert.equal(JSON.stringify(unnamed).includes(UNKNOWN), false)
  })
})
