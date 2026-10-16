import { addMonths, dayBefore } from "@/domain/budget/cycle"
import { incurredKey } from "@/domain/consumption/energy-model"
import { localDateKey } from "@/lib/format/date"
import type {
  CategoryOption,
  TransactionFeedItem,
} from "@/lib/finance/transaction-model"
import type { LedgerRead } from "@/lib/supabase/rows"

export const OVERVIEW_IDS = [
  "electricity",
  "groceries",
  "eating-out",
  "fuel",
  "coffee",
] as const
export type OverviewId = (typeof OVERVIEW_IDS)[number]
export type OverviewPoint = {
  date: string
  daily: number | null
  cumulative: number | null
}
export type OverviewItem = {
  id: OverviewId
  label: string
  spent: number | null
  reserved: number
  budget: number | null
  remaining: number | null
  categoryIds: string[]
  points: OverviewPoint[]
  coverageThrough: string | null
  budgetNote: string | null
  dataNote?: string
}
export type OverviewData = {
  cycleStart: string
  endExclusive: string
  fetchedAt: string
  items: OverviewItem[]
  warnings: string[]
  demo?: boolean
}
export type BudgetSource = {
  complete?: boolean
  current_plan?: unknown
  funds?: unknown[]
  reasons?: unknown[]
  actuals?: unknown[]
  actualsComplete?: boolean
  future?: boolean
}

const LABELS: Record<OverviewId, string> = {
  electricity: "Electricity",
  groceries: "Groceries",
  "eating-out": "Eating out",
  fuel: "Fuel",
  coffee: "Coffee",
}
const CATEGORY_NAMES: Record<OverviewId, string[]> = {
  electricity: ["electricity"],
  groceries: ["groceries"],
  "eating-out": ["eating out & takeaways", "eating out", "takeaways"],
  fuel: ["transport & fuel", "fuel"],
  coffee: ["coffee"],
}

type SourceErrors = { finance?: boolean; utility?: boolean; budget?: boolean }
type PlanLine = {
  fundId: string
  name: string
  categoryIds: string[]
  contribution: number | null
}
type Fund = {
  id: string
  name: string
  balance: number | null
  liquid: number | null
  restricted: number
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}
function cents(value: unknown): number | null {
  if (
    typeof value !== "number" &&
    (typeof value !== "string" || !/^-?\d+$/.test(value))
  )
    return null
  const parsed = Number(value)
  if (Number.isSafeInteger(parsed)) return parsed / 100
  return null
}
function normal(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}
function dateKeys(start: string, endExclusive: string): string[] {
  const keys: string[] = []
  for (let cursor = start; cursor < endExclusive;) {
    keys.push(cursor)
    const next = new Date(`${cursor}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    cursor = next.toISOString().slice(0, 10)
  }
  return keys
}
function closedThrough(endExclusive: string, now: Date): string {
  const localToday = localDateKey(now.toISOString())
  const yesterday = new Date(`${localToday}T12:00:00Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const closed = yesterday.toISOString().slice(0, 10)
  return closed < dayBefore(endExclusive) ? closed : dayBefore(endExclusive)
}

export function categoryMatches(
  id: OverviewId,
  category: CategoryOption,
): boolean {
  const name = normal(category.name)
  const slug = normal(category.slug)
  return CATEGORY_NAMES[id].some(
    (candidate) =>
      name === candidate || slug === candidate.replaceAll(" ", "-"),
  )
}

function isRefund(item: TransactionFeedItem): boolean {
  const nature = normal(item.treatment.nature ?? "")
  return nature === "refund" || nature === "card_refund"
}
function includedSpend(item: TransactionFeedItem): number {
  if (
    item.currencyCode !== "ZAR" ||
    item.source.isArchived ||
    item.source.isPending === true ||
    item.treatment.excludeFromSpend === true
  )
    return 0
  if (
    item.treatment.isTransfer !== false &&
    (item.treatment.isTransfer === true || item.source.isTransfer === true)
  )
    return 0
  const amount = Number(item.amount)
  if (!Number.isFinite(amount)) return 0
  if (amount < 0) return -amount
  return isRefund(item) ? -amount : 0
}
function includedReservation(item: TransactionFeedItem): number {
  if (
    item.currencyCode !== "ZAR" ||
    item.source.isPending !== true ||
    item.source.isArchived ||
    item.treatment.excludeFromSpend === true ||
    item.treatment.isTransfer === true ||
    item.source.isTransfer === true
  ) return 0
  const amount = Number(item.amount)
  return Number.isFinite(amount) && amount < 0 ? -amount : 0
}
export function transactionCategorySpend(
  items: TransactionFeedItem[],
  categoryIds: readonly string[],
  start: string,
  endExclusive: string,
  through = dayBefore(endExclusive),
): Map<string, number> {
  const ids = new Set(categoryIds),
    result = new Map<string, number>()
  for (const item of items) {
    if (
      !ids.has(item.category.id ?? "") ||
      item.occurredOn < start ||
      item.occurredOn >= endExclusive ||
      item.occurredOn > through
    )
      continue
    const amount = includedSpend(item)
    result.set(item.occurredOn, (result.get(item.occurredOn) ?? 0) + amount)
  }
  return result
}
function transactionCategoryReservations(
  items: TransactionFeedItem[],
  categoryIds: readonly string[],
  start: string,
  endExclusive: string,
  through = dayBefore(endExclusive),
): number {
  const ids = new Set(categoryIds)
  return items.reduce((sum, item) => {
    if (
      !ids.has(item.category.id ?? "") ||
      item.occurredOn < start || item.occurredOn >= endExclusive ||
      item.occurredOn > through
    ) return sum
    return sum + includedReservation(item)
  }, 0)
}

function planLines(source: BudgetSource): PlanLine[] {
  const lines = Array.isArray(record(source.current_plan).lines)
    ? (record(source.current_plan).lines as unknown[])
    : []
  return lines.flatMap((entry) => {
    const row = record(entry),
      fundId = text(row.fund_id)
    if (!fundId) return []
    return [
      {
        fundId,
        name: text(row.name) ?? "",
        contribution: cents(row.contribution_cents),
        categoryIds: [
          text(row.category_id),
          text(row.match_category_id),
        ].filter((value): value is string => Boolean(value)),
      },
    ]
  })
}
function funds(source: BudgetSource): Fund[] {
  return (Array.isArray(source.funds) ? source.funds : []).flatMap((entry) => {
    const row = record(entry),
      id = text(row.fund_id)
    if (!id) return []
    const restricted = cents(row.restricted_cents) ?? 0
    return [
      {
        id,
        name: text(row.name) ?? "",
        balance: cents(row.balance_cents),
        liquid: cents(row.liquid_cents),
        restricted,
      },
    ]
  })
}
function sameCategoryLine(
  line: PlanLine,
  id: OverviewId,
  categoryIds: string[],
): boolean {
  if (line.categoryIds.length > 0)
    return line.categoryIds.every((categoryId) =>
      categoryIds.includes(categoryId),
    )
  const name = normal(line.name)
  return name === normal(LABELS[id]) || CATEGORY_NAMES[id].includes(name)
}
function budgetFor(
  id: OverviewId,
  categoryIds: string[],
  spent: number | null,
  reserved: number,
  source: BudgetSource,
): Pick<OverviewItem, "budget" | "remaining" | "budgetNote"> {
  if (source.future)
    return {
      budget: null,
      remaining: null,
      budgetNote: "Budget position is unavailable for a future period",
    }
  const lines = planLines(source),
    allFunds = funds(source)
  if (id === "electricity") {
    const utilityFundIds = new Set(
      allFunds
        .filter((fund) => normal(fund.name) === "water & electricity")
        .map((fund) => fund.id),
    )
    const explicitElectricityLine = lines.some(
      (line) =>
        utilityFundIds.has(line.fundId) &&
        line.categoryIds.some((categoryId) => categoryIds.includes(categoryId)),
    )
    if (utilityFundIds.size > 0 && !explicitElectricityLine)
      return {
        budget: null,
        remaining: null,
        budgetNote: "Electricity shares a utilities budget",
      }
  }
  const candidates = lines.filter((line) =>
    sameCategoryLine(line, id, categoryIds),
  )
  const fundIds = [...new Set(candidates.map((line) => line.fundId))]
  if (fundIds.length !== 1)
    return {
      budget: null,
      remaining: null,
      budgetNote:
        fundIds.length > 1
          ? "Multiple categories share this budget"
          : "No category budget linked",
    }
  const fundId = fundIds[0]
  const related = lines.filter((line) => line.fundId === fundId)
  if (related.some((line) => !sameCategoryLine(line, id, categoryIds)))
    return {
      budget: null,
      remaining: null,
      budgetNote: "Multiple categories share this budget",
    }
  const allowanceLines = candidates.filter((line) => line.fundId === fundId)
  const budgetCents = allowanceLines.reduce(
    (sum, line) => sum + (line.contribution ?? 0),
    0,
  )
  if (spent === null || allowanceLines.some((line) => line.contribution === null))
    return {
      budget: null,
      remaining: null,
      budgetNote: "Budget allowance is unavailable",
    }
  // The Overview answers a plan question: how much of this cycle's allowance
  // has been used? Reconciliation and fund cash balances are shown on Budget;
  // they must not hide a known allowance from this spending view.
  const budget = budgetCents
  return {
    budget: budget > 0 ? budget : null,
    remaining: budget > 0 ? budget - spent - reserved : null,
    budgetNote: budget > 0 ? null : "No category budget linked",
  }
}

export function buildOverviewData(input: {
  cycleStart: string
  transactions: TransactionFeedItem[]
  categories: CategoryOption[]
  ledgerEntries: LedgerRead[]
  budget: BudgetSource
  now?: Date
  fetchedAt?: string
  sourceErrors?: SourceErrors
}): OverviewData {
  const endExclusive = addMonths(input.cycleStart, 1)
  const through = closedThrough(endExclusive, input.now ?? new Date())
  const today = localDateKey((input.now ?? new Date()).toISOString())
  const financeThrough =
    today < dayBefore(endExclusive) ? today : dayBefore(endExclusive)
  const days = dateKeys(input.cycleStart, endExclusive)
  const warnings: string[] = []
  const result: OverviewItem[] = []
  for (const id of OVERVIEW_IDS) {
    const utility = id === "electricity"
    const unavailable = utility
      ? input.sourceErrors?.utility
      : input.sourceErrors?.finance
    const categoryIds = input.categories
      .filter((category) => categoryMatches(id, category))
      .map((category) => category.id)
    let daily = new Map<string, number>()
    let coverageThrough: string | null = null
    let spent: number | null = unavailable ? null : 0
    if (utility && !unavailable) {
      const usage = input.ledgerEntries.filter(
        (entry) =>
          entry.utility_type === "electricity" &&
          entry.entry_type === "usage_charge" &&
          entry.direction === "debit" &&
          entry.currency === "ZAR",
      )
      for (const entry of usage) {
        const date = incurredKey(entry)
        if (
          date &&
          date >= input.cycleStart &&
          date <= through &&
          Number.isFinite(entry.amount)
        )
          daily.set(date, (daily.get(date) ?? 0) + entry.amount)
      }
      const dates = [...daily.keys()].sort()
      coverageThrough = dates.at(-1) ?? null
      spent = dates.length
        ? [...daily.values()].reduce((sum, amount) => sum + amount, 0)
        : null
    } else if (!utility && !unavailable) {
      daily = transactionCategorySpend(
        input.transactions,
        categoryIds,
        input.cycleStart,
        endExclusive,
        financeThrough,
      )
      spent = categoryIds.length
        ? [...daily.values()].reduce((sum, amount) => sum + amount, 0)
        : null
      coverageThrough =
        spent === null || financeThrough < input.cycleStart
          ? null
          : financeThrough
    }
    if (unavailable)
      warnings.push(`${LABELS[id]} data is unavailable for this period`)
    let cumulative: number | null = 0
    const points = days.map((date) => {
      const future = date > (utility ? through : financeThrough)
      const gap = utility && !daily.has(date)
      const value =
        future || gap || unavailable || spent === null
          ? null
          : (daily.get(date) ?? 0)
      if (value === null) cumulative = null
      else if (cumulative !== null) cumulative += value
      return {
        date,
        daily: value,
        cumulative: value === null ? null : cumulative,
      }
    })
    const reserved = transactionCategoryReservations(
      input.transactions,
      categoryIds,
      input.cycleStart,
      endExclusive,
      financeThrough,
    )
    const budget = input.sourceErrors?.budget
      ? {
          budget: null,
          remaining: null,
          budgetNote: "Budget position is unavailable",
        }
      : budgetFor(id, categoryIds, spent, reserved, input.budget)
    if (spent === null && !unavailable)
      warnings.push(`${LABELS[id]} data is unavailable for this period`)
    const missingDays =
      utility && !unavailable && spent !== null
        ? days.filter((date) => date <= through && !daily.has(date)).length
        : 0
    const dataNote = missingDays
      ? `${missingDays} usage ${missingDays === 1 ? "day" : "days"} missing · known charges only`
      : undefined
    if (dataNote)
      warnings.push(
        `Electricity: ${dataNote}. Cumulative totals are withheld after a gap.`,
      )
    result.push({
      id,
      label: LABELS[id],
      spent,
      reserved,
      categoryIds,
      points,
      coverageThrough,
      dataNote,
      ...budget,
    })
  }
  if (input.sourceErrors?.budget)
    warnings.push("Budget positions are unavailable for this period")
  return {
    cycleStart: input.cycleStart,
    endExclusive,
    fetchedAt: input.fetchedAt ?? new Date().toISOString(),
    items: result,
    warnings,
  }
}
