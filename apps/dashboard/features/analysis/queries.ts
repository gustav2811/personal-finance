import {
  getTransactionFilters,
  listTransactions,
} from "@/lib/finance/transaction-queries"
import type { TransactionFilters } from "@/lib/finance/transaction-model"
import type { AnalysisData } from "./model"
import { demoEnabled } from "@/lib/demo/transactions"

export type AnalysisReaders = {
  listTransactions?: typeof listTransactions
  getTransactionFilters?: typeof getTransactionFilters
}

/** Load the complete transaction window. The RPC caps each page at 100 rows. */
export async function loadAnalysisData(
  from: string,
  to: string,
  readers: AnalysisReaders = {},
): Promise<AnalysisData> {
  // The snapshot stays server-side and is available only in local demo mode.
  // Injected readers keep tests deterministic and always use the RPC path below.
  if (demoEnabled() && !Object.keys(readers).length) {
    const response = await fetch(
      `/api/dev/analysis-sample?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { cache: "no-store" },
    )
    if (response.ok) return response.json() as Promise<AnalysisData>
    if (response.status !== 404)
      throw new Error("The local analysis snapshot could not be read.")
  }
  const filters: TransactionFilters = {
    fromDate: from,
    toDate: to,
    archived: false,
  }
  const readList = readers.listTransactions ?? listTransactions
  const readFilters = readers.getTransactionFilters ?? getTransactionFilters
  const [options, first] = await Promise.all([
    readFilters(),
    readList({ limit: 100, filters }),
  ])
  const transactions = [...first.items]
  const seenCursors = new Set<string>()
  let cursor = first.nextCursor
  while (cursor) {
    if (seenCursors.has(cursor))
      throw new Error("The transaction ledger returned a repeated cursor.")
    seenCursors.add(cursor)
    const page = await readList({ limit: 100, cursor, filters })
    transactions.push(...page.items)
    cursor = page.nextCursor
  }
  return {
    transactions,
    accounts: options.accounts,
    categories: options.categories,
  }
}
