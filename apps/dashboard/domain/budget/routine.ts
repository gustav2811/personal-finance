import { copy, reasonSentence } from "./copy"
import { formatDayMonth } from "./cycle"
import type { MemberRef } from "./members"
import { formatCents, isNegativeCents, parseCents } from "./money"
import { projectBudget } from "./overview"
import { oneFormPerSource, projectReviewQueue, type ReviewItem } from "./review"
import { readArray, readComplete, readReasons, readRecord, readString } from "./wire"

export type RoutineNext = "opening" | "decide" | "agree" | "create"

export type RoutineAnswer = {
  amount: string | null
  sentence: string
  detail: string | null
}

export type AttentionItem = {
  id: string
  sentence: string
  amount: string
  when: string | null
}

export type HouseholdRoutine = {
  spend: RoutineAnswer
  cash: RoutineAnswer
  attention: {
    sentence: string
    items: AttentionItem[]
    more: boolean
  }
  agreement: RoutineAnswer
  next: RoutineNext
  stale: string | null
}

const DECIDE_CODES = new Set([
  "review_items_present",
  "allocation_needs_review",
  "source_fingerprint_drift",
  "unallocated_outflow",
  "utilities_unverified",
])

const OPENING_CODES = new Set(["cutover_missing", "resource_balance_unknown"])

function joinNames(names: readonly string[]): string {
  const unique = [...new Set(names)]
  if (unique.length <= 1) return unique[0] ?? ""
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`
}

function joinSentences(sentences: readonly string[]): string | null {
  const unique = [...new Set(sentences.filter((sentence) => sentence.length > 0))]
  return unique.length > 0 ? unique.join(" ") : null
}

function whenLabel(iso: string | null): string | null {
  if (!iso) return null
  try {
    return formatDayMonth(iso)
  } catch {
    return null
  }
}

function availableCents(record: Record<string, unknown>): string | null {
  const restricted = parseCents(record.restricted_cents)
  if (restricted && restricted !== "0") return parseCents(record.liquid_cents)
  return parseCents(record.balance_cents)
}

type SpendLine = {
  name: string
  kind: string | null
  behaviour: string | null
  status: string | null
  available: string | null
}

function spendLines(overview: Record<string, unknown>): SpendLine[] {
  const current = readRecord(overview.current_plan)
  const lines = new Map<string, Record<string, unknown>>()
  for (const entry of readArray(current?.lines)) {
    const record = readRecord(entry)
    const fundId = record ? readString(record, "fund_id") : null
    if (record && fundId) lines.set(fundId, record)
  }
  return readArray(overview.funds).flatMap((entry) => {
    const fund = readRecord(entry)
    const fundId = fund ? readString(fund, "fund_id") : null
    if (!fund || !fundId) return []
    const line = lines.get(fundId)
    return [
      {
        name: (line ? readString(line, "name") : null) ?? readString(fund, "name") ?? "Purpose",
        kind: line ? readString(line, "kind") : null,
        behaviour: line ? readString(line, "funding_behaviour") : null,
        status: readString(fund, "status"),
        available: availableCents(fund),
      },
    ]
  })
}

function reservedSentence(names: readonly string[]): string | null {
  if (names.length === 0) return null
  const joined = joinNames(names)
  return names.length === 1 ? `${joined} stays reserved.` : `${joined} stay reserved.`
}

function absoluteCents(cents: string): string {
  return isNegativeCents(cents) ? cents.slice(1) : cents
}

function shortfallSentence(lines: readonly SpendLine[]): string | null {
  const short = lines.filter((line) => line.available !== null && isNegativeCents(line.available))
  if (short.length === 0) return null
  return short.map((line) => `${line.name} is short by ${formatCents(absoluteCents(line.available ?? "0"))}.`).join(" ")
}

function unassignedDetail(overview: Record<string, unknown>, complete: boolean): string | null {
  if (!complete) return null
  const cents = parseCents(overview.unassigned_cents)
  if (!cents || cents === "0" || isNegativeCents(cents)) return null
  return `${formatCents(cents)} is not claimed by a purpose. That is not spending money until you assign it.`
}

function spendAnswer(overview: Record<string, unknown>, complete: boolean, reasonLabels: readonly string[]): RoutineAnswer {
  if (!complete) {
    const [first, ...rest] = reasonLabels
    return {
      amount: null,
      sentence: `${copy.stillSpendUnknown} ${first ?? copy.somethingUnresolved}`,
      detail: joinSentences(rest),
    }
  }
  const lines = spendLines(overview).filter((line) => line.status !== "retired")
  const everyday = lines.filter((line) => line.kind === "consumption" && line.behaviour === "cycle_allowance")
  const shortNames = new Set(
    lines.flatMap((line) => (line.available !== null && isNegativeCents(line.available) ? [line.name] : [])),
  )
  const reserved = lines.flatMap((line) =>
    line.kind !== "contribution" &&
    line.kind !== "debt_commitment" &&
    line.behaviour &&
    line.behaviour !== "cycle_allowance" &&
    !shortNames.has(line.name)
      ? [line.name]
      : [],
  )
  const commitments = lines.some((line) => line.kind === "contribution" || line.kind === "debt_commitment")
  const reservedText = reservedSentence(reserved)
  const unassigned = unassignedDetail(overview, complete)
  const detail = joinSentences([reservedText ?? "", unassigned ?? ""])
  const shortfall = shortfallSentence(lines)
  if (shortfall) {
    const allowance = everydayAllowance(everyday, commitments)
    return {
      amount: null,
      sentence: allowance ? `${shortfall} ${allowance}` : shortfall,
      detail,
    }
  }
  if (everyday.length === 0) {
    return { amount: null, sentence: "Nothing is set aside as everyday spending.", detail }
  }
  if (everyday.some((line) => line.available === null)) {
    return {
      amount: null,
      sentence: `${copy.stillSpendUnknown} ${copy.somethingUnresolved}`,
      detail,
    }
  }
  const total = everyday.reduce((sum, line) => sum + BigInt(line.available ?? "0"), BigInt(0)).toString()
  if (isNegativeCents(total)) {
    return {
      amount: formatCents(total.slice(1)),
      sentence: "is over what was reserved for everyday spending.",
      detail,
    }
  }
  if (total === "0") {
    return { amount: null, sentence: "Nothing is left for everyday spending this cycle.", detail }
  }
  const after = commitments ? ", after commitments" : ""
  return {
    amount: formatCents(total),
    sentence: `is still for everyday spending this cycle${after}.`,
    detail,
  }
}

function everydayAllowance(everyday: readonly SpendLine[], commitments: boolean): string | null {
  if (everyday.length === 0 || everyday.some((line) => line.available === null)) return null
  const total = everyday.reduce((sum, line) => sum + BigInt(line.available ?? "0"), BigInt(0)).toString()
  if (isNegativeCents(total) || total === "0") return null
  const after = commitments ? ", after commitments" : ""
  return `${formatCents(total)} is still set aside for everyday spending this cycle${after}. That full amount is not spendable until the shortfall is covered.`
}

function cashAnswer(view: ReturnType<typeof projectBudget>): RoutineAnswer {
  const paying = view.cashNeed.needs.filter((need) => need.backing === "paying")
  const short = paying.filter((need) => need.shortfall !== null && need.shortfall !== "R0")
  const shortIds = new Set(short.map((need) => need.id))
  const ordered = [...short, ...paying.filter((need) => !shortIds.has(need.id))]
  const sentence = ordered.length > 0 ? ordered.map((need) => need.sentence).join(" ") : copy.whoNeedsUnknown
  const detail = view.cashNeed.withheld
    ? copy.notInPayingAccount
    : short.length > 0
      ? `${copy.notStatementForecast} ${copy.notInPayingAccount} ${copy.moveCashDetail}`
      : `${copy.notStatementForecast} ${copy.notInPayingAccount}`
  return { amount: null, sentence, detail }
}

function attentionItem(item: ReviewItem): AttentionItem {
  const why = item.reasons.find((reason) => reason.code !== "no_statement_forecast")?.sentence ?? "This needs a decision."
  const paid = item.payerSentence ? ` ${item.payerSentence}.` : ""
  return {
    id: item.reviewKey,
    sentence: `${why}${paid}`,
    amount: item.amount,
    when: whenLabel(item.occurredOn),
  }
}

function attentionAnswer(review: unknown | null, members: readonly MemberRef[]): HouseholdRoutine["attention"] {
  if (review === null) {
    return { sentence: copy.decisionsUnread, items: [], more: false }
  }
  const queue = projectReviewQueue({ queue: review, members })
  const material = oneFormPerSource(queue.items).filter(
    (item) => item.reasons.length === 0 || item.reasons.some((reason) => reason.code !== "no_statement_forecast"),
  )
  const items = material.slice(0, 3).map(attentionItem)
  return {
    sentence: items.length > 0 ? copy.theseChangeAnswers : copy.nothingToDecide,
    items,
    more: material.length > 3 || queue.partial,
  }
}

function nextAction(codes: readonly string[], review: unknown | null, attentionCount: number): RoutineNext {
  if (codes.some((code) => OPENING_CODES.has(code))) return "opening"
  if (codes.includes("plan_missing")) return "create"
  if (review === null || attentionCount > 0 || codes.some((code) => DECIDE_CODES.has(code))) return "decide"
  return "agree"
}

export function routineHref(next: RoutineNext): { href: string; label: string } {
  switch (next) {
    case "opening":
      return { href: "/budget/reconcile", label: copy.agreeOpening }
    case "decide":
      return { href: "/budget/review", label: copy.decide }
    case "create":
      return { href: "/budget/plan?cycle=this", label: copy.createThisCycle }
    case "agree":
      return { href: "/budget/plan?cycle=next", label: copy.reviewNextCycle }
    default: {
      const unreachable: never = next
      return unreachable
    }
  }
}

export function agreementHref(next: RoutineNext): { href: string; label: string } {
  if (next === "create") return routineHref("create")
  return { href: "/budget/plan?cycle=next", label: copy.reviewNextCycle }
}

export function projectRoutine(input: {
  overview: unknown
  actuals: unknown
  liquidity: unknown
  members: readonly MemberRef[]
  review: unknown | null
}): HouseholdRoutine {
  const overview = readRecord(input.overview) ?? {}
  const liquidity = readRecord(input.liquidity) ?? {}
  const complete = readComplete(overview)
  const codes = [...readReasons(overview.reasons), ...readReasons(liquidity.reasons)].map((reason) => reason.code)
  const reasonLabels = [...new Set(codes.map((code) => reasonSentence(code)))]
  const view = projectBudget({ ...input, filter: { kind: "household" } })
  const attention = attentionAnswer(input.review, input.members)
  return {
    spend: spendAnswer(overview, complete, reasonLabels),
    cash: cashAnswer(view),
    attention,
    agreement: codes.includes("plan_missing")
      ? {
          amount: null,
          sentence: "There is no agreed plan for this cycle.",
          detail: "Create this cycle's budget. A later cycle can wait.",
        }
      : {
          amount: null,
          sentence: copy.nextCycleKeeps,
          detail: copy.contributionDoesNotMove,
        },
    next: nextAction(codes, input.review, attention.items.length),
    stale: /stale/i.test(view.freshness) ? copy.balancesMayBeStale : null,
  }
}
