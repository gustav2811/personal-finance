import type { DraftLineInput } from "./commands"
import { copy } from "./copy"
import { addMonths, assertIsoDate } from "./cycle"
import { formatCents, isCents, parseCents } from "./money"
import { readRecord, readString } from "./wire"

export type CycleChoice = "this" | "next"

export type PlanLine = {
  stableLineId: string
  fundId: string
  name: string
  kind: DraftLineInput["kind"]
  contributionCents: string
  fundingBehaviour: DraftLineInput["fundingBehaviour"]
  beneficiaryScope: DraftLineInput["beneficiaryScope"]
  beneficiaryMemberId: string | null
  plannedPayerMemberId: string | null
  targetCents: string | null
  dueOn: string | null
}

export type VersionHeader = {
  versionId: string
  state: "draft" | "published"
  versionNumber: string | null
}

export type PublishedPlan = {
  versionId: string
  versionNumber: string
  startsOnCycle: string
  lines: PlanLine[]
}

export type PlanDiff = {
  stableLineId: string
  name: string
  original: string
  revised: string
  unchanged: boolean
  text: string
}

export type DraftReceipt = {
  versionId: string
  draftRevision: string
}

const KINDS = ["consumption", "contribution", "debt_commitment"] as const
const BEHAVIOURS = ["cycle_allowance", "accumulating", "target_by_date", "reserve_target"] as const
const SCOPES = ["shared", "member"] as const

function unreadable(): Error {
  return new Error(copy.couldNotRead)
}

function countString(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null
    return String(value)
  }
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) return value
  return null
}

function requireCount(value: unknown): string {
  const count = countString(value)
  if (!count) throw unreadable()
  return count
}

function requireDate(value: unknown): string {
  if (typeof value !== "string") throw unreadable()
  try {
    return assertIsoDate(value)
  } catch {
    throw unreadable()
  }
}

function optionalDate(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return requireDate(value)
}

function requireCents(value: unknown): string {
  const cents = parseCents(value)
  if (!cents || cents.startsWith("-")) throw unreadable()
  return cents
}

function optionalCents(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return requireCents(value)
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string") throw unreadable()
  const match = allowed.find((item) => item === value)
  if (!match) throw unreadable()
  return match
}

function readCursor(record: Record<string, unknown>): string | null {
  if (!("next_cursor" in record) || record.next_cursor === null) return null
  if (typeof record.next_cursor === "string" && record.next_cursor.length > 0) return record.next_cursor
  throw unreadable()
}

function versionHeader(value: unknown): VersionHeader {
  const record = readRecord(value)
  if (!record) throw unreadable()
  const versionId = readString(record, "version_id")
  const state = readString(record, "state")
  if (!versionId || (state !== "draft" && state !== "published")) throw unreadable()
  const versionNumber = countString(record.version_number)
  if (state === "published" && !versionNumber) throw unreadable()
  return { versionId, state, versionNumber }
}

function lineOf(value: unknown): PlanLine {
  const record = readRecord(value)
  if (!record) throw unreadable()
  const stableLineId = readString(record, "stable_line_id")
  const fundId = readString(record, "fund_id")
  const name = readString(record, "name")
  if (!stableLineId || !fundId || !name) throw unreadable()
  const kind = requireEnum(record.kind, KINDS)
  const fundingBehaviour = requireEnum(record.funding_behaviour, BEHAVIOURS)
  const beneficiaryScope = requireEnum(record.beneficiary_scope, SCOPES)
  const beneficiaryMemberId = readString(record, "beneficiary_member_id")
  const plannedPayerMemberId = readString(record, "planned_payer_member_id")
  const targetCents = optionalCents(record.target_cents)
  const dueOn = optionalDate(record.due_on)
  if (beneficiaryScope === "member" && !beneficiaryMemberId) throw unreadable()
  if (beneficiaryScope === "shared" && beneficiaryMemberId) throw unreadable()
  if (fundingBehaviour === "target_by_date" && (!targetCents || !dueOn)) throw unreadable()
  return {
    stableLineId,
    fundId,
    name,
    kind,
    contributionCents: requireCents(record.contribution_cents),
    fundingBehaviour,
    beneficiaryScope,
    beneficiaryMemberId,
    plannedPayerMemberId,
    targetCents,
    dueOn,
  }
}

export function readVersionPage(payload: unknown): { versions: VersionHeader[]; nextCursor: string | null } {
  const record = readRecord(payload)
  if (!record || !Array.isArray(record.versions)) throw unreadable()
  return {
    versions: record.versions.map(versionHeader),
    nextCursor: readCursor(record),
  }
}

export function latestPublished(versions: readonly VersionHeader[]): VersionHeader | null {
  let best: VersionHeader | null = null
  let bestNumber: bigint | null = null
  for (const version of versions) {
    if (version.state !== "published") continue
    if (!version.versionNumber) throw unreadable()
    const number = BigInt(version.versionNumber)
    if (bestNumber === null || number > bestNumber) {
      best = version
      bestNumber = number
    }
  }
  return best
}

export function readPublishedPlan(payload: unknown): PublishedPlan {
  const root = readRecord(payload)
  const version = root ? readRecord(root.version) : null
  if (!version || version.state !== "published") throw unreadable()
  const versionId = readString(version, "version_id")
  const startsOnCycle = readString(version, "starts_on_cycle")
  if (!versionId || !startsOnCycle) throw unreadable()
  const lines = Array.isArray(version.lines) ? version.lines.map(lineOf) : null
  if (!lines) throw unreadable()
  const fundIds = new Set<string>()
  const lineIds = new Set<string>()
  for (const line of lines) {
    if (fundIds.has(line.fundId) || lineIds.has(line.stableLineId)) throw unreadable()
    fundIds.add(line.fundId)
    lineIds.add(line.stableLineId)
  }
  return {
    versionId,
    versionNumber: requireCount(version.version_number),
    startsOnCycle: requireDate(startsOnCycle),
    lines,
  }
}

export function cloneLines(lines: readonly PlanLine[]): PlanLine[] {
  return lines.map((line) => ({ ...line }))
}

export function replaceContribution(
  lines: readonly PlanLine[],
  stableLineId: string,
  contributionCents: string,
): PlanLine[] {
  if (!lines.some((line) => line.stableLineId === stableLineId)) throw new Error(copy.couldNotSave)
  return lines.map((line) => (line.stableLineId === stableLineId ? { ...line, contributionCents } : line))
}

export function chosenStartsOn(startsOnCycle: string, choice: CycleChoice): string {
  switch (choice) {
    case "this":
      return startsOnCycle
    case "next":
      return addMonths(startsOnCycle, 1)
    default: {
      const neverChoice: never = choice
      return neverChoice
    }
  }
}

function contributionDiff(
  stableLineId: string,
  name: string,
  originalCents: string | null,
  revisedCents: string | null,
): PlanDiff {
  const original = formatCents(originalCents)
  const revised = formatCents(revisedCents)
  const unchanged = originalCents !== null && originalCents === revisedCents
  const amounts = `${copy.originalPlan} ${original}. ${copy.revisedPlan} ${revised}.`
  return {
    stableLineId,
    name,
    original,
    revised,
    unchanged,
    text: unchanged ? `${name}. ${amounts} ${copy.planUnchanged}` : `${name}. ${amounts}`,
  }
}

export function planDiff(before: readonly PlanLine[], after: readonly PlanLine[]): PlanDiff[] {
  const revisedById = new Map(after.map((line) => [line.stableLineId, line.contributionCents]))
  const seen = new Set<string>()
  const rows: PlanDiff[] = []
  for (const line of before) {
    seen.add(line.stableLineId)
    const revisedCents = revisedById.get(line.stableLineId) ?? null
    rows.push(contributionDiff(line.stableLineId, line.name, line.contributionCents, revisedCents))
  }
  for (const line of after) {
    if (seen.has(line.stableLineId)) continue
    rows.push(contributionDiff(line.stableLineId, line.name, null, line.contributionCents))
  }
  return rows
}

export function contributionsReady(lines: readonly PlanLine[]): boolean {
  if (lines.length === 0) return false
  const fundIds = new Set<string>()
  for (const line of lines) {
    if (!isCents(line.contributionCents) || line.contributionCents.startsWith("-")) return false
    if (fundIds.has(line.fundId)) return false
    fundIds.add(line.fundId)
    if (line.fundingBehaviour === "target_by_date" && (!line.targetCents || !line.dueOn)) return false
  }
  return true
}

export function publishReady(reason: string, lines: readonly PlanLine[]): boolean {
  return reason.trim().length > 0 && contributionsReady(lines)
}

export function toDraftLines(lines: readonly PlanLine[]): DraftLineInput[] {
  return lines.map((line) => ({
    stableLineId: line.stableLineId,
    fundId: line.fundId,
    name: line.name,
    kind: line.kind,
    contributionCents: line.contributionCents,
    fundingBehaviour: line.fundingBehaviour,
    beneficiaryScope: line.beneficiaryScope,
    beneficiaryMemberId: line.beneficiaryMemberId ?? undefined,
    plannedPayerMemberId: line.plannedPayerMemberId ?? undefined,
    targetCents: line.targetCents ?? undefined,
    dueOn: line.dueOn ?? undefined,
  }))
}

export function readDraftReceipt(payload: unknown): DraftReceipt {
  const record = readRecord(payload)
  if (!record) throw new Error(copy.couldNotSave)
  const versionId = readString(record, "version_id")
  const draftRevision = countString(record.draft_revision)
  if (!versionId || !draftRevision) throw new Error(copy.couldNotSave)
  return { versionId, draftRevision }
}
