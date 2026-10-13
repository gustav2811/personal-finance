import type { IncomeAssumptionInput } from "@/domain/budget/commands"
import { centsToRandsInput } from "@/domain/budget/money"
import { incomeInput, type MoneyInput } from "@/domain/budget/capacity"
import { assertIsoDate } from "@/domain/budget/cycle"
import { randsToCents } from "@/domain/budget/move"
import type { PlanLine } from "@/domain/budget/plan"
import type { PurposeGroup } from "@/domain/budget/presentation"

export type IncomeForm = {
  memberId: string
  centsText: string
  expectedOn: string
  provenance: string
}

export function blankIncome(memberId: string, expectedOn = ""): IncomeForm {
  return { memberId, centsText: "", expectedOn, provenance: "household" }
}

function dateOrNull(value: string): string | null {
  if (value.trim().length === 0) return null
  try {
    return assertIsoDate(value)
  } catch {
    return null
  }
}

export function incomeMoney(rows: readonly IncomeForm[]): MoneyInput {
  if (rows.length === 0) return incomeInput([], false)
  if (rows.some((row) => row.centsText.trim().length > 0 && randsToCents(row.centsText) === null)) {
    return { status: "pending" }
  }
  const cents = rows.map((row) => {
    if (row.centsText.trim().length === 0 || dateOrNull(row.expectedOn) === null) return null
    return randsToCents(row.centsText)
  })
  return incomeInput(cents, true)
}

export function incomePayload(rows: readonly IncomeForm[]): IncomeAssumptionInput[] {
  return rows.flatMap((row) => {
    const cents = randsToCents(row.centsText)
    const expectedOn = dateOrNull(row.expectedOn)
    if (!cents || cents.startsWith("-") || !expectedOn) return []
    return [{ memberId: row.memberId, expectedNetCents: cents, expectedOn, provenance: row.provenance }]
  })
}

export function incomeFromPlan(entries: readonly IncomeAssumptionInput[], memberIds: readonly string[]): IncomeForm[] {
  const ids = [...memberIds]
  for (const entry of entries) {
    if (!ids.includes(entry.memberId)) ids.push(entry.memberId)
  }
  if (ids.length === 0) {
    return entries.map((entry) => ({ memberId: entry.memberId, centsText: centsToRandsInput(entry.expectedNetCents), expectedOn: entry.expectedOn, provenance: entry.provenance }))
  }
  const rows = entries.map((entry) => ({ memberId: entry.memberId, centsText: centsToRandsInput(entry.expectedNetCents), expectedOn: entry.expectedOn, provenance: entry.provenance }))
  for (const memberId of ids) if (!entries.some((entry) => entry.memberId === memberId)) rows.push(blankIncome(memberId))
  return rows
}

export function startingFunding(group: PurposeGroup, kind: PlanLine["kind"] = "consumption"): Pick<PlanLine, "kind" | "fundingBehaviour" | "recurrence"> {
  if (group === "saved") return { kind, fundingBehaviour: "accumulating", recurrence: "cycle" }
  return { kind, fundingBehaviour: "cycle_allowance", recurrence: "cycle" }
}
