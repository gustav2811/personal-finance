import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildDraftPayload, buildPublishPayload } from "./commands"
import { copy } from "./copy"
import { formatCents } from "./money"
import {
  chosenStartsOn,
  cloneLines,
  latestPublished,
  planDiff,
  publishReady,
  readDraftReceipt,
  readPublishedPlan,
  readVersionPage,
  type PlanLine,
} from "./plan"

function line(contributionCents: string, stableLineId = "line-1"): PlanLine {
  return {
    stableLineId,
    fundId: `fund-${stableLineId}`,
    name: "Groceries",
    kind: "consumption",
    contributionCents,
    fundingBehaviour: "cycle_allowance",
    beneficiaryScope: "shared",
    beneficiaryMemberId: null,
    plannedPayerMemberId: null,
    targetCents: null,
    dueOn: null,
  }
}

function wireLine(contributionCents = "60000") {
  return {
    stable_line_id: "00000000-0000-4000-8000-000000000108",
    fund_id: "00000000-0000-4000-8000-000000000106",
    name: "Groceries",
    kind: "consumption",
    contribution_cents: contributionCents,
    funding_behaviour: "cycle_allowance",
    beneficiary_scope: "shared",
    beneficiary_member_id: null,
    planned_payer_member_id: null,
    target_cents: null,
    due_on: null,
  }
}

describe("planDiff", () => {
  it("shows original and revised amounts and does not say actuals changed", () => {
    const diff = planDiff([line("60000")], [line("45000")])
    const text = diff.map((row) => row.text).join(" ")
    assert.equal(diff[0]?.original, formatCents("60000"))
    assert.equal(diff[0]?.revised, formatCents("45000"))
    assert.ok(text.includes(copy.originalPlan))
    assert.ok(text.includes(copy.revisedPlan))
    assert.ok(text.includes("R600"))
    assert.ok(text.includes("R450"))
    assert.equal(text.toLowerCase().includes("actual"), false)
    assert.equal(text.toLowerCase().includes("spent"), false)
    assert.equal(text.includes("actuals changed"), false)
    assert.equal(text.includes("actual spending"), false)
    assert.equal(text.includes(copy.planUnchanged), false)
    assert.equal(text.toLowerCase().includes("available"), false)
  })

  it("keeps the original amounts when the contribution is unchanged", () => {
    const text = planDiff([line("60000")], [line("60000")]).map((row) => row.text).join(" ")
    assert.ok(text.includes(copy.originalPlan))
    assert.ok(text.includes(copy.revisedPlan))
    assert.ok(text.includes(copy.planUnchanged))
    assert.equal(text.toLowerCase().includes("actual"), false)
  })
})

describe("buildDraftPayload", () => {
  it("rejects an empty reason", () => {
    assert.throws(
      () =>
        buildDraftPayload({
          startsOnCycle: "2026-09-23",
          reason: "",
          lines: [
            {
              stableLineId: "00000000-0000-4000-8000-000000000108",
              fundId: "00000000-0000-4000-8000-000000000106",
              name: "Groceries",
              kind: "consumption",
              contributionCents: "60000",
              fundingBehaviour: "cycle_allowance",
              beneficiaryScope: "shared",
            },
          ],
        }),
      (error: unknown) => error instanceof Error && error.message === "budget_invalid: reason",
    )
  })
})

describe("published plan", () => {
  it("picks the highest published version number and clones without editing it", () => {
    const page = readVersionPage({
      versions: [
        { version_id: "published-1", state: "published", version_number: 1 },
        { version_id: "draft-9", state: "draft", version_number: 9 },
        { version_id: "published-3", state: "published", version_number: 3 },
        { version_id: "published-2", state: "published", version_number: "2" },
      ],
      next_cursor: null,
    })
    assert.equal(latestPublished(page.versions)?.versionId, "published-3")

    const payload = {
      version: {
        version_id: "published-3",
        state: "published",
        version_number: 3,
        starts_on_cycle: "2026-09-23",
        draft_revision: 4,
        lines: [wireLine("60000")],
      },
    }
    const published = readPublishedPlan(payload)
    assert.equal(published.versionNumber, "3")
    const clone = cloneLines(published.lines)
    clone[0].contributionCents = "1"
    assert.equal(published.lines[0]?.contributionCents, "60000")
    assert.equal(readPublishedPlan(payload).lines[0]?.contributionCents, "60000")
    assert.notEqual(clone[0], published.lines[0])
  })

  it("passes a numeric draft revision to publish as a string", () => {
    const receipt = readDraftReceipt({ version_id: "draft-1", draft_revision: 2 })
    const payload = buildPublishPayload({
      draftId: receipt.versionId,
      expectedDraftRevision: receipt.draftRevision,
      expectedLatestVersionNumber: "3",
      reason: "reviewed",
    })
    assert.equal(payload.expected_draft_revision, "2")
    assert.equal(typeof payload.expected_draft_revision, "string")
  })

  it("uses this cycle or the following cycle and does not block a larger contribution", () => {
    assert.equal(chosenStartsOn("2026-09-23", "this"), "2026-09-23")
    assert.equal(chosenStartsOn("2026-09-23", "next"), "2026-10-23")
    assert.equal(chosenStartsOn("2026-12-23", "next"), "2027-01-23")
    assert.equal(publishReady("", [line("999999999")]), false)
    assert.equal(publishReady("reviewed", [line("999999999")]), true)
  })
})
