import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { TransactionFeedItem } from "@/lib/finance/transaction-model"
import type { LedgerRead } from "@/lib/supabase/rows"
import {
  budgetAsOf,
  loadOverviewDataWithReaders,
  readBudgetActualsPages,
  readFinancePages,
  type OverviewReaders,
} from "./queries"

const category = {
  id: "g",
  name: "Groceries",
  slug: "groceries",
  group: null,
  lifecycleStatus: "active",
}
const transaction: TransactionFeedItem = {
  id: "t",
  occurredAt: "2026-10-01T10:00:00Z",
  occurredOn: "2026-10-01",
  description: "Shop",
  originalDescription: null,
  amount: "-100",
  currencyCode: "ZAR",
  merchant: { id: null, name: null },
  account: { id: "a", name: "Card", type: null },
  source: {
    system: "finwise",
    categoryId: null,
    categoryName: null,
    isTransfer: false,
    isPending: false,
    isArchived: false,
    lastSeenAt: null,
  },
  category: {
    id: "g",
    name: "Groceries",
    provenance: "user",
    state: "confirmed",
    confidence: null,
    proposalDiffersFromSource: false,
  },
  treatment: {
    isTransfer: false,
    excludeFromSpend: false,
    nature: "spend",
    provenance: "user",
    state: "confirmed",
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
  reviewState: "confirmed",
  revision: {
    confirmedClassificationId: null,
    proposedClassificationId: null,
    confirmedTreatmentId: null,
    proposedTreatmentId: null,
  },
}
const readers = (
  overrides: Partial<OverviewReaders> = {},
): OverviewReaders => ({
  finance: async () => ({
    transactions: [transaction],
    categories: [category],
  }),
  utility: async () => [],
  budget: async () => ({ complete: true }),
  ...overrides,
})

describe("overview source loading", () => {
  it("reads every page and fails on a repeated cursor", async () => {
    let calls = 0
    const items = await readFinancePages(async (cursor) => {
      calls += 1
      if (calls === 1)
        return {
          items: Array.from({ length: 100 }, () => transaction),
          nextCursor: "next",
        }
      return { items: [transaction], nextCursor: null }
    })
    assert.equal(items.length, 101)
    await assert.rejects(
      () => readFinancePages(async () => ({ items: [], nextCursor: "same" })),
      /repeated cursor/,
    )
  })
  it("reads every actuals page and fails on a repeated cursor", async () => {
    let calls = 0
    const actuals = await readBudgetActualsPages(async () => {
      calls += 1
      return calls === 1
        ? {
            entries: [{ allocation_id: "one" }],
            nextCursor: "next",
            complete: true,
          }
        : {
            entries: [{ allocation_id: "two" }],
            nextCursor: null,
            complete: true,
          }
    })
    assert.equal(actuals.entries.length, 2)
    assert.equal(actuals.complete, true)
    await assert.rejects(
      () =>
        readBudgetActualsPages(async () => ({
          entries: [],
          nextCursor: "same",
          complete: true,
        })),
      /repeated cursor/,
    )
  })
  it("caps historical budget reads at the Johannesburg end-of-period boundary", () => {
    assert.equal(
      budgetAsOf("2026-09-23", new Date("2026-10-15T12:00:00Z")),
      "2026-09-22T21:59:59.999Z",
    )
    assert.equal(
      budgetAsOf("2026-10-23", new Date("2026-10-15T12:00:00Z")),
      "2026-10-15T12:00:00.000Z",
    )
  })
  it("keeps the four finance cards when utility or budget reads fail", async () => {
    const data = await loadOverviewDataWithReaders(
      "2026-09-23",
      readers({
        utility: async () => {
          throw new Error("utility down")
        },
        budget: async () => {
          throw new Error("budget down")
        },
      }),
    )
    assert.equal(data.items.find((item) => item.id === "groceries")?.spent, 100)
    assert.equal(
      data.items.find((item) => item.id === "electricity")?.spent,
      null,
    )
    assert.equal(
      data.items.find((item) => item.id === "groceries")?.budget,
      null,
    )
    assert.equal(
      data.warnings.some((warning) => warning.includes("Budget")),
      true,
    )
  })
  it("keeps electricity when finance reads fail", async () => {
    const data = await loadOverviewDataWithReaders(
      "2026-09-23",
      readers({
        finance: async () => {
          throw new Error("finance down")
        },
        utility: async () => [
          {
            id: "l",
            device_id: "meter",
            source: "ismrt",
            utility_type: "electricity",
            entry_type: "usage_charge",
            direction: "debit",
            amount: 25,
            currency: "ZAR",
            quantity: null,
            rate: null,
            occurred_at: "2026-10-01T22:00:00Z",
            posted_at: null,
            description: null,
          },
        ],
      }),
    )
    assert.equal(
      data.items.find((item) => item.id === "electricity")?.spent,
      25,
    )
    assert.equal(
      data.items.find((item) => item.id === "groceries")?.spent,
      null,
    )
  })
  it("uses one fixed fetch instant for the budget reader and model", async () => {
    const now = new Date("2026-10-15T12:34:56.000Z")
    let captured: {
      cycleStart: string
      endExclusive: string
      fetchedAt: Date
    } | null = null
    const data = await loadOverviewDataWithReaders(
      "2026-09-23",
      readers({
        budget: async (cycleStart, endExclusive, fetchedAt) => {
          captured = { cycleStart, endExclusive, fetchedAt }
          return { complete: true }
        },
      }),
      now,
    )
    assert.deepEqual(captured, {
      cycleStart: "2026-09-23",
      endExclusive: "2026-10-23",
      fetchedAt: now,
    })
    assert.equal(data.fetchedAt, now.toISOString())
  })
})

it("bounds both utility date branches and only falls back when incurred date is missing", async () => {
  const { createClient } = await import("@supabase/supabase-js")
  const { readLedger } = await import("./queries")
  let request: URL | undefined
  const client = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (url) => {
        request = new URL(String(url))
        return Response.json([])
      },
    },
  })
  await readLedger(
    "2026-09-23",
    "2026-10-23",
    client as import("@/lib/supabase/browser").BrowserClient,
  )
  assert.equal(
    request?.searchParams.get("or"),
    "(and(occurred_at.gte.2026-09-22T22:00:00.000Z,occurred_at.lt.2026-10-22T22:00:00.000Z),and(occurred_at.is.null,posted_at.gte.2026-09-22T22:00:00.000Z,posted_at.lt.2026-10-22T22:00:00.000Z))",
  )
})
