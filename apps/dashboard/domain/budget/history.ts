import { copy, planChangedSentence } from "./copy"
import { correctionChain, groupActualsByMonth, type CorrectionHop, type MonthActual } from "./v1"
import type { BeneficiaryFilter } from "./overview"
import { formatCents, isCents } from "./money"
import { readArray, readRecord, readString } from "./wire"

export type HistoryAmount = {
  label: string
  text: string
  cents: string | null
}

export type CorrectionTrail = {
  sourceTransactionId: string | null
  supersedesId: string
  fundId: string | null
}

export type HistoryRow = {
  fundId: string
  name: string
  original: HistoryAmount
  revised: HistoryAmount
  spent: HistoryAmount
  planChange: string | null
  correction: string | null
}

export type HistoryProjection = {
  rows: HistoryRow[]
  householdTotal: string
  householdTotalLabel: string
  householdTotalDetail: string
  listPartial: boolean
  partialList: string | null
  corrections: CorrectionTrail[]
  chain: CorrectionHop[]
  months: MonthActual[]
  planChangeNote: string
  correctionNote: string
}

export type HistoryInput = {
  version: unknown
  parent: unknown
  actuals: unknown
  filter?: BeneficiaryFilter
}

export type ChartRow = {
  name: string
  original: number
  revised: number
  spent: number
  originalText: string
  revisedText: string
  spentText: string
}

type PlanLine = {
  fundId: string
  name: string
  contributionCents: string | null
  beneficiaryScope: string | null
  beneficiaryMemberId: string | null
}

function versionRecord(value: unknown): Record<string, unknown> | null {
  const record = readRecord(value)
  if (!record) return null
  return readRecord(record.version) ?? record
}

function linesFrom(value: unknown): PlanLine[] {
  const record = versionRecord(value)
  if (!record) return []
  return readArray(record.lines).flatMap((entry) => {
    const line = readRecord(entry)
    const fundId = line ? readString(line, "fund_id") : null
    if (!line || !fundId) return []
    return [
      {
        fundId,
        name: readString(line, "name") ?? "Purpose",
        contributionCents: parseKnownCents(line.contribution_cents),
        beneficiaryScope: readString(line, "beneficiary_scope"),
        beneficiaryMemberId: readString(line, "beneficiary_member_id"),
      },
    ]
  })
}

function parseKnownCents(value: unknown): string | null {
  if (typeof value !== "string" || !isCents(value)) return null
  return value
}

function labelled(label: string, cents: string | null): HistoryAmount {
  const known = cents !== null && isCents(cents) ? cents : null
  return {
    label,
    text: known === null ? copy.withheld : formatCents(known),
    cents: known,
  }
}

function matches(scope: string | null, memberId: string | null, filter: BeneficiaryFilter): boolean {
  switch (filter.kind) {
    case "household":
      return true
    case "shared":
      return scope === "shared"
    case "member":
      return scope === "member" && memberId === filter.memberId
    default: {
      const never: never = filter
      return never
    }
  }
}

function listPartial(actuals: Record<string, unknown>): boolean {
  return actuals.next_cursor != null && actuals.next_cursor !== ""
}

function consumptionByFund(entries: unknown[]): Map<string, string> {
  const totals = new Map<string, bigint>()
  for (const entry of entries) {
    const record = readRecord(entry)
    const effect = record ? readString(record, "effect_kind") : null
    if (!record || (effect !== "consumption" && effect !== "refund")) continue
    const fundId = readString(record, "fund_id")
    const amount = parseKnownCents(record.amount_cents)
    if (!fundId || !amount) continue
    totals.set(fundId, (totals.get(fundId) ?? BigInt(0)) + BigInt(amount))
  }
  return new Map([...totals].map(([fundId, total]) => [fundId, total.toString()]))
}

function planChangeSentence(name: string, original: string | null, revised: string | null): string | null {
  if (original === null || revised === null || original === revised) return null
  const direction = BigInt(revised) > BigInt(original) ? "increased" : "decreased"
  return planChangedSentence(name, direction)
}

function correctionsOf(entries: unknown[]): CorrectionTrail[] {
  return entries.flatMap((entry) => {
    const record = readRecord(entry)
    const supersedesId = record ? readString(record, "supersedes_id") : null
    if (!record || !supersedesId) return []
    return [
      {
        sourceTransactionId: readString(record, "source_transaction_id"),
        supersedesId,
        fundId: readString(record, "fund_id"),
      },
    ]
  })
}

function householdConsumption(actuals: Record<string, unknown>): string | null {
  const totals = readRecord(actuals.household_totals)
  const byGroup = totals ? readRecord(totals.by_group) : null
  return byGroup ? parseKnownCents(byGroup.consumption) : null
}

function centsNumber(cents: string): number | null {
  if (!isCents(cents)) return null
  const value = Number(cents)
  return Number.isSafeInteger(value) ? value : null
}

function pointOf(row: HistoryRow): ChartRow | null {
  if (row.original.cents === null || row.revised.cents === null || row.spent.cents === null) return null
  const original = centsNumber(row.original.cents)
  const revised = centsNumber(row.revised.cents)
  const spent = centsNumber(row.spent.cents)
  if (original === null || revised === null || spent === null) return null
  return {
    name: row.name,
    original,
    revised,
    // Consumption is a signed outflow. The bar is its magnitude so it can sit beside the plan.
    spent: Math.abs(spent),
    originalText: row.original.text,
    revisedText: row.revised.text,
    spentText: row.spent.text,
  }
}

export function projectHistory(input: HistoryInput): HistoryProjection {
  const revisedLines = linesFrom(input.version)
  const originalLines = linesFrom(input.parent)
  const revisedByFund = new Map(revisedLines.map((line) => [line.fundId, line]))
  const originalByFund = new Map(originalLines.map((line) => [line.fundId, line]))
  const order = [
    ...revisedLines.map((line) => line.fundId),
    ...originalLines.map((line) => line.fundId).filter((fundId) => !revisedByFund.has(fundId)),
  ]
  const actuals = readRecord(input.actuals) ?? {}
  const partial = listPartial(actuals)
  const entries = readArray(actuals.entries)
  const spentByFund = partial ? null : consumptionByFund(entries)
  const corrections = correctionsOf(entries)
  const correctedFunds = new Set(corrections.flatMap((trail) => (trail.fundId ? [trail.fundId] : [])))
  const filter = input.filter ?? { kind: "household" as const }
  const rows = [...new Set(order)].flatMap((fundId) => {
    const revised = revisedByFund.get(fundId)
    const original = originalByFund.get(fundId)
    const scope = revised?.beneficiaryScope ?? original?.beneficiaryScope ?? null
    const memberId = revised?.beneficiaryMemberId ?? original?.beneficiaryMemberId ?? null
    if (!matches(scope, memberId, filter)) return []
    const spentCents = spentByFund === null ? null : (spentByFund.get(fundId) ?? "0")
    return [
      {
        fundId,
        name: revised?.name ?? original?.name ?? "Purpose",
        original: labelled(copy.originalPlan, original?.contributionCents ?? null),
        revised: labelled(copy.revisedPlan, revised?.contributionCents ?? null),
        spent: labelled(copy.spent, spentCents),
        planChange: planChangeSentence(revised?.name ?? original?.name ?? "Purpose", original?.contributionCents ?? null, revised?.contributionCents ?? null),
        correction: correctedFunds.has(fundId) ? copy.correctedSpend : null,
      },
    ]
  })

  return {
    rows,
    householdTotal: formatCents(householdConsumption(actuals)),
    householdTotalLabel: copy.householdTotal,
    householdTotalDetail: copy.householdTotalDetail,
    listPartial: partial,
    partialList: partial ? copy.partialList : null,
    corrections,
    chain: correctionChain(entries),
    months: partial ? [] : groupActualsByMonth(entries),
    planChangeNote: copy.planChangeIsNotCorrection,
    correctionNote: copy.correctedSpend,
  }
}

// A missing cent is unknown, not zero. Omit the chart rather than drawing that zero.
function isHistoryInput(input: readonly HistoryRow[] | HistoryInput): input is HistoryInput {
  return !Array.isArray(input)
}

function rowsOf(input: readonly HistoryRow[] | HistoryInput): readonly HistoryRow[] {
  if (isHistoryInput(input)) return projectHistory(input).rows
  return input
}

export function chartRows(input: readonly HistoryRow[] | HistoryInput): ChartRow[] | null {
  const rows = rowsOf(input)
  if (rows.length === 0) return null
  const plotted: ChartRow[] = []
  for (const row of rows) {
    const point = pointOf(row)
    if (!point) return null
    plotted.push(point)
  }
  return plotted
}
