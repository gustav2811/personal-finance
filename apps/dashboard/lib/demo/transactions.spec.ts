import assert from "node:assert/strict"
import test from "node:test"
import { demoRpc } from "./transactions"

const enabled = { NODE_ENV: process.env.NODE_ENV, DASHBOARD_DEMO_MODE: process.env.DASHBOARD_DEMO_MODE }
const env = process.env as Record<string, string | undefined>

test.beforeEach(() => {
  env.NODE_ENV = "development"
  process.env.DASHBOARD_DEMO_MODE = "true"
})

test.after(() => {
  env.NODE_ENV = enabled.NODE_ENV
  process.env.DASHBOARD_DEMO_MODE = enabled.DASHBOARD_DEMO_MODE
})

test("demo RPC is fail-closed outside development", () => {
  env.NODE_ENV = "production"
  assert.throws(() => demoRpc("finance_get_transaction_filters_v1"), /only available in development/)
})

test("filters support review, account, category, direction, and dates", () => {
  const result = demoRpc("finance_list_transactions_v1", {
    p_filters: { reviewState: "not_reviewed", accountId: "demo-credit-card", categoryId: "demo-groceries", direction: "debit", fromDate: "2026-10-13", toDate: "2026-10-13" },
  }) as { items: Array<{ id: string }> }
  assert.deepEqual(result.items.map((item) => item.id), ["demo-takealot"])
})

test("details can clear notes and stale revisions conflict", () => {
  const saved = demoRpc("finance_update_transaction_details_v1", { p_transaction_id: "demo-spar", p_notes: null, p_expected_notes: "Weekly top-up." }) as { item: { notes: string | null } }
  assert.equal(saved.item.notes, null)
  const stale = demoRpc("finance_update_transaction_details_v1", { p_transaction_id: "demo-spar", p_notes: "stale", p_expected_notes: "Weekly top-up." }) as { conflict: boolean }
  assert.equal(stale.conflict, true)
})

test("undo returns the category to source-only and mutates the fixture", () => {
  demoRpc("finance_set_transaction_category_v1", { p_transaction_id: "demo-takealot", p_category_id: "demo-gifts" })
  const result = demoRpc("finance_undo_transaction_category_v1", { p_transaction_id: "demo-takealot", p_expected_confirmed_classification_id: "demo-confirmed-demo-takealot" }) as { item: { category: { state: string }; reviewState: string } }
  assert.equal(result.item.category.state, "source_only")
  assert.equal(result.item.reviewState, "unclassified")
})

test("atomic review rejects stale treatment without changing other fields", () => {
  const before = demoRpc("finance_get_transaction_v1", { p_transaction_id: "demo-admyt" }) as { item: { description: string; notes: string | null; category: { name: string } } }
  const result = demoRpc("finance_review_transaction_v1", {
    p_transaction_id: "demo-admyt",
    p_category_id: "demo-gifts",
    p_description: "Birthday parking",
    p_notes: "Should not save",
    p_is_transfer: false,
    p_expected: { confirmedTreatmentId: "stale" },
  }) as { conflict: boolean }
  assert.equal(result.conflict, true)
  const after = demoRpc("finance_get_transaction_v1", { p_transaction_id: "demo-admyt" }) as { item: { description: string; notes: string | null; category: { name: string } } }
  assert.deepEqual(after.item, before.item)
})

test("atomic review retries idempotently for the desired state", () => {
  const args = { p_transaction_id: "demo-yoco", p_category_id: "demo-coffee", p_description: "Yoco *Plato Linden Johannesburg ZA", p_notes: null, p_is_transfer: false, p_exclude_from_spend: false, p_nature: "spend", p_expected: {} }
  demoRpc("finance_review_transaction_v1", args)
  const retry = demoRpc("finance_review_transaction_v1", args) as { idempotent: boolean }
  assert.equal(retry.idempotent, true)
})

test("metadata-only review keeps an unclassified transaction unresolved", () => {
  const result = demoRpc("finance_review_transaction_v1", {
    p_transaction_id: "demo-uncategorized",
    p_category_id: null,
    p_description: "Renamed unknown purchase",
    p_notes: "Investigate later",
    p_is_transfer: null,
    p_exclude_from_spend: null,
    p_nature: null,
    p_expected: {},
  }) as { item: { reviewState: string; category: { id: string | null }; description: string; treatment: { state: string } } }
  assert.equal(result.item.reviewState, "unclassified")
  assert.equal(result.item.category.id, null)
  assert.equal(result.item.description, "Renamed unknown purchase")
  assert.equal(result.item.treatment.state, "unknown")
})
