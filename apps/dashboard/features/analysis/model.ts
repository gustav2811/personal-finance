import type {
  AccountOption,
  CategoryOption,
  TransactionFeedItem,
} from "@/lib/finance/transaction-model"

export type AnalysisDimension = "category" | "group" | "merchant" | "account"
export type AnalysisMetric = "expensesNet" | "expensesGross" | "income" | "all"
export type AnalysisGranularity = "day" | "week" | "month"

export type AnalysisData = {
  sample?: { fetchedAt: string; from: string; to: string; count: number }
  transactions: TransactionFeedItem[]
  accounts: AccountOption[]
  categories: CategoryOption[]
}

export type AnalysisFilter = {
  categoryIds?: string[]
  groupNames?: string[]
  merchantIds?: string[]
  accountIds?: string[]
  currencyCode?: string
  includeArchived?: boolean
  includePending?: boolean
  includeTransfers?: boolean
  includeExcluded?: boolean
}

export type AnalysisTransaction = TransactionFeedItem & {
  amountMajor: number
  isIncome: boolean
  isExpense: boolean
  isRefund: boolean
  categoryGroup: string | null
}

export type AnalysisSummary = {
  income: number
  expensesGross: number
  expensesNet: number
  net: number
  transactionCount: number
  currencyCode: string | null
}

export type BreakdownRow = {
  key: string
  label: string
  count: number
  income: number
  expensesGross: number
  refunds: number
  expensesNet: number
  net: number
  share: number
}

export type TrendPoint = {
  key: string
  label: string
  income: number
  out: number
  net: number
  count: number
}

export type TableRow = BreakdownRow & {
  periods: Record<string, { income: number; out: number; net: number }>
}

const UNCATEGORISED = "uncategorised"

export function amountMajor(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function enrichTransactions(data: AnalysisData): AnalysisTransaction[] {
  const groups = new Map(
    data.categories.map((category) => [category.id, category.group]),
  )
  return data.transactions.map((transaction) => {
    const amountMajorValue = amountMajor(transaction.amount)
    const isIncome = amountMajorValue > 0
    const isRefund =
      isIncome &&
      ["refund", "card_refund"].includes(
        (transaction.treatment.nature ?? "").trim().toLowerCase(),
      )
    return {
      ...transaction,
      amountMajor: amountMajorValue,
      isIncome,
      isExpense: amountMajorValue < 0,
      isRefund,
      categoryGroup: transaction.category.id
        ? (groups.get(transaction.category.id) ?? null)
        : null,
    }
  })
}

export function filterTransactions(
  transactions: AnalysisTransaction[],
  filter: AnalysisFilter = {},
): AnalysisTransaction[] {
  return transactions.filter((transaction) => {
    if (!filter.includeArchived && transaction.source.isArchived) return false
    if (!filter.includePending && transaction.source.isPending === true)
      return false
    if (
      !filter.includeTransfers &&
      (transaction.treatment.isTransfer === true ||
        (transaction.treatment.isTransfer === null &&
          transaction.source.isTransfer === true))
    )
      return false
    if (
      !filter.includeExcluded &&
      transaction.treatment.excludeFromSpend === true
    )
      return false
    if (filter.currencyCode && transaction.currencyCode !== filter.currencyCode)
      return false
    if (
      filter.categoryIds?.length &&
      !filter.categoryIds.includes(transaction.category.id ?? UNCATEGORISED)
    )
      return false
    if (
      filter.groupNames?.length &&
      !filter.groupNames.includes(transaction.categoryGroup ?? UNCATEGORISED)
    )
      return false
    if (
      filter.merchantIds?.length &&
      !filter.merchantIds.includes(
        transaction.merchant.id ?? transaction.merchant.name ?? "unknown",
      )
    )
      return false
    if (
      filter.accountIds?.length &&
      !filter.accountIds.includes(transaction.account.id)
    )
      return false
    return true
  })
}

export function summaryOf(
  transactions: AnalysisTransaction[],
): AnalysisSummary {
  const income = transactions
    .filter((item) => item.isIncome && !item.isRefund)
    .reduce((sum, item) => sum + item.amountMajor, 0)
  const expensesGross = transactions
    .filter((item) => item.isExpense)
    .reduce((sum, item) => sum + Math.abs(item.amountMajor), 0)
  const refunds = transactions
    .filter((item) => item.isRefund)
    .reduce((sum, item) => sum + item.amountMajor, 0)
  return {
    income,
    expensesGross,
    expensesNet: expensesGross - refunds,
    net: transactions.reduce((sum, item) => sum + item.amountMajor, 0),
    transactionCount: transactions.length,
    currencyCode: transactions[0]?.currencyCode ?? null,
  }
}

export function dimensionOf(
  transaction: AnalysisTransaction,
  dimension: AnalysisDimension,
): { key: string; label: string } {
  if (dimension === "category")
    return {
      key: transaction.category.id ?? UNCATEGORISED,
      label: transaction.category.name ?? "Uncategorised",
    }
  if (dimension === "group")
    return {
      key: transaction.categoryGroup ?? UNCATEGORISED,
      label: transaction.categoryGroup ?? "Uncategorised",
    }
  if (dimension === "merchant")
    return {
      key: transaction.merchant.id ?? transaction.merchant.name ?? "unknown",
      label: transaction.merchant.name ?? "Unknown merchant",
    }
  return { key: transaction.account.id, label: transaction.account.name }
}

export function aggregateBreakdown(
  transactions: AnalysisTransaction[],
  dimension: AnalysisDimension = "category",
): BreakdownRow[] {
  const rows = new Map<string, BreakdownRow>()
  for (const transaction of transactions) {
    const { key, label } = dimensionOf(transaction, dimension)
    const row = rows.get(key) ?? {
      key,
      label,
      count: 0,
      income: 0,
      expensesGross: 0,
      refunds: 0,
      expensesNet: 0,
      net: 0,
      share: 0,
    }
    row.count += 1
    row.net += transaction.amountMajor
    if (transaction.isExpense)
      row.expensesGross += Math.abs(transaction.amountMajor)
    if (transaction.isRefund) row.refunds += transaction.amountMajor
    if (transaction.isIncome && !transaction.isRefund)
      row.income += transaction.amountMajor
    row.expensesNet = row.expensesGross - row.refunds
    rows.set(key, row)
  }
  const result = [...rows.values()].sort(
    (a, b) =>
      b.expensesNet - a.expensesNet ||
      b.income - a.income ||
      a.label.localeCompare(b.label),
  )
  const total = result.reduce((sum, row) => sum + Math.abs(row.expensesNet), 0)
  return result.map((row) => ({
    ...row,
    share: total ? Math.abs(row.expensesNet) / total : 0,
  }))
}

function localDate(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`)
}

export function periodKey(
  value: string,
  granularity: AnalysisGranularity,
): string {
  const date = localDate(value)
  if (granularity === "month") return value.slice(0, 7)
  if (granularity === "day") return value.slice(0, 10)
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() - day + 1)
  return date.toISOString().slice(0, 10)
}

function periodLabel(key: string, granularity: AnalysisGranularity): string {
  if (granularity === "month")
    return new Intl.DateTimeFormat("en-ZA", {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(localDate(`${key}-01`))
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(localDate(key))
}

export function aggregateTrend(
  transactions: AnalysisTransaction[],
  from: string,
  to: string,
  granularity: AnalysisGranularity = "month",
): TrendPoint[] {
  const points = new Map<string, TrendPoint>()
  const start = localDate(from)
  const end = localDate(to)
  if (granularity === "month") start.setUTCDate(1)
  if (granularity === "week") {
    const day = start.getUTCDay() || 7
    start.setUTCDate(start.getUTCDate() - day + 1)
  }
  for (const cursor = new Date(start); cursor <= end;) {
    const key = periodKey(cursor.toISOString(), granularity)
    if (!points.has(key))
      points.set(key, {
        key,
        label: periodLabel(key, granularity),
        income: 0,
        out: 0,
        net: 0,
        count: 0,
      })
    if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1)
    else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7)
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  for (const transaction of transactions) {
    const key = periodKey(transaction.occurredOn, granularity)
    const point = points.get(key) ?? {
      key,
      label: periodLabel(key, granularity),
      income: 0,
      out: 0,
      net: 0,
      count: 0,
    }
    if (transaction.isIncome && !transaction.isRefund)
      point.income += transaction.amountMajor
    if (transaction.isExpense) point.out += Math.abs(transaction.amountMajor)
    if (transaction.isRefund) point.out -= transaction.amountMajor
    point.net += transaction.amountMajor
    point.count += 1
    points.set(key, point)
  }
  return [...points.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export function aggregateTable(
  transactions: AnalysisTransaction[],
  from: string,
  to: string,
  dimension: AnalysisDimension = "category",
  granularity: AnalysisGranularity = "month",
): TableRow[] {
  const periods = aggregateTrend(transactions, from, to, granularity).map(
    (point) => point.key,
  )
  const rows = new Map(
    aggregateBreakdown(transactions, dimension).map((row) => [
      row.key,
      { ...row, periods: {} as TableRow["periods"] },
    ]),
  )
  for (const transaction of transactions) {
    const { key } = dimensionOf(transaction, dimension)
    const period = periodKey(transaction.occurredOn, granularity)
    const row = rows.get(key)
    if (!row) continue
    const cell = row.periods[period] ?? { income: 0, out: 0, net: 0 }
    if (transaction.isIncome && !transaction.isRefund)
      cell.income += transaction.amountMajor
    if (transaction.isExpense) cell.out += Math.abs(transaction.amountMajor)
    if (transaction.isRefund) cell.out -= transaction.amountMajor
    cell.net += transaction.amountMajor
    row.periods[period] = cell
  }
  return [...rows.values()].map((row) => ({
    ...row,
    periods: Object.fromEntries(
      periods.map((period) => [
        period,
        row.periods[period] ?? { income: 0, out: 0, net: 0 },
      ]),
    ),
  }))
}
