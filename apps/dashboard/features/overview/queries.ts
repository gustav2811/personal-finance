import { addMonths, currentCycle, dayBefore } from "@/domain/budget/cycle"
import {
  buildOverviewData,
  type BudgetSource,
  type OverviewData,
} from "@/domain/overview/model"
import { demoEnabled } from "@/lib/demo/transactions"
import {
  getTransactionFilters,
  listTransactions,
} from "@/lib/finance/transaction-queries"
import type {
  CategoryOption,
  TransactionFeedItem,
} from "@/lib/finance/transaction-model"
import { getBrowserClient, type BrowserClient } from "@/lib/supabase/browser"
import type { LedgerRead } from "@/lib/supabase/rows"
import { mockOverviewData } from "./mock-data"

export type { OverviewData } from "@/domain/overview/model"

const LEDGER_SELECT =
  "id,device_id,source,utility_type,entry_type,direction,amount,currency,quantity,rate,occurred_at,posted_at,description"
const PAGE_SIZE = 1000
function utcBoundary(date: string): string {
  return new Date(`${date}T00:00:00+02:00`).toISOString()
}
function cycleEnd(start: string): string {
  return addMonths(start, 1)
}
export function budgetAsOf(endExclusive: string, fetchedAt: Date): string {
  const end = new Date(`${endExclusive}T00:00:00+02:00`).getTime() - 1
  return new Date(Math.min(fetchedAt.getTime(), end)).toISOString()
}

export async function readLedger(
  cycleStart: string,
  endExclusive: string,
  client: BrowserClient = getBrowserClient(),
): Promise<LedgerRead[]> {
  const rows: LedgerRead[] = []
  const start = utcBoundary(cycleStart)
  const end = utcBoundary(endExclusive)
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .schema("consumption")
      .from("ledger_entries")
      .select(LEDGER_SELECT)
      .or(
        `and(occurred_at.gte.${start},occurred_at.lt.${end}),and(occurred_at.is.null,posted_at.gte.${start},posted_at.lt.${end})`,
      )
      .order("occurred_at")
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error("Unable to read electricity usage data.")
    const page = (data ?? []) as LedgerRead[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export async function readFinance(
  cycleStart: string,
  endExclusive: string,
): Promise<{
  transactions: TransactionFeedItem[]
  categories: CategoryOption[]
}> {
  const filters = await getTransactionFilters()
  const items = await readFinancePages(async (cursor) =>
    listTransactions({
      cursor,
      limit: 100,
      filters: {
        fromDate: cycleStart,
        toDate: dayBefore(endExclusive),
        archived: false,
      },
    }),
  )
  return { transactions: items, categories: filters.categories }
}

export async function readFinancePages(
  fetchPage: (
    cursor: string | null,
  ) => Promise<{ items: TransactionFeedItem[]; nextCursor: string | null }>,
): Promise<TransactionFeedItem[]> {
  const items: TransactionFeedItem[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  while (true) {
    const page = await fetchPage(cursor)
    items.push(...page.items)
    if (!page.nextCursor) return items
    if (seen.has(page.nextCursor))
      throw new Error("The finance ledger returned a repeated cursor.")
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
}

type ActualsPage = {
  entries: unknown[]
  nextCursor: string | null
  complete: boolean
}
function actualsPage(value: unknown): ActualsPage {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    entries: Array.isArray(record.entries) ? record.entries : [],
    nextCursor:
      typeof record.next_cursor === "string" && record.next_cursor.length > 0
        ? record.next_cursor
        : null,
    complete: record.complete === true,
  }
}

export async function readBudgetActualsPages(
  fetchPage: (cursor: string | null) => Promise<ActualsPage>,
): Promise<{ entries: unknown[]; complete: boolean }> {
  const entries: unknown[] = []
  const seen = new Set<string>()
  let cursor: string | null = null
  let complete = true
  while (true) {
    const page = await fetchPage(cursor)
    entries.push(...page.entries)
    complete = complete && page.complete
    if (!page.nextCursor) return { entries, complete }
    if (seen.has(page.nextCursor))
      throw new Error("The budget actuals returned a repeated cursor.")
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
}

export async function readBudget(
  cycleStart: string,
  endExclusive = cycleEnd(cycleStart),
  fetchedAt = new Date(),
): Promise<BudgetSource> {
  if (cycleStart > currentCycle(fetchedAt).start) return { future: true }
  const client = getBrowserClient()
  const asOf = budgetAsOf(endExclusive, fetchedAt)
  const { data, error } = await client.rpc(
    "budget_get_overview_v1" as never,
    { p_cycle_start: cycleStart, p_as_of: asOf } as never,
  )
  if (error) throw new Error("Unable to read the budget position.")
  const actuals = await readBudgetActualsPages(async (cursor) => {
    const { data: page, error: pageError } = await client.rpc(
      "budget_get_actuals_v1" as never,
      {
        p_filters: { from: cycleStart, to: endExclusive },
        p_cursor: cursor,
        p_limit: 200,
      } as never,
    )
    if (pageError) throw new Error("Unable to read budget actuals.")
    return actualsPage(page)
  })
  const overview =
    data && typeof data === "object" ? (data as BudgetSource) : {}
  return {
    ...overview,
    actuals: actuals.entries,
    actualsComplete: actuals.complete,
  }
}

export type OverviewReaders = {
  finance: (
    cycleStart: string,
    endExclusive: string,
  ) => Promise<{
    transactions: TransactionFeedItem[]
    categories: CategoryOption[]
  }>
  utility: (cycleStart: string, endExclusive: string) => Promise<LedgerRead[]>
  budget: (
    cycleStart: string,
    endExclusive: string,
    fetchedAt: Date,
  ) => Promise<BudgetSource>
}

const defaultReaders: OverviewReaders = {
  finance: readFinance,
  utility: readLedger,
  budget: readBudget,
}

export async function loadOverviewDataWithReaders(
  cycleStart: string,
  readers: OverviewReaders = defaultReaders,
  now = new Date(),
): Promise<OverviewData> {
  const endExclusive = cycleEnd(cycleStart)
  const fetchedAt = now.toISOString()
  const [finance, utility, budget] = await Promise.allSettled([
    readers.finance(cycleStart, endExclusive),
    readers.utility(cycleStart, endExclusive),
    readers.budget(cycleStart, endExclusive, now),
  ])
  const sourceErrors = {
    finance: finance.status === "rejected",
    utility: utility.status === "rejected",
    budget: budget.status === "rejected",
  }
  const financeValue =
    finance.status === "fulfilled"
      ? finance.value
      : { transactions: [], categories: [] }
  const utilityValue = utility.status === "fulfilled" ? utility.value : []
  const budgetValue = budget.status === "fulfilled" ? budget.value : {}
  return buildOverviewData({
    cycleStart,
    transactions: financeValue.transactions,
    categories: financeValue.categories,
    ledgerEntries: utilityValue,
    budget: budgetValue,
    now,
    fetchedAt,
    sourceErrors,
  })
}

export async function loadOverviewData(
  cycleStart = currentCycle().start,
): Promise<OverviewData> {
  if (demoEnabled()) return mockOverviewData(cycleStart)
  return loadOverviewDataWithReaders(cycleStart)
}
export function getOverviewData(cycleStart?: string): Promise<OverviewData> {
  return loadOverviewData(cycleStart)
}
