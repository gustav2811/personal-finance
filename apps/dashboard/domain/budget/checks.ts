import { gapWords } from "./capacity"
import { formatDayMonth } from "./cycle"
import { absoluteCents, formatCents, isCents, parseCents } from "./money"
import { readRecord, readString } from "./wire"
import type { PlanLine } from "./plan"
import { placeGroup, type PurposeGroup } from "./presentation"

export type CheckSeverity = "decision" | "review" | "info" | "unavailable"

export type CheckTarget =
  | { kind: "contributions" }
  | { kind: "income" }
  | { kind: "row"; stableLineId: string; field: "contribution" | "target" | "payer" }
  | { kind: "position" }
  | { kind: "review" }
  | { kind: "none" }

export type BudgetCheck = {
  id: string
  severity: CheckSeverity
  title: string
  why: string
  evidence: string
  action: string
  target: CheckTarget
}

export type SavedFact = {
  fundId: string
  savedCents: string | null
  restrictedCents: string | null
  accessibleOn: string | null
}

const LEAD = 2

export function savedFactsFromOverview(payload: unknown): Map<string, SavedFact> | null {
  const root = readRecord(payload)
  if (!root || !Array.isArray(root.funds)) return null
  const facts = new Map<string, SavedFact>()
  for (const entry of root.funds) {
    const record = readRecord(entry)
    const fundId = record ? readString(record, "fund_id") : null
    if (!record || !fundId) continue
    facts.set(fundId, {
      fundId,
      savedCents: parseCents(record.balance_cents),
      restrictedCents: parseCents(record.restricted_cents),
      accessibleOn: readString(record, "accessible_on"),
    })
  }
  return facts
}

export function leadChecks(checks: readonly BudgetCheck[]): BudgetCheck[] {
  return checks.filter((check) => check.severity !== "unavailable").slice(0, LEAD)
}

export function issuesFound(checks: readonly BudgetCheck[]): boolean {
  return checks.some((check) => check.severity !== "unavailable")
}

function decision(check: Omit<BudgetCheck, "severity">): BudgetCheck {
  return { ...check, severity: "decision" }
}

function info(check: Omit<BudgetCheck, "severity">): BudgetCheck {
  return { ...check, severity: "info" }
}

function unavailable(check: Omit<BudgetCheck, "severity" | "target" | "action"> & { action?: string; target?: CheckTarget }): BudgetCheck {
  return { ...check, action: check.action ?? "No action", severity: "unavailable", target: check.target ?? { kind: "none" } }
}

function isBill(line: PlanLine, override: PurposeGroup | undefined): boolean {
  const placed = placeGroup(line, override)
  return placed.group === "bills" || line.kind === "debt_commitment" || Boolean(line.expectedPaymentOn)
}

export function projectChecks(input: {
  today: string
  incomeKnown: boolean
  incomeIncomplete: boolean
  contributionsPending: boolean
  gapCents: string | null
  lines: readonly PlanLine[]
  groupOverrides: ReadonlyMap<string, PurposeGroup>
  saved: ReadonlyMap<string, SavedFact> | null
  reviewItems: boolean | null
}): BudgetCheck[] {
  const checks: BudgetCheck[] = []
  if (input.incomeIncomplete || !input.incomeKnown) {
    checks.push(
      decision({
        id: "income-unknown",
        title: "Expected income is incomplete",
        why: "A plan gap that treats missing income as zero would overstate the shortfall.",
        evidence: "Unknown income is shown separately and is not included in the comparison.",
        action: "Complete assumptions",
        target: { kind: "income" },
      }),
    )
  } else if (input.contributionsPending) {
    checks.push(
      info({
        id: "contributions-pending",
        title: "A contribution is still being entered",
        why: "The plan gap waits for a complete amount.",
        evidence: "An incomplete number is not treated as zero.",
        action: "Review contributions",
        target: { kind: "contributions" },
      }),
    )
  } else if (input.gapCents && input.gapCents.startsWith("-") && input.gapCents !== "-0") {
    const over = absoluteCents(input.gapCents)
    checks.push(
      decision({
        id: "affordability",
        title: `Plan exceeds expected income by ${over ? formatCents(over) : gapWords(input.gapCents)}`,
        why: "The agreement asks for more than the expected net income. Publishing it is still allowed.",
        evidence: "This compares planned income and contributions, not bank cash.",
        action: "Review contributions",
        target: { kind: "contributions" },
      }),
    )
  }

  for (const line of input.lines) {
    const override = input.groupOverrides.get(line.stableLineId)
    if (line.fundingBehaviour === "target_by_date" && (!line.targetCents || !line.dueOn || !isCents(line.targetCents))) {
      checks.push(
        decision({
          id: `target-incomplete-${line.stableLineId}`,
          title: `${line.name} needs a target and a due date`,
          why: "A dated purpose cannot be checked without both figures.",
          evidence: "The agreement stores a target only when the amount and date are both set.",
          action: "Review target and contribution",
          target: { kind: "row", stableLineId: line.stableLineId, field: "target" },
        }),
      )
      continue
    }
    if (line.dueOn && line.targetCents && isCents(line.targetCents) && !line.targetCents.startsWith("-") && line.targetCents !== "0") {
      const saved = input.saved?.get(line.fundId) ?? null
      if (input.saved === null || !saved || saved.savedCents === null || !isCents(saved.savedCents)) {
        checks.push(
          info({
            id: `target-unverified-${line.stableLineId}`,
            title: `${line.name} has a target, and the saved balance is not in this read`,
            why: "Saved money and the monthly contribution are different facts. A recommendation needs the saved balance.",
            evidence: "No projection is calculated from the target and contribution alone.",
            action: "Review target and contribution",
            target: { kind: "row", stableLineId: line.stableLineId, field: "target" },
          }),
        )
      } else if (saved.savedCents.startsWith("-")) {
        checks.push(
          info({
            id: `target-negative-${line.stableLineId}`,
            title: `${line.name} has a negative saved balance`,
            why: "A progress bar would misread a negative balance as savings.",
            evidence: `Saved balance ${formatCents(saved.savedCents)}.`,
            action: "Review target and contribution",
            target: { kind: "row", stableLineId: line.stableLineId, field: "target" },
          }),
        )
      } else if (BigInt(saved.savedCents) < BigInt(line.targetCents) && line.dueOn < input.today) {
        checks.push(
          decision({
            id: `target-past-${line.stableLineId}`,
            title: `${line.name} is short of its target after ${formatDayMonth(line.dueOn)}`,
            why: "The due date has passed and the saved balance is still below the target. This is not a forecast.",
            evidence: `Saved ${formatCents(saved.savedCents)} of ${formatCents(line.targetCents)}. A projection of future contributions is not available.`,
            action: "Review target and contribution",
            target: { kind: "row", stableLineId: line.stableLineId, field: "target" },
          }),
        )
      } else if (BigInt(saved.savedCents) < BigInt(line.targetCents)) {
        checks.push(
          info({
            id: `target-open-${line.stableLineId}`,
            title: `${line.name} has ${formatCents(saved.savedCents)} saved toward ${formatCents(line.targetCents)}`,
            why: "The due date is still ahead. Saved money alone does not say whether the contribution will get there.",
            evidence: "A projection to the due date is not available, so this does not say the target will be missed.",
            action: "Review target and contribution",
            target: { kind: "row", stableLineId: line.stableLineId, field: "target" },
          }),
        )
      }
    }
    if (isBill(line, override) && !line.expectedPaymentAccountId) {
      checks.push(
        decision({
          id: `payer-account-${line.stableLineId}`,
          title: `${line.name} has no paying account`,
          why: "The household cannot see which account is expected to pay this bill.",
          evidence: line.plannedPayerMemberId
            ? "A payer is named. The paying account is not."
            : "Paid by is not assigned. Either is not a stored choice.",
          action: "Review payer and account",
          target: { kind: "row", stableLineId: line.stableLineId, field: "payer" },
        }),
      )
    } else if (!line.plannedPayerMemberId) {
      checks.push({
        id: `payer-${line.stableLineId}`,
        severity: "review",
        title: `${line.name} has no planned payer`,
        why: "Who pays is separate from who the purpose is for. An unassigned payer is a planning question, not a personal budget.",
        evidence: "The agreement permits an unassigned payer. It does not store Either.",
        action: "Review payer and account",
        target: { kind: "row", stableLineId: line.stableLineId, field: "payer" },
      })
    }
  }

  checks.push(
    unavailable({
      id: "timing",
      title: "Payment timing is not checked",
      why: "A bill can fall before money reaches its paying account, and this page cannot see that from the plan alone.",
      evidence: "budget_get_liquidity_v1 does not say, per bill, whether expected funds arrive before the payment. Plan forecast and observed cash stay separate.",
      action: "View current funding and paying accounts",
      target: { kind: "position" },
    }),
  )
  checks.push(
    unavailable({
      id: "pressure",
      title: "Repeated plan pressure is not checked",
      why: "A few completed cycles could show a contribution that was too small. One cycle, or an unreviewed purchase, is not enough.",
      action: "No action until cycle evidence exists",
      evidence: "No budget-cycle evidence query supplies comparable completed cycles with refunds, transfers, and review completeness. This is not a suggestion to spend less.",
    }),
  )
  checks.push(
    unavailable({
      id: "unused",
      title: "Unused allocations are not checked",
      why: "Money left in a purpose can be a reserve. Sweeping it would need rollover and several completed cycles.",
      action: "No action until cycle evidence exists",
      evidence: "No budget-cycle evidence query supplies that comparison. Sinking funds are not a sweep recommendation.",
    }),
  )
  if (input.reviewItems === null) {
    checks.push(
      unavailable({
        id: "evidence",
        title: "Unreviewed purchases were not read",
        why: "A spending suggestion would be unreliable if purchases are still open.",
        action: "Review purchases",
        evidence: "The review queue was not loaded. No recommendation is offered.",
        target: { kind: "review" },
      }),
    )
  } else if (input.reviewItems) {
    checks.push(
      info({
        id: "evidence",
        title: "Unreviewed purchases could change a recommendation",
        why: "Open purchases are not evidence for changing a contribution.",
        evidence: "The review queue has items. No spending recommendation is offered from them.",
        action: "Review purchases",
        target: { kind: "review" },
      }),
    )
  }
  const rank: Record<CheckSeverity, number> = { decision: 0, review: 1, info: 2, unavailable: 3 }
  return checks.sort((left, right) => rank[left.severity] - rank[right.severity])
}
