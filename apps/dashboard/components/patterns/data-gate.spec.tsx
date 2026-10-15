import "../../features/transactions/test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { DataGate } from "./data-gate"

afterEach(cleanup)

test("retry clears failure without exposing raw backend diagnostics", async () => {
  let calls = 0
  const load = async () => { if (++calls === 1) throw new Error("secret schema policy"); return "Loaded" }
  render(<DataGate load={load}>{(value) => <p>{value}</p>}</DataGate>)
  await screen.findByText("Household data could not be loaded")
  assert.equal(screen.queryByText(/secret schema/), null)
  fireEvent.click(screen.getByRole("button", { name: "Retry" }))
  await screen.findByText("Loaded")
  assert.equal(screen.queryByText("Household data could not be loaded"), null)
})

test("null is a successful result, not perpetual loading", async () => {
  const load = async () => null
  render(<DataGate load={load}>{(value) => <p>{value === null ? "No snapshot" : "Snapshot"}</p>}</DataGate>)
  await screen.findByText("No snapshot")
})
