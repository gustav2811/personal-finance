import assert from "node:assert/strict"
import { test } from "node:test"
import { redactInsightUrl } from "./insights"

test("strips query strings and hashes from page views", () => {
  assert.equal(
    redactInsightUrl(
      "https://household.klingbiel.org/transactions?transaction=tx-1&code=oauth#spent",
    ),
    "https://household.klingbiel.org/transactions",
  )
})

test("replaces fund ids in the path but keeps the page", () => {
  assert.equal(
    redactInsightUrl(
      "https://household.klingbiel.org/budget/funds/11111111-2222-3333-4444-555555555555",
    ),
    "https://household.klingbiel.org/budget/funds/[id]",
  )
})

test("leaves route templates and relative paths usable", () => {
  assert.equal(redactInsightUrl("/budget/funds/[fundId]"), "/budget/funds/[fundId]")
  assert.equal(redactInsightUrl("/analysis?category=Groceries"), "/analysis")
})

test("drops events whose url cannot be redacted", () => {
  assert.equal(redactInsightUrl(""), null)
})
