import assert from "node:assert/strict"
import test from "node:test"
import { groupContributors } from "./presentation"
import type { BreakdownRow } from "./model"

const row = (key: string, net: number): BreakdownRow => ({
  key,
  label: key,
  count: 1,
  income: 0,
  expensesGross: Math.max(0, net),
  refunds: Math.max(0, -net),
  expensesNet: net,
  net: -net,
  share: 0,
})

test("long tail retains every transaction key and the exact signed total", () => {
  const rows = Array.from({ length: 12 }, (_, index) =>
    row(String(index), 120 - index * 10),
  )
  const grouped = groupContributors(rows, (r) => r.expensesNet)
  assert.equal(grouped.length, 8)
  assert.equal(
    grouped.reduce((sum, r) => sum + r.value, 0),
    rows.reduce((sum, r) => sum + r.expensesNet, 0),
  )
  assert.deepEqual(
    grouped.flatMap((r) => r.memberKeys),
    rows.map((r) => r.key),
  )
  assert.equal(grouped.at(-1)?.label, "Other (5)")
})

test("opposing net contributions keep their visual magnitude instead of vanishing", () => {
  const result = groupContributors(
    [row("large", 100), row("debit", 10), row("refund", -10)],
    (r) => r.expensesNet,
    1,
  )
  assert.equal(result[1]?.value, 0)
  assert.equal(result[1]?.weight, 20)
  assert.equal(result[1]?.count, 2)
})

test("expanding the list restores every contributor and Other never collides with a real key", () => {
  const rows = [row("analysis:remaining", 20), row("b", 10), row("c", 5)]
  assert.equal(
    groupContributors(rows, (r) => r.expensesNet, 1)[1]?.key,
    "analysis:remaining:",
  )
  assert.equal(
    groupContributors(rows, (r) => r.expensesNet, rows.length).length,
    rows.length,
  )
})
