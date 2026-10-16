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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function publishedVersionForCycle(
  versions: unknown[],
  cycleStart: string,
): Record<string, unknown> | null {
  const eligible = versions
    .map(record)
    .filter(
      (version) =>
        version.state === "published" &&
        typeof version.version_id === "string" &&
        typeof version.starts_on_cycle === "string" &&
        version.starts_on_cycle <= cycleStart,
    )
  eligible.sort((a, b) => {
    const startOrder = String(b.starts_on_cycle).localeCompare(
      String(a.starts_on_cycle),
    )
    if (startOrder !== 0) return startOrder
    return String(b.published_at ?? "").localeCompare(
      String(a.published_at ?? ""),
    )
  })
  return eligible[0] ?? null
}

export async function readBudget(
  cycleStart: string,
  _endExclusive = cycleEnd(cycleStart),
  fetchedAt = new Date(),
): Promise<BudgetSource> {
  if (cycleStart > currentCycle(fetchedAt).start) return { future: true }
  const client = getBrowserClient()
  const { data: versionList, error: listError } = await client.rpc(
    "budget_list_versions_v1" as never,
    { p_cursor: null, p_limit: 200 } as never,
  )
  if (listError) throw new Error("Unable to read published budget plans.")
  const versionListRecord = record(versionList)
  const version = publishedVersionForCycle(
    Array.isArray(versionListRecord.versions) ? versionListRecord.versions : [],
    cycleStart,
  )
  if (!version)
    throw new Error("No published budget plan applies to this period.")
  const { data, error } = await client.rpc(
    "budget_get_version_v1" as never,
    { p_version_id: version.version_id } as never,
  )
  if (error) throw new Error("Unable to read the published budget plan.")
  const plan = record(record(data).version)
  const lines = Array.isArray(plan.lines) ? plan.lines : []
  const funds = new Map<string, { fund_id: string; name: string }>()
  for (const value of lines) {
    const line = record(value)
    if (typeof line.fund_id === "string")
      funds.set(line.fund_id, {
        fund_id: line.fund_id,
        name: typeof line.name === "string" ? line.name : "",
      })
  }
  return {
    current_plan: plan,
    funds: [...funds.values()],
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
