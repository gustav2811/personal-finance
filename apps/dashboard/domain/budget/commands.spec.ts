import assert from "node:assert/strict"
import { describe, it } from "node:test"
import {
  assertReviewEconomics,
  buildDraftPayload,
  buildEarmarkPayload,
  buildReconciliationPayload,
  buildReviewPayload,
  refundComponent,
  reviewDecisionForSave,
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

describe("utility review payload", () => {
  it("requires the utility decision reference and does not add it to a bank review", () => {
    const component = {
      amountCents: "-3494",
      beneficiaryScope: "shared" as const,
      effectKind: "consumption" as const,
      fundId: FUND,
    }
    assert.throws(
      () =>
        buildReviewPayload({
          utilityEntryId: LINE,
          expectedSourceFingerprint: "live",
          sourceAmountCents: "-3494",
          components: [component],
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: utility decision",
    )
    const utility = buildReviewPayload({
      utilityEntryId: LINE,
      expectedSourceFingerprint: "live",
      sourceAmountCents: "-3494",
      components: [component],
      evidence: { utilityDecisionReference: "statement 12" },
    })
    assert.equal((utility.evidence as { utility_decision_reference?: string }).utility_decision_reference, "statement 12")
    const bank = buildReviewPayload({
      transactionId: "tx-1",
      expectedSourceFingerprint: "live",
      sourceAmountCents: "-3494",
      components: [component],
    })
    assert.equal("utility_decision_reference" in (bank.evidence as object), false)
  })

  it("keeps a utility category on the component and does not send a bank decision", () => {
    const utility = buildReviewPayload({
      utilityEntryId: LINE,
      expectedSourceFingerprint: "live",
      sourceAmountCents: "-3494",
      components: [
        {
          amountCents: "-3494",
          beneficiaryScope: "shared",
          effectKind: "consumption",
          fundId: FUND,
          categoryId: FUND,
        },
      ],
      evidence: { utilityDecisionReference: "statement 12" },
      decisionUpdate: { categoryId: FUND, isTransfer: false, excludeFromSpend: false },
    })

    assert.equal("decision_update" in utility, false)
    assert.equal((utility.components as Array<{ category_id: string | null }>)[0]?.category_id, FUND)
    assert.equal(
      reviewDecisionForSave({
        utility: true,
        split: false,
        decisionsConfirmed: false,
        categoryId: FUND,
        isTransfer: false,
        excludeFromSpend: false,
      }),
      undefined,
    )
  })
})

describe("unreviewed mixed purchase", () => {
  it("confirms classification and treatment before the split is sent", () => {
    const groceries = "00000000-0000-4000-8000-0000000000c1"
    const gifts = "00000000-0000-4000-8000-0000000000c2"
    const decision = reviewDecisionForSave({
      utility: false,
      split: true,
      decisionsConfirmed: false,
      categoryId: groceries,
      isTransfer: false,
      excludeFromSpend: false,
    })
    assert.ok(decision)
    const payload = buildReviewPayload({
      transactionId: "fresh-unreviewed",
      expectedSourceFingerprint: "live",
      sourceAmountCents: "-20000",
      mixed: true,
      components: [
        {
          amountCents: "-12000",
          beneficiaryScope: "shared",
          effectKind: "consumption",
          fundId: FUND,
          categoryId: groceries,
        },
        {
          amountCents: "-8000",
          beneficiaryScope: "shared",
          effectKind: "consumption",
          fundId: LINE,
          categoryId: gifts,
        },
      ],
      evidence: { splitReviewReason: "mixed till slip", receiptReference: "mixed till slip" },
      decisionUpdate: decision,
    })
    const update = payload.decision_update as { category_id: string; is_transfer: boolean; exclude_from_spend: boolean }

    assert.equal(update.category_id, groceries)
    assert.equal(update.is_transfer, false)
    assert.equal(update.exclude_from_spend, false)
    assert.equal((payload.components as Array<{ category_id: string }>).map((row) => row.category_id).join(","), `${groceries},${gifts}`)
  })
})

describe("refund link", () => {
  it("links a named purchase and keeps the opening reason as the exception", () => {
    const linked = refundComponent({
      amountCents: "20000",
      beneficiaryScope: "shared",
      categoryId: FUND,
      fundId: null,
      purchase: { allocationId: LINE, fundId: FUND },
      openingReason: "",
    })
    const opening = refundComponent({
      amountCents: "20000",
      beneficiaryScope: "member",
      beneficiaryMemberId: LINE,
      categoryId: FUND,
      fundId: FUND,
      purchase: null,
      openingReason: "Before the opening",
    })

    assert.equal(linked.originalRefundAllocationId, LINE)
    assert.equal(linked.fundId, FUND)
    assert.equal(linked.openingRefundReason, undefined)
    assert.equal(opening.originalRefundAllocationId, undefined)
    assert.equal(opening.openingRefundReason, "Before the opening")
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
