import "./test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { TransactionReviewDialog } from "./review-dialog"
import { demoRpc } from "../../lib/demo/transactions"
import type { CategoryOption, TransactionFeedItem } from "./model"

afterEach(cleanup)
function fixture() {
  const { item } = demoRpc("finance_get_transaction_v1", { p_transaction_id: "demo-spar" }) as { item: TransactionFeedItem }
  const { categories } = demoRpc("finance_get_transaction_filters_v1") as { categories: CategoryOption[] }
  return { item, categories }
}
test("category review flushes edits on close and returns the canonical saved row", async () => {
  const saved: TransactionFeedItem[] = []
  let closed = false
  render(<TransactionReviewDialog {...fixture()} onSaved={(item) => saved.push(item)} onClose={() => { closed = true }} />)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Saved from analysis" } })
  fireEvent.click(screen.getByRole("button", { name: "Close transaction review" }))
  await waitFor(() => assert.equal(closed, true))
  assert.equal(saved.length, 1)
  assert.equal(saved[0].notes, "Saved from analysis")
  const { item } = fixture()
  assert.equal(item.notes, "Saved from analysis")
})
test("private local snapshots cannot be edited but can be closed", async () => {
  let closed = false
  render(<TransactionReviewDialog {...fixture()} readOnly onSaved={() => assert.fail("Snapshot wrote to ledger")} onClose={() => { closed = true }} />)
  assert.equal((screen.getByLabelText("Notes") as HTMLTextAreaElement).disabled, true)
  assert.ok(screen.getByText("Local snapshot · read only"))
  fireEvent.click(screen.getByRole("button", { name: "Close transaction review" }))
  await waitFor(() => assert.equal(closed, true))
})

test("validation failure retains the draft until explicitly discarded", async () => {
  let closed = false
  render(<TransactionReviewDialog {...fixture()} onSaved={() => assert.fail("Invalid draft saved")} onClose={() => { closed = true }} />)
  fireEvent.change(screen.getByLabelText("Description"), { target: { value: "" } })
  fireEvent.click(screen.getByRole("button", { name: "Close transaction review" }))
  await screen.findByText("Enter a description before leaving this transaction.")
  assert.equal(closed, false)
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }))
  assert.equal(closed, true)
})

test("category popup stays inside the modal focus boundary and saves a selection", async () => {
  const saved: TransactionFeedItem[] = []
  const initial = fixture()
  render(<TransactionReviewDialog {...initial} onSaved={(item) => saved.push(item)} onClose={() => assert.fail("Category selection closed the modal")} />)
  const input = screen.getByRole("combobox", { name: "Category" })
  fireEvent.click(input)
  fireEvent.keyDown(input, { key: "ArrowDown" })
  const list = await screen.findByRole("listbox")
  assert.ok(screen.getByRole("dialog").contains(list), "Category popup escapes the modal focus boundary")
  fireEvent.click(screen.getByRole("option", { name: /Coffee/ }))
  await waitFor(() => assert.equal(saved.length, 1), { timeout: 1500 })
  assert.equal(saved[0].category.id, initial.categories.find((category) => category.name === "Coffee")!.id)
  assert.ok(screen.getByRole("dialog"))
  assert.ok(screen.getByText("Saved"))
})
