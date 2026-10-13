import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { issuesFound, leadChecks, projectChecks, savedFactsFromOverview } from "./checks"
import type { PlanLine } from "./plan"

function line(patch: Partial<PlanLine> = {}): PlanLine {
  return {
    stableLineId: "line-1",
    fundId: "fund-1",
    name: "Rates",
    kind: "consumption",
    contributionCents: "120000",
    fundingBehaviour: "cycle_allowance",
    beneficiaryScope: "shared",
    beneficiaryMemberId: null,
    plannedPayerMemberId: "cara",
    targetCents: null,
    dueOn: null,
    recurrence: "cycle",
    rolloverPolicy: "carry",
    categoryId: null,
    categoryNameSnapshot: null,
    groupNameSnapshot: null,
    expectedPaymentOn: "2026-11-01",
    expectedPaymentAccountId: null,
    matchCategoryId: null,
    ...patch,
  }
}

function base(patch: Partial<Parameters<typeof projectChecks>[0]> = {}) {
  return projectChecks({
    today: "2026-10-11",
    incomeKnown: true,
    incomeIncomplete: false,
    contributionsPending: false,
    gapCents: "100",
    lines: [],
    groupOverrides: new Map(),
    saved: new Map(),
    reviewItems: false,
    ...patch,
  })
}

describe("projectChecks", () => {
  it("withholds saved balances from incomplete overview reads", () => {
    assert.equal(savedFactsFromOverview({ complete: false, reasons: [], funds: [{ fund_id: "fund-1", balance_cents: "25000" }] }), null)
    assert.equal(savedFactsFromOverview({ complete: true, reasons: [{ code: "resource_balance_unknown" }], funds: [{ fund_id: "fund-1", balance_cents: "25000" }] }), null)
    assert.equal(savedFactsFromOverview({ complete: true, reasons: [], funds: [{ fund_id: "fund-1", balance_cents: "25000" }], unassigned_cents: "0" })?.get("fund-1")?.savedCents, "25000")
  })

  it("does not infer a historical target outcome from today's saved balance", () => {
    const checks = base({
      today: "2026-10-11",
      historical: true,
      lines: [line({ fundingBehaviour: "target_by_date", targetCents: "600000", dueOn: "2026-01-01" })],
      saved: new Map([["fund-1", { fundId: "fund-1", savedCents: "250000", restrictedCents: "0", accessibleOn: null }]]),
    })
    assert.equal(checks.some((check) => check.id.startsWith("target-past")), false)
    assert.equal(checks.find((check) => check.id.startsWith("target-historical"))?.severity, "info")
  })

  it("names an affordability gap without blocking language and without treating unknown income as zero", () => {
    const over = base({ gapCents: "-120000" })
    assert.equal(over[0]?.id, "affordability")
    assert.equal(over[0]?.title.includes("R1 200"), true)
    assert.equal(over[0]?.why.toLowerCase().includes("still allowed"), true)
    assert.equal(over.some((check) => check.title.toLowerCase().includes("spend less")), false)

    const unknown = base({ incomeKnown: false, gapCents: null })
    assert.equal(unknown.some((check) => check.id === "affordability"), false)
    assert.equal(unknown[0]?.id, "income-unknown")
    assert.equal(unknown[0]?.evidence.toLowerCase().includes("not treated as zero") || unknown[0]?.evidence.includes("not included"), true)
  })

  it("does not say a future target will be missed when no projection exists", () => {
    const checks = base({
      lines: [
        line({
          name: "Annual insurance",
          fundingBehaviour: "target_by_date",
          targetCents: "600000",
          dueOn: "2026-12-01",
          expectedPaymentOn: null,
          plannedPayerMemberId: "gustav",
          expectedPaymentAccountId: "account-1",
        }),
      ],
      saved: new Map([["fund-1", { fundId: "fund-1", savedCents: "250000", restrictedCents: "0", accessibleOn: null }]]),
    })
    const target = checks.find((check) => check.id.startsWith("target-"))
    assert.ok(target)
    assert.equal(target?.severity, "info")
    assert.equal(target?.title.toLowerCase().includes("miss"), false)
    assert.equal(target?.evidence.toLowerCase().includes("not available"), true)
    assert.equal(target?.action, "Review target and contribution")
  })

  it("opens the payer fields when a bill has no paying account", () => {
    const checks = base({ lines: [line()] })
    const payer = checks.find((check) => check.id.startsWith("payer-account"))
    assert.equal(payer?.severity, "decision")
    assert.equal(payer?.target.kind, "row")
    if (payer?.target.kind === "row") assert.equal(payer.target.field, "payer")
  })

  it("names unsupported historical checks as unavailable and does not lead with them", () => {
    const checks = base()
    assert.equal(issuesFound(checks), false)
    assert.equal(leadChecks(checks).length, 0)
    assert.equal(checks.some((check) => check.id === "pressure" && check.severity === "unavailable"), true)
    assert.equal(checks.some((check) => check.id === "unused" && check.evidence.toLowerCase().includes("sweep")), true)
    assert.equal(checks.some((check) => check.title.toLowerCase().includes("health")), false)
  })

  it("withholds a recommendation when purchases are unreviewed", () => {
    const checks = base({ reviewItems: true })
    const evidence = checks.find((check) => check.id === "evidence")
    assert.equal(evidence?.severity, "info")
    assert.equal(evidence?.target.kind, "review")
    assert.equal(evidence?.evidence.toLowerCase().includes("no spending recommendation"), true)
  })
})
