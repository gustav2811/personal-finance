import type { Json } from "@/lib/supabase/database.types"
import type {
  AccountOption,
  CategoryOption,
  TransactionFeedItem,
  TransactionFilters,
} from "./transaction-model"
import { readTransactionFilters, readTransactionList } from "./transaction-read"

export async function listTransactions(input: {
  cursor?: string | null
  limit?: number
  filters?: TransactionFilters
}): Promise<{ items: TransactionFeedItem[]; nextCursor: string | null }> {
  const data = await readTransactionList({
    p_cursor: input.cursor ?? undefined,
    p_filters: (input.filters ?? {}) as Json,
    p_limit: input.limit ?? 50,
  })
  const record =
    data && typeof data === "object" && !Array.isArray(data) ? data : {}
  return {
    items: Array.isArray(record.items)
      ? (record.items as TransactionFeedItem[])
      : [],
    nextCursor:
      typeof record.nextCursor === "string" ? record.nextCursor : null,
  }
}

export async function getTransactionFilters(): Promise<{
  accounts: AccountOption[]
  categories: CategoryOption[]
}> {
  const data = await readTransactionFilters()
  const record =
    data && typeof data === "object" && !Array.isArray(data) ? data : {}
  return {
    accounts: Array.isArray(record.accounts)
      ? (record.accounts as AccountOption[])
      : [],
    categories: Array.isArray(record.categories)
      ? (record.categories as CategoryOption[])
      : [],
  }
}
