import "../transactions/test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { AgreementView, type AgreementResourceData } from "./agreement-view"
import { CutoverView, type CutoverResourceData } from "./cutover-view"
import { PlanEditor, type PlanEditorResourceData } from "./plan-editor"
import { blankLine, readVersionPage, type StoredPlan } from "@/domain/budget/plan"
import { addMonths, currentCycle, cycleLabel } from "@/domain/budget/cycle"
import { copy } from "@/domain/budget/copy"

const agreement: AgreementResourceData = { headers: [], plans: new Map(), workspace: null, reviewItems: null, overview: null, liquidity: null }
const plan: PlanEditorResourceData = { agreement: { headers: [], plans: new Map() }, workspace: null }
const cutover: CutoverResourceData = { workspace: { accounts: [], members: [], funds: [], categories: [], earmarks: [], movements: [], reconciliation: null } as never, devices: [] }

afterEach(cleanup)

test("AgreementView does not render the previous cycle while the next cycle is loading", async () => {
  const start = currentCycle().start
  const nextStart = addMonths(start, 1)
  const stored: StoredPlan = {
    versionId: "version-1", state: "published", versionNumber: "1", draftRevision: null,
    parentVersionId: null, reason: null, startsOnCycle: start, incomeAssumptions: [], sourceReferences: [],
    lines: [{ ...blankLine({ fundId: "fund-1", name: "Old-cycle groceries", stableLineId: "line-1" }), contributionCents: "60000" }],
  }
  const headers = readVersionPage({ versions: [{ version_id: stored.versionId, state: "published", version_number: 1, starts_on_cycle: start }], next_cursor: null }).versions
  const previous = { ...agreement, headers, plans: new Map([[stored.versionId, stored]]) }
  let release!: (value: AgreementResourceData) => void
  const next = new Promise<AgreementResourceData>((resolve) => { release = resolve })
  const load = (cycle: string) => cycle === nextStart ? next : Promise.resolve(previous)
  render(<AgreementView loadResource={load} />)
  await screen.findByText("Old-cycle groceries")
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Budget cycle" }), { key: "ArrowDown" })
  fireEvent.click(await screen.findByRole("option", { name: cycleLabel(nextStart, addMonths(nextStart, 1)) }))
  assert.equal(screen.queryByText("Old-cycle groceries"), null)
  assert.ok(screen.getByText("Reading the budget."))
  await act(async () => release(agreement))
  await waitFor(() => assert.equal(screen.queryByText("Reading the budget."), null))
  assert.equal(screen.queryByText("Old-cycle groceries"), null)
})

test("PlanEditor preserves a typed dirty draft across a refresh and resets it on identity change", async () => {
  const first = () => Promise.resolve(plan)
  const view = render(<PlanEditor loadResource={first} />)
  const reason = await screen.findByLabelText(copy.publishReason)
  fireEvent.change(reason, { target: { value: "Keep my unsaved revision" } })
  const refreshed = () => Promise.resolve({ ...plan })
  view.rerender(<PlanEditor loadResource={refreshed} />)
  await waitFor(() => assert.equal((screen.getByLabelText(copy.publishReason) as HTMLTextAreaElement).value, "Keep my unsaved revision"))
  view.rerender(<PlanEditor initialChoice="next" loadResource={refreshed} />)
  await waitFor(() => assert.equal((screen.getByLabelText(copy.publishReason) as HTMLTextAreaElement).value, ""))
})

test("CutoverView blocks a new command after its refresh fails and Retry only reads", async () => {
  let reads = 0
  let writes = 0
  const load = () => ++reads === 1 ? Promise.resolve(cutover) : Promise.reject(new Error("offline"))
  const write = async () => { writes += 1; return {} }
  render(<CutoverView loadResource={load} write={write as never} />)
  const name = await screen.findByLabelText("Purpose name")
  fireEvent.change(name, { target: { value: "Repairs" } })
  fireEvent.click((await screen.findAllByRole("button", { name: "Add purpose" })).at(-1)!)
  await screen.findByText("Saved, but the latest information couldn’t be loaded")
  assert.equal(writes, 1)
  assert.equal((screen.getByRole("button", { name: "Add purpose" }).closest("fieldset") as HTMLFieldSetElement).disabled, true)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await waitFor(() => assert.equal(reads, 3))
  assert.equal(writes, 1)
})
