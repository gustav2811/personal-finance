import "./test-dom"
import assert from "node:assert/strict"
import { afterEach, test } from "node:test"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { HouseholdProvider } from "../../components/shell/household-context"
import { TransactionsView } from "./transactions-view"

afterEach(cleanup)

test("Save in the review queue advances to the next transaction", async () => {
  render(<HouseholdProvider value={{ email: "demo@localhost", signIn() {} }}><TransactionsView /></HouseholdProvider>)
  await screen.findByText("Takealot")
  fireEvent.click(screen.getByRole("button", { name: "Filters" }))
  fireEvent.keyDown(screen.getByRole("combobox", { name: "Show" }), { key: "ArrowDown" })
  fireEvent.click(await screen.findByRole("option", { name: "Needs review" }))
  await waitFor(() => assert.equal(Boolean(screen.queryByText("Spar")), false))
  fireEvent.click(screen.getByText("Takealot").closest("tr")!)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Gift saved before advancing" } })
  fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
  await waitFor(() => assert.equal((screen.getByLabelText("Notes") as HTMLTextAreaElement).value, "Check whether this was for the family outing."))
  assert.equal(screen.queryByText("Takealot"), null)
})

test("Next and Close persist fresh notes without a Save click", async () => {
  render(<HouseholdProvider value={{ email: "demo@localhost", signIn() {} }}><TransactionsView /></HouseholdProvider>)
  fireEvent.click((await screen.findByText("Spar")).closest("tr")!)
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Persisted by Next" } })
  fireEvent.click(screen.getByRole("button", { name: "Next movement" }))
  await waitFor(() => assert.equal((screen.getByLabelText("Description") as HTMLInputElement).value, "Yoco *Plato Linden Johannesburg ZA"))
  fireEvent.click(screen.getByRole("button", { name: "Previous movement" }))
  await waitFor(() => assert.equal((screen.getByLabelText("Notes") as HTMLTextAreaElement).value, "Persisted by Next"))
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Persisted by Close" } })
  fireEvent.click(screen.getByRole("button", { name: "Close" }))
  await waitFor(() => assert.equal(Boolean(screen.queryByRole("dialog")), false))
  fireEvent.click(screen.getByText("Spar").closest("tr")!)
  assert.equal((screen.getByLabelText("Notes") as HTMLTextAreaElement).value, "Persisted by Close")
})
