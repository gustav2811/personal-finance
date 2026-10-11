import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assertReviewEconomics,
  buildDraftPayload,
  buildEarmarkPayload,
  buildReconciliationPayload,
  isOneConsumptionLine,
} from "./commands"
import { moveReason } from "./move"

const FUND = "00000000-0000-4000-8000-000000000201"
const LINE = "00000000-0000-4000-8000-000000000301"

function line(overrides: Record<string, unknown> = {}) {
  return {
    stableLineId: LINE,
    fundId: FUND,
    name: "Groceries",
    kind: "consumption" as const,
    contributionCents: "60000",
    fundingBehaviour: "cycle_allowance" as const,
    beneficiaryScope: "shared" as const,
    recurrence: "cycle" as const,
    rolloverPolicy: "carry" as const,
    ...overrides,
  }
}

describe("buildDraftPayload", () => {
  it("keeps an expected payment date instead of dropping it", () => {
    const payload = buildDraftPayload({
      startsOnCycle: "2026-09-23",
      reason: "keep the bill date",
      lines: [line({ expectedPaymentOn: "2026-10-05", expectedPaymentAccountId: FUND, matchCategoryId: LINE })],
    })
    const saved = (payload.lines as Array<Record<string, string | null>>)[0]
    assert.equal(saved?.expected_payment_on, "2026-10-05")
    assert.equal(saved?.expected_payment_account_id, FUND)
    assert.equal(saved?.match_category_id, LINE)
  })
})

describe("review economics", () => {
  it("refuses a mixed purchase as one line and still allows a drifted single purchase", () => {
    const components = [
      {
        amountCents: "-90000",
        beneficiaryScope: "shared" as const,
        effectKind: "consumption" as const,
        fundId: FUND,
      },
    ]
    assert.equal(isOneConsumptionLine(components), true)
    assert.throws(
      () =>
        assertReviewEconomics({
          sourceAmountCents: "-90000",
          mixed: true,
          drifted: false,
          components,
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: split",
    )
    assert.doesNotThrow(() =>
      assertReviewEconomics({
        sourceAmountCents: "-90000",
        mixed: false,
        drifted: true,
        components,
      }),
    )
    assert.throws(
      () =>
        assertReviewEconomics({
          sourceAmountCents: "-90000",
          mixed: false,
          drifted: true,
          existingComponentCount: 2,
          components,
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: split",
    )
  })

  it("requires a refund to name the original purpose", () => {
    assert.throws(
      () =>
        assertReviewEconomics({
          sourceAmountCents: "20000",
          mixed: false,
          drifted: false,
          components: [
            {
              amountCents: "20000",
              beneficiaryScope: "shared",
              effectKind: "refund",
              fundId: FUND,
            },
          ],
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: refund",
    )
  })
})

describe("cutover commands", () => {
  it("requires exactly one earmark link", () => {
    assert.throws(
      () =>
        buildEarmarkPayload({
          fundId: FUND,
          restrictedAccountId: LINE,
          amountCents: "30000",
          effectiveOn: "2026-09-23",
          reason: "notice",
          expectedReconciliationId: FUND,
          expectedReconciliationFingerprint: "abc",
          link: {},
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: link",
    )
  })

  it("does not invent a coverage fingerprint", () => {
    assert.throws(
      () =>
        buildReconciliationPayload({
          asOf: "2026-10-10T08:00:00.000Z",
          notes: "cutover",
          evidence: "statement",
          utilityStatus: "not_required",
          utilityEvidence: "no utility account",
          accounts: [
            {
              accountId: FUND,
              status: "included",
              balanceConvention: "cash_signed",
              pendingIncludedIds: [],
              evidence: "statement",
            },
          ],
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: fingerprint",
    )
  })
})

describe("moveReason", () => {
  it("does not call an assignment a reallocation", () => {
    assert.equal(moveReason("assign"), "Assign money to a purpose")
    assert.equal(moveReason("release"), "Release money from a purpose")
    assert.notEqual(moveReason("assign"), moveReason("reallocate"))
  })
})
