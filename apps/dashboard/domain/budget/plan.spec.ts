import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { buildDraftPayload, buildPublishPayload } from "./commands"
import { copy } from "./copy"
import { formatCents } from "./money"
import {
  chosenStartsOn,
  cloneLines,
  latestPublished,
  selectAgreement,
  planDiff,
  publishReady,
  readDraftReceipt,
  readPublishedPlan,
  readStoredPlan,
  readVersionPage,
  selectDraft,
  toDraftLines,
  type PlanLine,
  type VersionHeader,
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
    recurrence: "cycle",
    rolloverPolicy: "carry",
    categoryId: null,
    categoryNameSnapshot: null,
    groupNameSnapshot: null,
    expectedPaymentOn: null,
    expectedPaymentAccountId: null,
    matchCategoryId: null,
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
    recurrence: "annual",
    rollover_policy: "release_explicit",
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
              recurrence: "cycle",
              rolloverPolicy: "carry",
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
    assert.equal(published.lines[0]?.recurrence, "annual")
    assert.equal(published.lines[0]?.rolloverPolicy, "release_explicit")
    const draft = buildDraftPayload({
      startsOnCycle: published.startsOnCycle,
      reason: "reviewed",
      parentVersionId: published.versionId,
      lines: [
        {
          stableLineId: published.lines[0].stableLineId,
          fundId: published.lines[0].fundId,
          name: published.lines[0].name,
          kind: published.lines[0].kind,
          contributionCents: published.lines[0].contributionCents,
          fundingBehaviour: published.lines[0].fundingBehaviour,
          beneficiaryScope: published.lines[0].beneficiaryScope,
          recurrence: published.lines[0].recurrence,
          rolloverPolicy: published.lines[0].rolloverPolicy,
        },
      ],
    })
    const saved = (draft.lines as Array<Record<string, string>>)[0]
    assert.equal(saved?.recurrence, "annual")
    assert.equal(saved?.rollover_policy, "release_explicit")
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
    assert.equal(payload.expected_draft_revision, 2)
    assert.equal(typeof payload.expected_draft_revision, "number")
    assert.equal(typeof payload.expected_latest_version_number, "number")
  })

  it("does not drop a bill date when the draft is saved again", () => {
    const published = readPublishedPlan({
      version: {
        version_id: "published-3",
        state: "published",
        version_number: 1,
        starts_on_cycle: "2026-09-23",
        lines: [{ ...wireLine(), expected_payment_on: "2026-10-05", expected_payment_account_id: "00000000-0000-4000-8000-000000000109", match_category_id: "00000000-0000-4000-8000-00000000010a" }],
        income_assumptions: [
          {
            member_id: "00000000-0000-4000-8000-000000000011",
            expected_net_cents: "100000",
            expected_on: "2026-10-25",
            provenance: "payslip",
          },
        ],
      },
    })
    const payload = buildDraftPayload({
      startsOnCycle: published.startsOnCycle,
      reason: "edit the amount",
      lines: toDraftLines(published.lines),
      incomeAssumptions: published.incomeAssumptions,
    })
    const saved = (payload.lines as Array<Record<string, string | null>>)[0]
    assert.equal(saved?.expected_payment_on, "2026-10-05")
    assert.equal(saved?.expected_payment_account_id, "00000000-0000-4000-8000-000000000109")
    assert.equal(saved?.match_category_id, "00000000-0000-4000-8000-00000000010a")
    assert.equal((payload.income_assumptions as Array<Record<string, string>>)[0]?.expected_on, "2026-10-25")
  })

  it("uses this cycle or the following cycle and does not block a larger contribution", () => {
    const standing = {
      versionId: "standing",
      state: "published" as const,
      versionNumber: "1",
      startsOnCycle: "2026-08-23",
      draftRevision: null,
      parentVersionId: null,
      reason: null,
      createdAt: null,
    }
    const future = {
      versionId: "future",
      state: "published" as const,
      versionNumber: "2",
      startsOnCycle: "2026-10-23",
      draftRevision: null,
      parentVersionId: null,
      reason: null,
      createdAt: null,
    }
    const thisCycle = selectAgreement([standing, future], "2026-09-23", "this")
    const nextCycle = selectAgreement([standing, future], "2026-09-23", "next")
    assert.equal(thisCycle.cycleStart, "2026-09-23")
    assert.equal(thisCycle.applicable?.versionId, "standing")
    assert.equal(thisCycle.latestVersionNumber, "2")
    assert.equal(nextCycle.cycleStart, "2026-10-23")
    assert.equal(nextCycle.applicable?.versionId, "future")
    assert.notEqual(thisCycle.cycleStart, standing.startsOnCycle)
    assert.equal(chosenStartsOn("2026-09-23", "this"), "2026-09-23")
    assert.equal(chosenStartsOn("2026-09-23", "next"), "2026-10-23")
    assert.equal(chosenStartsOn("2026-12-23", "next"), "2027-01-23")
    assert.equal(publishReady("", [line("999999999")]), false)
    assert.equal(publishReady("reviewed", [line("999999999")]), true)
  })
})

describe("stored draft", () => {
  function header(patch: Partial<VersionHeader> & Pick<VersionHeader, "versionId" | "state">): VersionHeader {
    return {
      versionNumber: null,
      startsOnCycle: "2026-10-23",
      draftRevision: "1",
      parentVersionId: null,
      reason: "draft",
      createdAt: "2026-10-11T08:00:00.000Z",
      ...patch,
    }
  }

  it("reads a draft without treating it as published", () => {
    const stored = readStoredPlan({
      version: {
        version_id: "draft-1",
        state: "draft",
        version_number: null,
        draft_revision: 2,
        starts_on_cycle: "2026-10-23",
        reason: "Create this cycle's budget",
        lines: [wireLine("50000")],
      },
    })
    assert.equal(stored.state, "draft")
    assert.equal(stored.draftRevision, "2")
    assert.equal(stored.lines[0]?.contributionCents, "50000")
    assert.throws(() => readPublishedPlan({ version: { version_id: "draft-1", state: "draft", starts_on_cycle: "2026-10-23", draft_revision: 2, lines: [] } }))
  })

  it("resumes the newest draft for the cycle and does not guess when timestamps are missing", () => {
    const older = header({ versionId: "older", state: "draft", createdAt: "2026-10-10T08:00:00.000Z" })
    const newer = header({ versionId: "newer", state: "draft", createdAt: "2026-10-11T08:00:00.000Z" })
    const otherCycle = header({ versionId: "next", state: "draft", startsOnCycle: "2026-11-23" })
    assert.equal(selectDraft([older, newer, otherCycle], "2026-10-23").status, "ready")
    const picked = selectDraft([older, newer, otherCycle], "2026-10-23")
    assert.equal(picked.status === "ready" ? picked.draft.versionId : null, "newer")
    assert.equal(selectDraft([header({ versionId: "a", state: "draft", createdAt: null }), header({ versionId: "b", state: "draft", createdAt: null })], "2026-10-23").status, "ambiguous")
    assert.equal(selectDraft([otherCycle], "2026-10-23").status, "none")
  })
})
