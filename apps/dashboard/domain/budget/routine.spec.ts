import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { copy } from "./copy"
import { formatCents } from "./money"
import { formatSpokenDate } from "./cycle"
import { agreementHref, projectRoutine, routineHref } from "./routine"

const CARA = "00000000-0000-0000-0000-000000000011"
const GUSTAV = "00000000-0000-0000-0000-000000000012"
const GROCERIES = "00000000-0000-0000-0000-000000000202"
const GIFTS = "00000000-0000-0000-0000-000000000201"
const RETIREMENT = "00000000-0000-0000-0000-000000000203"
const LINE = "00000000-0000-0000-0000-000000000901"
const PAY = "00000000-0000-0000-0000-000000000801"

const members = [
  { id: CARA, email: "cara@klingbiel.org" },
  { id: GUSTAV, email: "gustav@klingbiel.org" },
]

function line(overrides: Record<string, unknown>) {
  return {
    id: LINE,
    fund_id: GROCERIES,
    name: "Groceries",
    kind: "consumption",
    contribution_cents: "600000",
    funding_behaviour: "cycle_allowance",
    beneficiary_scope: "shared",
    ...overrides,
  }
}

function fund(overrides: Record<string, unknown>) {
  return {
    fund_id: GROCERIES,
    name: "Groceries",
    status: "active",
    balance_cents: "140000",
    liquid_cents: "140000",
    restricted_cents: "0",
    ...overrides,
  }
}

function source(overrides: {
  overview?: Record<string, unknown>
  liquidity?: Record<string, unknown>
  actuals?: Record<string, unknown>
  review?: unknown | null
} = {}) {
  return {
    overview: {
      complete: true,
      cycle_start: "2026-09-23",
      end_exclusive: "2026-10-23",
      as_of: "2026-10-10T10:00:00Z",
      current_version_id: "version",
      unassigned_cents: "200000",
      forecast_gap_cents: "25000",
      reasons: [],
      current_plan: {
        version_number: 2,
        lines: [
          line({}),
          line({
            id: "gifts-line",
            fund_id: GIFTS,
            name: "Gifts",
            kind: "consumption",
            funding_behaviour: "accumulating",
            contribution_cents: "50000",
          }),
          line({
            id: "retirement-line",
            fund_id: RETIREMENT,
            name: "Retirement",
            kind: "contribution",
            funding_behaviour: "cycle_allowance",
            contribution_cents: "300000",
          }),
        ],
      },
      funds: [
        fund({}),
        fund({ fund_id: GIFTS, name: "Gifts", balance_cents: "300000", liquid_cents: "300000" }),
        fund({ fund_id: RETIREMENT, name: "Retirement", balance_cents: "500000", liquid_cents: "500000" }),
      ],
      provenance: { resources: { reconciliation_id: "rec", reconciliation_fingerprint: "secret-fingerprint" } },
      ...overrides.overview,
    },
    actuals: overrides.actuals ?? {
      entries: [
        {
          allocation_id: "buy",
          effect_kind: "consumption",
          amount_cents: "-60000",
          fund_id: GROCERIES,
          beneficiary_scope: "shared",
          paid_by_member_id: CARA,
        },
      ],
      next_cursor: null,
      household_totals: { by_group: { consumption: "-60000" }, by_actual_payer: { [CARA]: { consumption: "-60000" } } },
    },
    liquidity: {
      complete: true,
      reasons: [],
      card_debt_cents: "0",
      accounts: [
        { account_id: PAY, owner_member_id: CARA, owner_scope: "member", resource_class: "liquid", normalized_cash_cents: "0" },
        { account_id: "bond", owner_member_id: CARA, owner_scope: "member", resource_class: "mortgage", normalized_cash_cents: "900000" },
      ],
      expected: [
        { kind: "income", date: "2026-10-25", amount_cents: "1000000", planned_payer_member_id: CARA, account_id: PAY },
        {
          kind: "payment",
          date: "2026-10-16",
          amount_cents: "120000",
          planned_payer_member_id: CARA,
          account_id: PAY,
          provenance: { line_id: LINE },
        },
      ],
      forecast: { uncertainty_reasons: ["no_statement_forecast"] },
      ...overrides.liquidity,
    },
    members,
    review: overrides.review === undefined ? { items: [], reasons: [] } : overrides.review,
  }
}

describe("household routine", () => {
  it("says what is still spendable after commitments and sinking funds, without adding unassigned cash", () => {
    const routine = projectRoutine(source())

    assert.equal(routine.spend.amount, formatCents("140000"))
    assert.match(routine.spend.sentence, /still for everyday spending this cycle, after commitments/)
    assert.match(routine.spend.detail ?? "", /Gifts stays reserved/)
    assert.match(routine.spend.detail ?? "", /not claimed by a purpose/)
    assert.equal(routine.spend.amount?.includes("3 000"), false)
    assert.equal(routine.spend.amount?.includes("2 000"), false)
    assert.equal(routine.spend.amount?.includes("5 000"), false)
    assert.equal(JSON.stringify(routine.spend).includes("overspent"), false)
  })

  it("names a shortfall elsewhere before treating the everyday allowance as spendable", () => {
    const routine = projectRoutine(
      source({
        overview: {
          funds: [
            fund({}),
            fund({ fund_id: GIFTS, name: "Gifts", balance_cents: "-50000", liquid_cents: "-50000" }),
            fund({ fund_id: RETIREMENT, name: "Retirement", balance_cents: "500000", liquid_cents: "500000" }),
          ],
        },
      }),
    )

    assert.equal(routine.spend.amount, null)
    assert.match(routine.spend.sentence, /^Gifts is short by R500\./)
    assert.match(routine.spend.sentence, /R1 400 is still set aside/)
    assert.match(routine.spend.sentence, /not spendable until the shortfall is covered/)
    assert.equal(routine.spend.sentence.startsWith("R1 400"), false)
    assert.equal((routine.spend.detail ?? "").includes("Gifts stays reserved"), false)
    assert.equal(JSON.stringify(routine.spend).toLowerCase().includes("overspent"), false)
  })

  it("withholds spend in plain language when opening balances are not agreed", () => {
    const routine = projectRoutine(
      source({
        overview: {
          complete: false,
          unassigned_cents: "800000",
          reasons: [{ code: "cutover_missing" }],
        },
        liquidity: { complete: false, reasons: [{ code: "resource_balance_unknown" }], accounts: [] },
      }),
    )

    assert.equal(routine.spend.amount, null)
    assert.match(routine.spend.sentence, /Opening balances have not been agreed/)
    assert.equal(routine.spend.sentence.toLowerCase().includes("fingerprint"), false)
    assert.equal(routine.spend.sentence.toLowerCase().includes("reconcil"), false)
    assert.equal(JSON.stringify(routine).includes("800000"), false)
    assert.equal(JSON.stringify(routine).includes("R8 000"), false)
    assert.equal(routine.next, "opening")
  })

  it("says Cara needs money before Friday to pay the named bill, and ignores mortgage backing", () => {
    const routine = projectRoutine(source())

    assert.equal(formatSpokenDate("2026-10-16"), "Friday 16 Oct")
    assert.match(routine.cash.sentence, /Cara needs R1 200 before Friday 16 Oct to pay Groceries/)
    assert.match(routine.cash.detail ?? "", /not a statement forecast/i)
    assert.match(routine.cash.detail ?? "", /not in the account that pays/)
    assert.equal(routine.cash.sentence.includes("900"), false)
    assert.equal(routine.cash.sentence.toLowerCase().includes("overspent"), false)
    assert.equal(JSON.stringify(routine.cash).includes("secret-fingerprint"), false)
  })

  it("keeps the decision queue small and does not treat a forecast caveat as work", () => {
    const routine = projectRoutine(
      source({
        review: {
          items: [
            {
              review_key: "transaction:tx",
              kind: "unallocated_outflow",
              occurred_on: "2026-10-01",
              amount_cents: "-12500",
              impact_cents: "-12500",
              reasons: [{ code: "unallocated_outflow" }],
              provenance: { current_fingerprint: "secret-fingerprint", paid_by_member_id: CARA },
            },
          ],
          reasons: [{ code: "no_statement_forecast" }, { code: "review_items_present" }],
        },
      }),
    )

    assert.equal(routine.attention.items.length, 1)
    assert.match(routine.attention.items[0]?.sentence ?? "", /Money left an account without a purpose/)
    assert.match(routine.attention.items[0]?.sentence ?? "", /Paid by Cara/)
    assert.equal(routine.attention.sentence.toLowerCase().includes("statement"), false)
    assert.equal(JSON.stringify(routine.attention).includes("secret-fingerprint"), false)
    assert.equal(routine.next, "decide")
  })

  it("treats the next cycle as one agreement, not a movement of money already saved", () => {
    const routine = projectRoutine(source())

    assert.equal(routine.agreement.sentence, copy.nextCycleKeeps)
    assert.equal(routine.agreement.detail, copy.contributionDoesNotMove)
    assert.equal(routine.next, "agree")
    assert.equal(routine.stale, null)
    assert.equal(routineHref(routine.next).href, "/budget/plan?cycle=next")
  })

  it("sends a missing current plan to this cycle, not the next one", () => {
    const routine = projectRoutine(
      source({
        overview: {
          current_plan: null,
          current_version_id: null,
          reasons: [{ code: "plan_missing" }],
        },
      }),
    )

    assert.equal(routine.next, "create")
    assert.equal(routineHref(routine.next).href, "/budget/plan?cycle=this")
    assert.equal(routineHref(routine.next).label, copy.createThisCycle)
    assert.equal(agreementHref(routine).href.includes("cycle=next"), false)
    assert.match(routine.agreement.sentence, /this cycle/)
    assert.equal(routine.agreement.sentence.includes(copy.nextCycleKeeps), false)
  })

  it("keeps first setup on this cycle when opening balances are also missing", () => {
    const routine = projectRoutine(
      source({
        overview: {
          complete: false,
          current_plan: null,
          current_version_id: null,
          reasons: [{ code: "plan_missing" }, { code: "cutover_missing" }],
        },
      }),
    )

    assert.equal(routine.next, "opening")
    assert.equal(routine.planMissing, true)
    assert.equal(agreementHref(routine).href, "/budget/plan?cycle=this")
    assert.equal(agreementHref(routine).label, copy.createThisCycle)
    assert.match(routine.agreement.detail ?? "", /later cycle can wait/)
  })
})
