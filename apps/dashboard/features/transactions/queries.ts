import type {
  ClassificationRecord,
  ClassifierRunRecord,
  TransactionInspection,
} from "./model"
import { readTransactionDetail } from "./rpc"
export { getTransactionFilters, listTransactions } from "@/lib/finance/transaction-queries"

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
