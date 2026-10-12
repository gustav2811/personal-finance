import { absoluteCents, addCents, formatCents, isCents } from "./money"

export type MoneyInput =
  | { status: "known"; cents: string }
  | { status: "pending" }
  | { status: "missing"; label: string }

export type CapacitySide = {
  income: MoneyInput
  contributions: MoneyInput
}

export type CapacityRow = {
  id: "agreed" | "proposed"
  label: string
  contributionsCents: string
  incomeCents: string
  gapCents: string
  readout: string
  markerLabel: string
  visualCapped: boolean
}

export type PlanCapacity =
  | { status: "missing"; missing: string }
  | { status: "pending"; scaleCents: string | null }
  | { status: "ready"; scaleCents: string; rows: CapacityRow[] }

function knownCents(input: MoneyInput): string | null {
  if (input.status !== "known" || !isCents(input.cents) || input.cents.startsWith("-")) return null
  return input.cents
}

export function gapWords(gapCents: string): string {
  const absolute = absoluteCents(gapCents)
  if (!absolute) return "The plan gap is incomplete."
  if (gapCents.startsWith("-") && gapCents !== "-0") return `${formatCents(absolute)} over planned income`
  return `${formatCents(absolute)} not yet planned`
}

export function capacityReadout(label: string, contributionsCents: string, incomeCents: string): string {
  const gap = (BigInt(incomeCents) - BigInt(contributionsCents)).toString()
  return `${label}: ${formatCents(contributionsCents)} against ${formatCents(incomeCents)} income — ${gapWords(gap)}.`
}

function missingOf(side: CapacitySide | null): string | null {
  if (!side) return null
  if (side.income.status === "missing") return side.income.label
  if (side.contributions.status === "missing") return side.contributions.label
  return null
}

function pendingOf(side: CapacitySide | null): boolean {
  if (!side) return false
  return side.income.status === "pending" || side.contributions.status === "pending"
}

function scaleFrom(values: readonly string[]): string {
  let max = BigInt(0)
  for (const value of values) {
    const next = BigInt(value)
    if (next > max) max = next
  }
  return max === BigInt(0) ? "1" : max.toString()
}

function rowFor(
  id: CapacityRow["id"],
  label: string,
  side: CapacitySide,
  scaleCents: string,
): CapacityRow | null {
  const contributions = knownCents(side.contributions)
  const income = knownCents(side.income)
  if (!contributions || !income) return null
  const gap = (BigInt(income) - BigInt(contributions)).toString()
  const scale = BigInt(scaleCents)
  return {
    id,
    label,
    contributionsCents: contributions,
    incomeCents: income,
    gapCents: gap,
    readout: capacityReadout(label, contributions, income),
    markerLabel: `Income ${formatCents(income)}`,
    visualCapped: BigInt(contributions) > scale || BigInt(income) > scale,
  }
}

export function projectCapacity(input: {
  agreed: CapacitySide | null
  proposed: CapacitySide | null
  committedScaleCents: string | null
  commitScale: boolean
}): PlanCapacity {
  const sides = [input.agreed, input.proposed].filter((side): side is CapacitySide => side !== null)
  if (sides.length === 0) return { status: "missing", missing: "No plan to compare." }
  const missing = sides.map(missingOf).find((label) => label !== null)
  if (missing) return { status: "missing", missing }
  if (sides.some(pendingOf)) return { status: "pending", scaleCents: input.committedScaleCents }

  const known = sides.flatMap((side) => {
    const contributions = knownCents(side.contributions)
    const income = knownCents(side.income)
    return contributions && income ? [contributions, income] : []
  })
  if (known.length !== sides.length * 2) return { status: "pending", scaleCents: input.committedScaleCents }
  const fresh = scaleFrom(known)
  const scaleCents = !input.commitScale && input.committedScaleCents && isCents(input.committedScaleCents)
    ? input.committedScaleCents
    : fresh
  const rows: CapacityRow[] = []
  if (input.agreed) {
    const agreed = rowFor("agreed", "Agreed", input.agreed, scaleCents)
    if (!agreed) return { status: "pending", scaleCents: input.committedScaleCents }
    rows.push(agreed)
  }
  if (input.proposed) {
    const proposed = rowFor("proposed", "Proposed", input.proposed, scaleCents)
    if (!proposed) return { status: "pending", scaleCents: input.committedScaleCents }
    rows.push(proposed)
  }
  return { status: "ready", scaleCents, rows }
}

export function chartShare(cents: string, scaleCents: string): number {
  if (!isCents(cents) || !isCents(scaleCents)) return 0
  const scale = BigInt(scaleCents)
  if (scale <= BigInt(0)) return 0
  const value = BigInt(cents)
  if (value <= BigInt(0)) return 0
  if (value >= scale) return 1000
  return Number((value * BigInt(1000)) / scale)
}

export function contributionsInput(cents: readonly string[]): MoneyInput {
  if (cents.length === 0) return { status: "missing", label: "No contributions yet." }
  if (cents.some((value) => !isCents(value) || value.startsWith("-"))) return { status: "pending" }
  const total = addCents(cents)
  if (!total) return { status: "pending" }
  return { status: "known", cents: total }
}

export function incomeInput(cents: readonly (string | null)[], named: boolean): MoneyInput {
  if (!named || cents.length === 0) return { status: "missing", label: "Expected income is not known." }
  if (cents.some((value) => value === null || !isCents(value) || value.startsWith("-"))) {
    return { status: "missing", label: "Expected income is incomplete. Unknown income is not treated as zero." }
  }
  const total = addCents(cents.filter((value): value is string => value !== null))
  if (!total) return { status: "missing", label: "Expected income is incomplete. Unknown income is not treated as zero." }
  return { status: "known", cents: total }
}
