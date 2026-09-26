import type { Json } from "@/lib/supabase/database.types"
import type {
  AccountOption,
  CategoryOption,
  ClassificationRecord,
  ClassifierRunRecord,
  TransactionFeedItem,
  TransactionFilters,
  TransactionInspection,
} from "./model"
import { readTransactionDetail, readTransactionFilters, readTransactionList } from "./rpc"

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null
}

function classifications(value: unknown): ClassificationRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const record = entry as Record<string, unknown>
    const categoryName = text(record.categoryName)
    const decisionSource = text(record.decisionSource)
    const status = text(record.status)
    if (!categoryName || !decisionSource || !status) return []
    return [{ categoryName, confidence: numberOrNull(record.confidence), decisionSource, status }]
  })
}

function runs(value: unknown): ClassifierRunRecord[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return []
    const record = entry as Record<string, unknown>
    const classifier = text(record.classifier)
    const status = text(record.status)
    if (!classifier || !status) return []
    return [
      {
        abstained: record.abstained === true,
        categoryName: text(record.categoryName),
        classifier,
        confidence: numberOrNull(record.confidence),
        status,
      },
    ]
  })
}

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
  const record = data && typeof data === "object" && !Array.isArray(data) ? data : {}
  return {
    items: Array.isArray(record.items) ? (record.items as TransactionFeedItem[]) : [],
    nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null,
  }
}

export async function getTransactionFilters(): Promise<{
  accounts: AccountOption[]
  categories: CategoryOption[]
}> {
  const data = await readTransactionFilters()
  const record = data && typeof data === "object" && !Array.isArray(data) ? data : {}
  return {
    accounts: Array.isArray(record.accounts) ? (record.accounts as AccountOption[]) : [],
    categories: Array.isArray(record.categories) ? (record.categories as CategoryOption[]) : [],
  }
}

export async function getTransaction(transactionId: string): Promise<TransactionInspection> {
  const data = await readTransactionDetail(transactionId)
  const recordRoot = data && typeof data === "object" && !Array.isArray(data) ? data : {}
  const history = recordRoot.history
  const record = history && typeof history === "object" ? (history as Record<string, unknown>) : {}
  return {
    classifications: classifications(record.classifications),
    runs: runs(record.runs),
  }
}
