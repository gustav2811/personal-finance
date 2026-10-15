import "./view-test-dom"
import assert from "node:assert/strict"
import { test } from "node:test"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { AnalysisView } from "./analysis-view"
import { AnalysisBars } from "@/domain/analysis/charts"
import type { AnalysisData } from "./model"
import type { TransactionFeedItem } from "@/lib/finance/transaction-model"

const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Johannesburg",
})
  .format(new Date())
  .slice(0, 7)
function transaction(index: number): TransactionFeedItem {
  return {
    id: `tx-${index}`,
    occurredAt: `${month}-05T12:00:00Z`,
    occurredOn: `${month}-05`,
    description: `Purchase ${index}`,
    originalDescription: null,
    amount: String(-100 + index * 5),
    currencyCode: "ZAR",
    merchant: { id: `m-${index}`, name: `Merchant ${index}` },
    account: { id: "main", name: "Main", type: "checking" },
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
      id: `c-${index}`,
      name: `Category ${index}`,
      provenance: "user",
      state: "confirmed",
      confidence: null,
      proposalDiffersFromSource: false,
    },
    treatment: {
      isTransfer: index === 10,
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
}

test("data leads while refinements stay functional and Other opens its exact transactions", async () => {
  const originalFetch = globalThis.fetch
  const nodeEnv = process.env.NODE_ENV,
    demo = process.env.DASHBOARD_DEMO_MODE
  const data: AnalysisData = {
    transactions: Array.from({ length: 11 }, (_, i) => transaction(i)),
    accounts: [
      { id: "main", name: "Main", type: "checking", lifecycleStatus: "active" },
    ],
    categories: Array.from({ length: 11 }, (_, i) => ({
      id: `c-${i}`,
      name: `Category ${i}`,
      group: "Living",
      slug: `c-${i}`,
      lifecycleStatus: "active",
    })),
  }
  try {
    Object.assign(process.env, {
      NODE_ENV: "development",
      DASHBOARD_DEMO_MODE: "true",
    })
    globalThis.fetch = async () => Response.json(data)
    render(<AnalysisView />)
    const other = (await screen.findByText("Other (3)")).closest("button")!
    assert.equal(screen.queryByRole("combobox", { name: "Group by" }), null)
    assert.equal(
      screen.queryByRole("button", { name: "Export transactions" }),
      null,
    )
    assert.equal(screen.queryByRole("button", { name: "From" }), null)
    fireEvent.click(other)
    const dialog = screen.getByRole("dialog")
    assert.equal(within(dialog).getAllByRole("row").length, 4)
    fireEvent.change(
      within(dialog).getByRole("textbox", { name: "Search transactions" }),
      { target: { value: "Merchant 9" } },
    )
    assert.equal(within(dialog).getAllByRole("row").length, 2)
    fireEvent.click(within(dialog).getByRole("button", { name: "Review Merchant 9" }))
    assert.ok(await screen.findByRole("button", { name: "Close transaction review" }))
    assert.ok(screen.getByRole("textbox", { name: "Description" }))
    fireEvent.click(screen.getByRole("button", { name: "Close transaction review" }))
    await screen.findByRole("textbox", { name: "Search transactions" })
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }))
    fireEvent.click(screen.getByRole("radio", { name: "Cash flow" }))
    fireEvent.click(screen.getByRole("button", { name: /^Other \(3\):/ }))
    assert.equal(
      within(screen.getByRole("dialog")).getAllByRole("row").length,
      4,
    )
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    )
    fireEvent.click(screen.getByRole("button", { name: "Refine" }))
    assert.equal(
      screen
        .getByRole("button", { name: "Refine" })
        .getAttribute("aria-expanded"),
      "true",
    )
    assert.ok(screen.getByRole("combobox", { name: "Group by" }))
    assert.ok(screen.getByRole("button", { name: "Export transactions" }))
    fireEvent.click(screen.getByRole("checkbox", { name: "Include transfers" }))
    assert.ok(screen.getByText(/^11 transactions/))
    fireEvent.click(screen.getByRole("button", { name: "Refine · 1" }))
    assert.equal(screen.queryByRole("combobox", { name: "Group by" }), null)
    fireEvent.click(
      screen.getByRole("button", { name: "Choose analysis dates" }),
    )
    assert.ok(screen.getByRole("button", { name: "3 months" }))
  } finally {
    cleanup()
    globalThis.fetch = originalFetch
    if (nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV")
    else Object.assign(process.env, { NODE_ENV: nodeEnv })
    if (demo === undefined) delete process.env.DASHBOARD_DEMO_MODE
    else process.env.DASHBOARD_DEMO_MODE = demo
  }
})

test("both trend series open the exact period with pointer and keyboard", async () => {
  const selected: string[] = []
  try {
    render(
      <AnalysisBars
        points={[
          { key: "2026-09", label: "September", income: 100, expenses: 40 },
          { key: "2026-10", label: "October", income: 200, expenses: 80 },
        ]}
        format={(n) => `R${n}`}
        onSelect={(key) => selected.push(key)}
      />,
    )
    const income = await screen.findByRole("button", {
      name: "September, Money in: R100, show transactions",
    })
    const expense = await screen.findByRole("button", {
      name: "October, Money out: R80, show transactions",
    })
    fireEvent.click(income)
    fireEvent.click(expense)
    fireEvent.keyDown(income, { key: "Enter" })
    fireEvent.keyDown(expense, { key: " " })
    assert.deepEqual(selected, ["2026-09", "2026-10", "2026-09", "2026-10"])
  } finally {
    cleanup()
  }
})
