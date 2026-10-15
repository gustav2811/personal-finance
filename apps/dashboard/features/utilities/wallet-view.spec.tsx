import "../transactions/test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { WalletBody } from "./wallet-view"
import type { WalletData } from "./wallet-queries"

afterEach(cleanup)
const empty: WalletData = {
  devices: [], ledgerEntries: [], financialTransactionCount: 0,
  financialSnapshots: [], financialSnapshotUnavailable: false, financialError: null,
  fetchedAt: "2026-10-15T10:00:00Z",
}

test("unavailable count is not described as zero; available balance remains visible", () => {
  let retries = 0
  render(<WalletBody days={90} data={{ ...empty, financialTransactionCount: null,
    financialError: "private diagnostic", financialSnapshots: [{ account_id: "a", date: "2026-10-15", amount_cents: 12300, currency_code: "ZAR" }],
  }} onRetry={async () => { retries += 1 }} />)
  assert.ok(screen.getByText("Transaction counts are unavailable."))
  assert.ok(screen.getByText(/Latest tracked balance/))
  assert.equal(screen.queryByText("No transaction records in this window."), null)
  assert.equal(screen.queryByText("private diagnostic"), null)
  fireEvent.click(screen.getByRole("button", { name: "Retry financial information" }))
  assert.equal(retries, 1)
})

test("successful zero count stays distinct from unavailable balances", () => {
  render(<WalletBody days={90} data={{ ...empty, financialError: "unavailable", financialSnapshotUnavailable: true }} onRetry={async () => {}} />)
  assert.ok(screen.getByText("No transaction records in this window."))
  assert.ok(screen.getByText("Tracked balances are unavailable."))
  assert.ok(screen.getByText("No ledger entries in this range."))
})
