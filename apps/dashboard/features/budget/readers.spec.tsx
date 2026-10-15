import "../transactions/test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BudgetView } from "./overview-view"
import { LiquidityView } from "./liquidity-view"
import type { BudgetSource } from "./queries"

afterEach(cleanup)

function source(cycle: string): BudgetSource {
  return { overview: { complete: false, cycle_start: cycle, funds: [], reasons: [{ code: "cutover_missing" }] }, actuals: { entries: [] }, liquidity: {}, review: null, members: [] }
}

test("Liquidity retry renders a valid empty read and clears previous failure", async () => {
  let reads = 0
  const load = async () => { if (++reads === 1) throw new Error("internal policy"); return { wire: { complete: true, accounts: [] }, members: [] } }
  render(<LiquidityView load={load} />)
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
  await waitFor(() => assert.equal(screen.queryByRole("button", { name: "Retry" }), null))
  assert.equal(screen.queryByText("internal policy"), null)
  assert.equal(reads, 2)
})

test("Budget Overview retry clears failure and a new cycle hides previous data", async () => {
  let reads = 0
  let resolve!: (value: BudgetSource) => void
  const loadSource = async (cycle = "") => {
    reads += 1
    if (reads === 1) throw new Error("offline")
    if (reads === 2) return source(cycle)
    return new Promise<BudgetSource>((done) => { resolve = done })
  }
  render(<BudgetView loadSource={loadSource} />)
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }))
  await screen.findByRole("button", { name: "Earlier" })
  assert.equal(screen.queryByRole("button", { name: "Retry" }), null)
  fireEvent.click(screen.getByRole("button", { name: "Earlier" }))
  assert.ok(screen.getByText("Reading the budget."))
  assert.equal(screen.queryByRole("button", { name: "Later" }), null)
  await act(async () => { resolve(source("2026-08-23")) })
  await screen.findByRole("button", { name: "Later" })
})
