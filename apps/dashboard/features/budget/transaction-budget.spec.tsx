import "../transactions/test-dom"
Object.defineProperty(globalThis, "self", { configurable: true, value: globalThis.window })
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { MemberRef } from "@/domain/budget/members"
import { projectReviewQueue } from "@/domain/budget/review"
import type { TransactionBudgetReady } from "./transaction-budget"
import { readReviewQueuePages, TransactionBudget } from "./transaction-budget"

afterEach(cleanup)

const members: MemberRef[] = [{ id: "member-1", email: "gustav@example.com" }]

function ready(overrides: Partial<TransactionBudgetReady> = {}): TransactionBudgetReady {
  return {
    ask: true,
    sentence: "The household paid",
    amountCents: "32000",
    fingerprint: "fingerprint-1",
    setId: null,
    siblingCount: 1,
    drifted: false,
    funds: [{ id: "fund-1", name: "Household" }],
    members,
    categories: [{ id: "category-1", name: "Groceries" }],
    purchases: [],
    purchasesPartial: false,
    purchasesUnread: false,
    decisionsConfirmed: false,
    queuePartial: false,
    savedReviewReadFailed: false,
    ...overrides,
  }
}

test("missing amount explains why review is blocked", async () => {
  const load = async () => ready({ amountCents: null })
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText("Budget review needs source details")
  assert.ok(screen.getByRole("button", { name: "Retry" }))
  assert.ok(screen.getByRole("link", { name: "Open budget review" }))
  assert.equal(screen.queryByRole("button", { name: "Save" }), null)
})

test("missing fingerprint explains why review is blocked", async () => {
  const load = async () => ready({ fingerprint: null })
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText("Budget review needs source details")
  assert.equal(screen.queryByRole("button", { name: "Save" }), null)
})

test("required read failure has a blocking retry state", async () => {
  const load = async () => { throw new Error("offline") }
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText("Budget review could not be loaded")
  assert.ok(screen.getByRole("button", { name: "Retry" }))
})

test("saved review lookup failure is distinct and never enables approval", async () => {
  const load = async () => ready({ savedReviewReadFailed: true })
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText("Saved budget review could not be checked")
  assert.equal(screen.queryByRole("button", { name: "Save" }), null)
})

test("an actionable item found beyond the first queue page still renders review", async () => {
  const load = async () => ready({ sentence: "Second queue page movement" })
  render(<TransactionBudget load={load} transactionId="transaction-on-page-two" />)
  await screen.findByRole("button", { name: "Save" })
})

test("review queue traversal reaches later pages and reports a capped partial read", async () => {
  const calls: Array<string | null> = []
  const laterPage = { items: [{ review_key: "page-two" }], next_cursor: null }
  const result = await readReviewQueuePages(async (cursor) => {
    calls.push(cursor)
    return cursor === null ? { items: [], next_cursor: "page-two" } : laterPage
  })
  assert.deepEqual(calls, [null, "page-two"])
  assert.equal(result.partial, false)
  assert.deepEqual((result.queue as { items: unknown[] }).items, laterPage.items)

  const capped = await readReviewQueuePages(async (cursor) => ({ items: [], next_cursor: `next-${cursor ?? "first"}` }))
  assert.equal(capped.partial, true)
})

test("a fully traversed queue projects as complete after page merging", async () => {
  const result = await readReviewQueuePages(async (cursor) => (
    cursor === null ? { items: [], next_cursor: "page-two" } : { items: [], next_cursor: null }
  ))
  assert.equal(result.partial, false)
  assert.equal(projectReviewQueue({ queue: result.queue, members }).partial, false)
  assert.equal((result.queue as { next_cursor: string | null }).next_cursor, null)
})

test("partial queue traversal pauses approval until retry", async () => {
  const load = async () => ready({ queuePartial: true })
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText("Budget review is incomplete")
  assert.equal(screen.queryByRole("button", { name: "Save" }), null)
  assert.ok(screen.getByRole("button", { name: "Retry" }))
})

test("confirmed approval remains visible", async () => {
  const load = async () => ready({ ask: false, sentence: "This movement is already current." })
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText(/This movement is already current\./)
  assert.match(screen.getByText(/This movement is already current\./).textContent ?? "", /Already approved/)
})

test("a truncated queue cannot imply that a transaction is already approved", async () => {
  const load = async () => ready({ ask: false, queuePartial: true, sentence: "Apparently current" })
  render(<TransactionBudget load={load} transactionId="transaction-1" />)
  await screen.findByText("Budget review is incomplete")
  assert.equal(screen.queryByText(/Already approved/), null)
})

test("switching transactions ignores the late response for the old selection", async () => {
  let resolveFirst!: (value: TransactionBudgetReady) => void
  let resolveSecond!: (value: TransactionBudgetReady) => void
  const first = new Promise<TransactionBudgetReady>((resolve) => { resolveFirst = resolve })
  const second = new Promise<TransactionBudgetReady>((resolve) => { resolveSecond = resolve })
  const load = (id: string) => id === "first" ? first : second
  const view = render(<TransactionBudget load={load} transactionId="first" />)
  view.rerender(<TransactionBudget load={load} transactionId="second" />)
  resolveFirst(ready({ sentence: "Stale first response", amountCents: null, fingerprint: null }))
  await waitFor(() => assert.equal(screen.queryByText("Budget review needs source details"), null))
  resolveSecond(ready({ sentence: "Current second response", amountCents: null, fingerprint: null }))
  await screen.findByText("Budget review needs source details")
  assert.equal(screen.queryByText("Stale first response"), null)
})
