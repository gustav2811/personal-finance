import "./test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { createRef, useState } from "react"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { Inspector, type InspectorSave } from "./inspector"
import { demoRpc } from "../../lib/demo/transactions"
import type { CategoryOption, TransactionFeedItem } from "./model"

afterEach(cleanup)
type Draft = Parameters<Parameters<typeof Inspector>[0]["onConfirm"]>[0]
const saveRef = createRef<InspectorSave>()
function Harness({ persist }: { persist: (draft: Draft) => Promise<string | null> }) {
  const [item, setItem] = useState(() => (demoRpc("finance_get_transaction_v1", { p_transaction_id: "demo-spar" }) as { item: TransactionFeedItem }).item)
  const { categories } = demoRpc("finance_get_transaction_filters_v1") as { categories: CategoryOption[] }
  return <Inspector categories={categories} categoryError={null} item={item} saveRef={saveRef}
    pending={false} undo={false} onUndo={() => {}} onDirtyChange={() => {}}
    onConfirm={async (draft) => {
      const error = await persist(draft)
      if (!error) setItem((current) => ({ ...current, description: draft.description, notes: draft.notes }))
      return error
    }} />
}

test("notes autosave after a pause without pressing Save", async () => {
  const calls: Draft[] = []
  render(<Harness persist={async (draft) => { calls.push(draft); return null }} />)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Keep the receipt" } })
  await waitFor(() => assert.equal(calls.length, 1), { timeout: 1500 })
  assert.equal(calls[0].notes, "Keep the receipt")
  await waitFor(() => assert.ok(screen.getByText("Saved")))
})

test("Next flushes a fresh draft before the debounce expires", async () => {
  const calls: Draft[] = []
  render(<Harness persist={async (draft) => { calls.push(draft); return null }} />)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Immediate next" } })
  let allowed = false
  await act(async () => { allowed = await saveRef.current!.flush() })
  assert.equal(allowed, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].notes, "Immediate next")
})

test("navigation shares the running save and fields cannot lose later edits", async () => {
  let complete!: (value: string | null) => void
  let calls = 0
  render(<Harness persist={() => { calls++; return new Promise((resolve) => { complete = resolve }) }} />)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Wait for save" } })
  let first!: Promise<boolean>
  act(() => { first = saveRef.current!.flush() })
  await waitFor(() => assert.equal(calls, 1))
  assert.equal((screen.getByLabelText("Notes") as HTMLTextAreaElement).disabled, true)
  let second!: Promise<boolean>
  act(() => { second = saveRef.current!.flush() })
  await act(async () => { complete(null); assert.equal(await first, true); assert.equal(await second, true) })
  assert.equal(calls, 1)
})

test("failed save retains the draft and blocks leaving until explicit Retry", async () => {
  let calls = 0
  render(<Harness persist={async () => ++calls === 1 ? "Offline: try again" : null} />)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Do not lose this" } })
  await act(async () => { assert.equal(await saveRef.current!.flush(), false) })
  assert.equal((screen.getByLabelText("Notes") as HTMLTextAreaElement).value, "Do not lose this")
  await act(async () => { assert.equal(await saveRef.current!.flush(), false) })
  assert.equal(calls, 1)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => assert.equal(calls, 2))
  await waitFor(() => assert.ok(screen.getByText("Saved")))
})

test("an explicit Save requests advancement, while autosave does not", async () => {
  const requests: Array<boolean | undefined> = []
  const { item } = demoRpc("finance_get_transaction_v1", { p_transaction_id: "demo-takealot" }) as { item: TransactionFeedItem }
  const { categories } = demoRpc("finance_get_transaction_filters_v1") as { categories: CategoryOption[] }
  render(<Inspector categories={categories} categoryError={null} item={item} saveRef={saveRef}
    pending={false} undo={false} onUndo={() => {}} onDirtyChange={() => {}}
    onConfirm={async (_draft, options) => { requests.push(options?.advance); return null }} />)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Save and next" } })
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
  await waitFor(() => assert.deepEqual(requests, [true]))
})
