import assert from "node:assert/strict"
import test from "node:test"
import type { TransactionFeedItem } from "@/lib/finance/transaction-model"
import { loadAnalysisData } from "./queries"

const item = (id: string): TransactionFeedItem => ({
  id,
  occurredAt: "2026-10-01T00:00:00Z",
  occurredOn: "2026-10-01",
  description: id,
  originalDescription: null,
  amount: "-1",
  currencyCode: "ZAR",
  merchant: { id: null, name: null },
  account: { id: "a", name: "Account", type: null },
  source: {
    system: "test",
    categoryId: null,
    categoryName: null,
    isTransfer: false,
    isPending: false,
    isArchived: false,
    lastSeenAt: null,
  },
  category: {
    id: null,
    name: null,
    provenance: "none",
    state: "unclassified",
    confidence: null,
    proposalDiffersFromSource: false,
  },
  treatment: {
    isTransfer: false,
    excludeFromSpend: false,
    nature: "spend",
    provenance: "none",
    state: "unknown",
  },
  classifier: {
    runId: null,
    classifier: null,
    classifierVersion: null,
    modelId: null,
    completedAt: null,
    confidence: null,
    margin: null,
    topProbability: null,
    accepted: null,
    state: "not_run",
  },
  event: null,
  reviewState: "unclassified",
  revision: {
    confirmedClassificationId: null,
    proposedClassificationId: null,
    confirmedTreatmentId: null,
    proposedTreatmentId: null,
  },
})

test("loads every 100-row page and preserves the date filters", async () => {
  const calls: Array<{
    cursor?: string | null
    limit?: number
    filters?: Record<string, unknown>
  }> = []
  const pages = [
    {
      items: Array.from({ length: 100 }, (_, index) => item(`tx-${index}`)),
      nextCursor: "page-2",
    },
    { items: [item("tx-100")], nextCursor: null },
  ]
  const result = await loadAnalysisData("2026-10-01", "2026-10-31", {
    getTransactionFilters: async () => ({ accounts: [], categories: [] }),
    listTransactions: async (input) => {
      calls.push(input)
      return pages[calls.length - 1]!
    },
  })
  assert.equal(result.transactions.length, 101)
  assert.equal(calls.length, 2)
  assert.equal(calls[0]?.limit, 100)
  assert.deepEqual(calls[1]?.filters, {
    fromDate: "2026-10-01",
    toDate: "2026-10-31",
    archived: false,
  })
})

test("throws when the ledger repeats a cursor", async () => {
  await assert.rejects(
    loadAnalysisData("2026-10-01", "2026-10-31", {
      getTransactionFilters: async () => ({ accounts: [], categories: [] }),
      listTransactions: async () => ({ items: [], nextCursor: "same" }),
    }),
    /repeated cursor/,
  )
})
