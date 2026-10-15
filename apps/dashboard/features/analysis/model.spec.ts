import assert from "node:assert/strict"
import test from "node:test"
import type { TransactionFeedItem } from "@/lib/finance/transaction-model"
import {
  aggregateBreakdown,
  aggregateTable,
  aggregateTrend,
  enrichTransactions,
  filterTransactions,
  periodKey,
  summaryOf,
} from "./model"

function transaction(
  input: Partial<TransactionFeedItem> &
    Pick<TransactionFeedItem, "id" | "amount" | "occurredOn">,
): TransactionFeedItem {
  return {
    occurredAt: `${input.occurredOn}T12:00:00Z`,
    description: input.description ?? input.id,
    originalDescription: null,
    currencyCode: "ZAR",
    merchant: { id: "merchant-1", name: "Shop" },
    account: { id: "account-1", name: "Main", type: null },
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
      id: "food",
      name: "Food",
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
      confirmedClassificationId: "c",
      proposedClassificationId: null,
      confirmedTreatmentId: "t",
      proposedTreatmentId: null,
    },
    ...input,
  }
}

const raw = [
  transaction({ id: "salary", amount: "1000.00", occurredOn: "2026-10-01" }),
  transaction({ id: "shop", amount: "-120.50", occurredOn: "2026-10-03" }),
  transaction({
    id: "refund",
    amount: "20.50",
    occurredOn: "2026-10-04",
    treatment: {
      isTransfer: false,
      excludeFromSpend: false,
      nature: "refund",
      provenance: "user",
      state: "confirmed",
    },
  }),
  transaction({
    id: "pending",
    amount: "-99.00",
    occurredOn: "2026-10-05",
    source: {
      system: "test",
      categoryId: null,
      categoryName: null,
      isTransfer: false,
      isPending: true,
      isArchived: false,
      lastSeenAt: null,
    },
  }),
]

test("amounts remain signed major units and refunds reduce net expense", () => {
  const enriched = enrichTransactions({
    transactions: raw,
    categories: [
      {
        id: "food",
        name: "Food",
        group: "Home",
        slug: "food",
        lifecycleStatus: "active",
      },
    ],
    accounts: [],
  })
  const included = filterTransactions(enriched)
  assert.equal(summaryOf(included).income, 1000)
  assert.equal(summaryOf(included).expensesGross, 120.5)
  assert.equal(summaryOf(included).expensesNet, 100)
  assert.equal(summaryOf(included).net, 900)
  assert.equal(included.length, 3)
})

test("only explicitly marked refunds offset a positive credit", () => {
  const credits = enrichTransactions({
    transactions: [
      transaction({
        id: "income",
        amount: "100",
        occurredOn: "2026-10-01",
        treatment: {
          isTransfer: false,
          excludeFromSpend: false,
          nature: null,
          provenance: "user",
          state: "confirmed",
        },
      }),
      transaction({
        id: "refund",
        amount: "20",
        occurredOn: "2026-10-01",
        treatment: {
          isTransfer: false,
          excludeFromSpend: false,
          nature: "  refund  ",
          provenance: "user",
          state: "confirmed",
        },
      }),
      transaction({
        id: "unknown-credit",
        amount: "10",
        occurredOn: "2026-10-01",
        treatment: {
          isTransfer: false,
          excludeFromSpend: false,
          nature: "rebate",
          provenance: "user",
          state: "confirmed",
        },
      }),
    ],
    categories: [],
    accounts: [],
  })
  const summary = summaryOf(credits)
  assert.equal(summary.income, 110)
  assert.equal(summary.expensesNet, -20)
  assert.equal(summary.net, 130)
})

test("breakdown, trend, and table preserve zero-filled periods", () => {
  const enriched = enrichTransactions({
    transactions: raw.slice(0, 3),
    categories: [
      {
        id: "food",
        name: "Food",
        group: "Home",
        slug: "food",
        lifecycleStatus: "active",
      },
    ],
    accounts: [],
  })
  const breakdown = aggregateBreakdown(enriched)
  assert.equal(breakdown[0]?.label, "Food")
  assert.equal(breakdown[0]?.expensesNet, 100)
  const trend = aggregateTrend(enriched, "2026-10-01", "2026-12-01", "month")
  assert.deepEqual(
    trend.map((point) => point.key),
    ["2026-10", "2026-11", "2026-12"],
  )
  assert.equal(trend[1]?.net, 0)
  const table = aggregateTable(
    enriched,
    "2026-10-01",
    "2026-11-01",
    "category",
    "month",
  )
  assert.deepEqual(table[0]?.periods["2026-11"], { income: 0, out: 0, net: 0 })
})

test("refunds offset trend and table outflow without becoming income", () => {
  const enriched = enrichTransactions({
    transactions: raw.slice(1, 3),
    categories: [
      {
        id: "food",
        name: "Food",
        group: "Home",
        slug: "food",
        lifecycleStatus: "active",
      },
    ],
    accounts: [],
  })
  const trend = aggregateTrend(enriched, "2026-10-01", "2026-10-31", "month")
  assert.equal(trend[0]?.income, 0)
  assert.equal(trend[0]?.out, 100)
  const table = aggregateTable(
    enriched,
    "2026-10-01",
    "2026-10-31",
    "category",
    "month",
  )
  assert.equal(table[0]?.periods["2026-10"]?.out, 100)
})

test("period keys normalize to complete calendar buckets", () => {
  assert.equal(periodKey("2026-01-31", "month"), "2026-01")
  assert.equal(periodKey("2026-01-31", "week"), "2026-01-26")
})

test("filters can include pending transfers and excluded spend explicitly", () => {
  const enriched = enrichTransactions({
    transactions: [
      raw[3]!,
      transaction({
        id: "transfer",
        amount: "-10",
        occurredOn: "2026-10-06",
        treatment: {
          isTransfer: true,
          excludeFromSpend: false,
          nature: "transfer",
          provenance: "user",
          state: "confirmed",
        },
      }),
      transaction({
        id: "excluded",
        amount: "-10",
        occurredOn: "2026-10-06",
        treatment: {
          isTransfer: false,
          excludeFromSpend: true,
          nature: "spend",
          provenance: "user",
          state: "confirmed",
        },
      }),
    ],
    categories: [],
    accounts: [],
  })
  assert.equal(filterTransactions(enriched).length, 0)
  assert.equal(
    filterTransactions(enriched, {
      includePending: true,
      includeTransfers: true,
      includeExcluded: true,
    }).length,
    3,
  )
})

test("confirmed treatment false overrides a stale source transfer flag", () => {
  const sourceTransfer = transaction({
    id: "source-transfer",
    amount: "-10",
    occurredOn: "2026-10-06",
    source: {
      system: "test",
      categoryId: null,
      categoryName: null,
      isTransfer: true,
      isPending: false,
      isArchived: false,
      lastSeenAt: null,
    },
    treatment: {
      isTransfer: false,
      excludeFromSpend: false,
      nature: "spend",
      provenance: "user",
      state: "confirmed",
    },
  })
  assert.equal(
    filterTransactions(
      enrichTransactions({
        transactions: [sourceTransfer],
        categories: [],
        accounts: [],
      }),
    ).length,
    1,
  )
})

test("a partial final week is represented as a zero-filled bucket", () => {
  const enriched = enrichTransactions({
    transactions: [],
    categories: [],
    accounts: [],
  })
  const points = aggregateTrend(enriched, "2026-10-30", "2026-11-02", "week")
  assert.deepEqual(
    points.map((point) => point.key),
    ["2026-10-26", "2026-11-02"],
  )
  assert.equal(points[0]?.out, 0)
  assert.equal(points[1]?.out, 0)
})
