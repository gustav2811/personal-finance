import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { TransactionFeedItem } from "@/lib/finance/transaction-model"
import type { LedgerRead } from "@/lib/supabase/rows"
import {
  buildOverviewData,
  categoryMatches,
  transactionCategorySpend,
} from "./model"

const category = (id: string, name: string, slug = name.toLowerCase()) => ({
  id,
  name,
  slug,
  group: null,
  lifecycleStatus: "active",
})
const transaction = (
  overrides: Partial<TransactionFeedItem> = {},
): TransactionFeedItem => ({
  id: "t",
  occurredAt: "2026-10-01T10:00:00Z",
  occurredOn: "2026-10-01",
  description: "Purchase",
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
    id: "groceries",
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
  ...overrides,
})
const ledger = (overrides: Partial<LedgerRead> = {}): LedgerRead => ({
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
  posted_at: "2026-10-02T01:00:00Z",
  description: null,
  ...overrides,
})

describe("overview model", () => {
  it("matches canonical names without guessing from merchants", () => {
    assert.equal(
      categoryMatches(
        "eating-out",
        category("e", "Eating Out & Takeaways", "eating-out-takeaways"),
      ),
      true,
    )
    assert.equal(
      categoryMatches("fuel", category("f", "Transport & Fuel")),
      true,
    )
    assert.equal(categoryMatches("coffee", category("c", "Coffee")), true)
  })
  it("nets explicit refunds but ignores pending, transfers, and excluded rows", () => {
    const result = transactionCategorySpend(
      [
        transaction(),
        transaction({
          id: "refund",
          amount: "20",
          treatment: { ...transaction().treatment, nature: "refund" },
        }),
        transaction({
          id: "pending",
          source: { ...transaction().source, isPending: true },
        }),
        transaction({
          id: "transfer",
          source: { ...transaction().source, isTransfer: true },
          treatment: { ...transaction().treatment, isTransfer: true },
        }),
        transaction({
          id: "excluded",
          treatment: { ...transaction().treatment, excludeFromSpend: true },
        }),
      ],
      ["groceries"],
      "2026-09-23",
      "2026-10-23",
    )
    assert.equal(result.get("2026-10-01"), 80)
  })
  it("keeps utility gaps null and excludes deposits, fees, future, and other currencies", () => {
    const data = buildOverviewData({
      cycleStart: "2026-09-23",
      now: new Date("2026-10-10T12:00:00Z"),
      categories: [category("groceries", "Groceries")],
      transactions: [transaction()],
      ledgerEntries: [
        ledger({ occurred_at: "2026-10-01T22:00:00Z", amount: 25 }),
        ledger({
          id: "deposit",
          entry_type: "deposit",
          direction: "credit",
          amount: 900,
        }),
        ledger({ id: "fee", entry_type: "fee", amount: 4 }),
        ledger({
          id: "future",
          occurred_at: "2026-10-12T22:00:00Z",
          amount: 30,
        }),
        ledger({ id: "usd", currency: "USD", amount: 50 }),
      ],
      budget: { complete: false },
    })
    const electricity = data.items.find((item) => item.id === "electricity")!
    assert.equal(electricity.spent, 25)
    assert.equal(
      electricity.points.find((point) => point.date === "2026-10-03")?.daily,
      null,
    )
    assert.equal(electricity.coverageThrough, "2026-10-02")
    assert.equal(
      data.items.find((item) => item.id === "groceries")?.budget,
      null,
    )
  })
  it("does not attribute a shared utilities fund to electricity", () => {
    const data = buildOverviewData({
      cycleStart: "2026-09-23",
      now: new Date("2026-10-10T12:00:00Z"),
      categories: [],
      transactions: [],
      ledgerEntries: [ledger()],
      budget: {
        complete: true,
        current_plan: {
          lines: [{ fund_id: "u", name: "Water & Electricity" }],
        },
        funds: [
          {
            fund_id: "u",
            name: "Water & Electricity",
            balance_cents: "10000",
            liquid_cents: "10000",
            restricted_cents: "0",
          },
        ],
      },
    })
    const electricity = data.items.find((item) => item.id === "electricity")!
    assert.equal(electricity.budget, null)
    assert.equal(
      electricity.budgetNote,
      "Electricity shares a utilities budget",
    )
  })
  it("lets explicit treatment override source transfer and recognises card refunds and archived rows", () => {
    const result = transactionCategorySpend(
      [
        transaction({
          id: "override",
          source: { ...transaction().source, isTransfer: true },
          treatment: { ...transaction().treatment, isTransfer: false },
        }),
        transaction({
          id: "refund",
          amount: "20",
          treatment: { ...transaction().treatment, nature: "card_refund" },
        }),
        transaction({
          id: "archived",
          amount: "-500",
          source: { ...transaction().source, isArchived: true },
        }),
      ],
      ["groceries"],
      "2026-09-23",
      "2026-10-23",
    )
    assert.equal(result.get("2026-10-01"), 80)
  })
})

it("uses the full budget cycle, includes today's spending, and leaves future/missing categories unknown", () => {
  const input = {
    cycleStart: "2026-09-23",
    now: new Date("2026-10-15T12:00:00Z"),
    categories: [category("groceries", "Groceries")],
    transactions: [
      transaction({ occurredOn: "2026-09-22", amount: "-500" }),
      transaction({ occurredOn: "2026-09-23", amount: "-10" }),
      transaction({ occurredOn: "2026-10-15", amount: "-20" }),
      transaction({ occurredOn: "2026-10-16", amount: "-300" }),
    ],
    ledgerEntries: [],
    budget: {},
  }
  const data = buildOverviewData(input)
  const groceries = data.items.find((item) => item.id === "groceries")!
  assert.equal(groceries.spent, 30)
  assert.equal(groceries.points[0].date, "2026-09-23")
  assert.equal(groceries.points.at(-1)?.date, "2026-10-22")
  assert.equal(
    groceries.points.find((point) => point.date === "2026-10-16")?.daily,
    null,
  )
  assert.equal(
    data.items
      .find((item) => item.id === "coffee")
      ?.points.every((point) => point.daily === null),
    true,
  )
})

it("shows planned allowance and reserves pending charges while reconciliation is incomplete", () => {
  const input = {
    cycleStart: "2026-09-23",
    now: new Date("2026-10-15T12:00:00Z"),
    categories: [category("groceries", "Groceries")],
    transactions: [
      transaction(),
      transaction({
        id: "pending",
        amount: "-25",
        source: { ...transaction().source, isPending: true },
      }),
    ],
    ledgerEntries: [],
  }
  const budget = {
    complete: false,
    actualsComplete: true,
    actuals: [
      {
        fund_id: "g",
        category_id: "groceries",
        effect_kind: "consumption",
        signed_amount_cents: "-10000",
      },
    ],
    current_plan: {
      lines: [{ fund_id: "g", name: "Groceries", category_id: "groceries", contribution_cents: "30000" }],
    },
    funds: [
      {
        fund_id: "g",
        balance_cents: "90000",
        liquid_cents: "20000",
        restricted_cents: "70000",
        outflow_cents: "910000",
        refund_cents: "0",
      },
    ],
  }
  let groceries = buildOverviewData({ ...input, budget }).items.find(
    (item) => item.id === "groceries",
  )!
  assert.equal(groceries.reserved, 25)
  assert.equal(groceries.remaining, 175)
  assert.equal(groceries.budget, 300)
  groceries = buildOverviewData({
    ...input,
    budget: {
      ...budget,
      current_plan: {
        lines: [
          ...budget.current_plan.lines,
          { fund_id: "g", name: "Coffee", category_id: "coffee" },
        ],
      },
    },
  }).items.find((item) => item.id === "groceries")!
  assert.equal(groceries.remaining, null)
  groceries = buildOverviewData({
    ...input,
    budget: {
      ...budget,
      actuals: [
        {
          fund_id: "g",
          category_id: "coffee",
          effect_kind: "consumption",
          signed_amount_cents: "-10000",
        },
      ],
    },
  }).items.find((item) => item.id === "groceries")!
  assert.equal(groceries.budget, 300)
})

it("reconciles signed refunds inside the selected budget period", () => {
  const input = {
    cycleStart: "2026-09-23",
    now: new Date("2026-10-15T12:00:00Z"),
    categories: [category("groceries", "Groceries")],
    transactions: [
      transaction({ amount: "-100" }),
      transaction({
        id: "refund",
        amount: "20",
        treatment: { ...transaction().treatment, nature: "refund" },
      }),
    ],
    ledgerEntries: [],
  }
  const budget = {
    complete: true,
    actualsComplete: true,
    actuals: [
      {
        fund_id: "g",
        category_id: "groceries",
        effect_kind: "consumption",
        signed_amount_cents: "-10000",
      },
      {
        fund_id: "g",
        category_id: "groceries",
        effect_kind: "refund",
        signed_amount_cents: "2000",
      },
    ],
    current_plan: {
      lines: [{ fund_id: "g", name: "Groceries", category_id: "groceries", contribution_cents: "20000" }],
    },
    funds: [
      {
        fund_id: "g",
        balance_cents: "12000",
        liquid_cents: "12000",
        restricted_cents: "0",
      },
    ],
  }
  const groceries = buildOverviewData({ ...input, budget }).items.find(
    (item) => item.id === "groceries",
  )!
  assert.equal(groceries.spent, 80)
  assert.equal(groceries.budget, 200)
})

it("withholds future-period funding rather than showing today’s balance", () => {
  const data = buildOverviewData({
    cycleStart: "2026-10-23",
    now: new Date("2026-10-15T12:00:00Z"),
    categories: [category("groceries", "Groceries")],
    transactions: [],
    ledgerEntries: [],
    budget: { future: true },
  })
  const groceries = data.items.find((item) => item.id === "groceries")!
  assert.equal(groceries.remaining, null)
  assert.equal(
    groceries.budgetNote,
    "Budget position is unavailable for a future period",
  )
})

it("uses the shared utility date fallback without moving known incurred charges", () => {
  const data = buildOverviewData({
    cycleStart: "2026-09-23",
    now: new Date("2026-10-15T12:00:00Z"),
    categories: [],
    transactions: [],
    budget: {},
    ledgerEntries: [
      ledger({
        occurred_at: null,
        posted_at: "2026-09-23T00:00:00+02:00",
        amount: 30,
      }),
      ledger({
        occurred_at: "2026-09-22T12:00:00+02:00",
        posted_at: "2026-09-23T12:00:00+02:00",
        amount: 500,
      }),
      ledger({
        occurred_at: null,
        posted_at: "2026-10-23T00:00:00+02:00",
        amount: 700,
      }),
    ],
  })
  const electricity = data.items.find((item) => item.id === "electricity")!
  assert.equal(electricity.spent, 30)
  assert.equal(electricity.points[0].daily, 30)
})
