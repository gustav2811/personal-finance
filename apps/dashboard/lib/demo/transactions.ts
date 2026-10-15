import { REVIEW_QUEUE, type TransactionFeedItem } from "@/lib/finance/transaction-model"

/**
 * Login-free fixtures for the dashboard's local development loop.
 *
 * This module is deliberately in-memory and contains no Supabase client. The
 * browser RPC adapter can call demoRpc with the same function names and args
 * as the production RPCs. `demoEnabled` is fail-closed: it can only be true
 * during `next dev`, never in a production build or server.
 */
export function demoEnabled(): boolean {
  return process.env.NODE_ENV === "development" && process.env.DASHBOARD_DEMO_MODE === "true"
}

type DemoRpcArgs = Record<string, unknown>
type DemoMutation = { conflict: boolean; idempotent: boolean; item: TransactionFeedItem }

const account = {
  id: "demo-credit-card",
  name: "Credit Card Account",
  type: "credit_card",
  lifecycleStatus: "active",
}

const categories = [
  { id: "demo-groceries", name: "Groceries", group: "Home", slug: "groceries", lifecycleStatus: "active" },
  { id: "demo-gifts", name: "Gifts", group: "Home", slug: "gifts", lifecycleStatus: "active" },
  { id: "demo-coffee", name: "Coffee", group: "Food", slug: "coffee", lifecycleStatus: "active" },
  { id: "demo-transport", name: "Transport Parking", group: "Transport", slug: "transport-parking", lifecycleStatus: "active" },
] as const

const transactions = new Map<string, TransactionFeedItem & { notes: string | null }>([
  [
    "demo-takealot",
    item({
      id: "demo-takealot",
      occurredAt: "2026-10-13T08:30:00.000Z",
      description: "Takealot Cape Town ZA",
      merchant: "Takealot",
      amount: "-199.00",
      category: "demo-groceries",
      reviewState: "jev_disagrees",
      confidence: 0.52,
      notes: null,
    }),
  ],
  [
    "demo-spar",
    item({
      id: "demo-spar",
      occurredAt: "2026-10-13T07:20:00.000Z",
      description: "Spar Express Beyers N Gauteng South ZA",
      merchant: "Spar",
      amount: "-40.00",
      category: "demo-groceries",
      reviewState: "confirmed",
      notes: "Weekly top-up.",
    }),
  ],
  [
    "demo-yoco",
    item({
      id: "demo-yoco",
      occurredAt: "2026-10-12T14:00:00.000Z",
      description: "Yoco *Plato Linden Johannesburg ZA",
      merchant: "Yoco",
      amount: "-80.00",
      category: "demo-coffee",
      reviewState: "confirmed",
      notes: null,
    }),
  ],
  [
    "demo-admyt",
    item({
      id: "demo-admyt",
      occurredAt: "2026-10-12T10:10:00.000Z",
      description: "admyt Parking Cape Town ZA",
      merchant: "Admyt",
      amount: "-51.00",
      category: "demo-transport",
      reviewState: "unclassified",
      notes: "Check whether this was for the family outing.",
    }),
  ],
  [
    "demo-uncategorized",
    item({
      id: "demo-uncategorized",
      occurredAt: "2026-10-11T09:00:00.000Z",
      description: "Unknown Card Purchase",
      merchant: "Unknown Merchant",
      amount: "-25.00",
      category: null,
      reviewState: "unclassified",
      notes: null,
      treatmentState: "unknown",
    }),
  ],
])

function item(input: {
  id: string
  occurredAt: string
  description: string
  merchant: string
  amount: string
  category: string | null
  reviewState: TransactionFeedItem["reviewState"]
  confidence?: number
  notes: string | null
  treatmentState?: "confirmed" | "proposed" | "source_only" | "unknown"
}): TransactionFeedItem & { notes: string | null } {
  const category = input.category ? categories.find((entry) => entry.id === input.category) ?? categories[0] : null
  const needsReview = input.reviewState !== "confirmed"
  return {
    id: input.id,
    occurredAt: input.occurredAt,
    occurredOn: input.occurredAt.slice(0, 10),
    description: input.description,
    originalDescription: input.description,
    amount: input.amount,
    currencyCode: "ZAR",
    merchant: { id: `merchant-${input.merchant.toLowerCase()}`, name: input.merchant },
    account,
    source: {
      system: "finwise",
      categoryId: "demo-source-category",
      categoryName: "Software & Services",
      isTransfer: false,
      isPending: false,
      isArchived: false,
      lastSeenAt: input.occurredAt,
    },
    category: {
      id: category?.id ?? null,
      name: category?.name ?? null,
      provenance: needsReview ? "jev" : "user",
      state: needsReview ? "proposed" : "confirmed",
      confidence: input.confidence ?? null,
      proposalDiffersFromSource: needsReview,
    },
    treatment: {
      isTransfer: false,
      excludeFromSpend: false,
      nature: "spend",
      provenance: "source",
      state: input.treatmentState ?? "confirmed",
    },
    classifier: {
      runId: needsReview ? `demo-run-${input.id}` : null,
      classifier: needsReview ? "jev" : null,
      classifierVersion: needsReview ? "demo" : null,
      modelId: needsReview ? "demo" : null,
      completedAt: input.occurredAt,
      confidence: input.confidence ?? null,
      margin: null,
      topProbability: input.confidence ?? null,
      accepted: needsReview ? false : null,
      state: needsReview ? "succeeded" : "not_run",
    },
    event: null,
    reviewState: input.reviewState,
    revision: {
      confirmedClassificationId: needsReview || !category ? null : `demo-confirmed-${input.id}`,
      proposedClassificationId: needsReview ? `demo-proposed-${input.id}` : null,
      confirmedTreatmentId: `demo-treatment-${input.id}`,
      proposedTreatmentId: null,
    },
    notes: input.notes,
  }
}

function record(value: unknown): DemoRpcArgs {
  return value && typeof value === "object" ? (value as DemoRpcArgs) : {}
}

function arg(args: DemoRpcArgs, ...names: string[]): unknown {
  return names.map((name) => args[name]).find((value) => value !== undefined)
}

function transaction(args: DemoRpcArgs): (TransactionFeedItem & { notes: string | null }) | undefined {
  const id = arg(args, "p_transaction_id", "transactionId")
  return typeof id === "string" ? transactions.get(id) : undefined
}

function mutation(current: TransactionFeedItem & { notes: string | null }): DemoMutation {
  return { conflict: false, idempotent: false, item: structuredClone(current) }
}

function conflict(current: TransactionFeedItem & { notes: string | null }): DemoMutation {
  return { conflict: true, idempotent: false, item: structuredClone(current) }
}

function matchesExpected(args: DemoRpcArgs, current: TransactionFeedItem & { notes: string | null }): boolean {
  const expectedDescription = arg(args, "p_expected_description", "expectedDescription")
  const expectedNotes = arg(args, "p_expected_notes", "expectedNotes")
  const expectedConfirmed = arg(args, "p_expected_confirmed_classification_id")
  const expectedProposed = arg(args, "p_expected_proposed_classification_id")
  const expectedTreatment = arg(args, "p_expected_confirmed_treatment_id")
  return (expectedDescription === undefined || expectedDescription === current.description)
    && (expectedNotes === undefined || expectedNotes === current.notes)
    && (expectedConfirmed === undefined || expectedConfirmed === current.revision.confirmedClassificationId)
    && (expectedProposed === undefined || expectedProposed === current.revision.proposedClassificationId)
    && (expectedTreatment === undefined || expectedTreatment === current.revision.confirmedTreatmentId)
}

function expectedReview(args: DemoRpcArgs): DemoRpcArgs {
  return record(arg(args, "p_expected"))
}

function matchesReviewExpected(expected: DemoRpcArgs, current: TransactionFeedItem & { notes: string | null }): boolean {
  return (expected.description === undefined || expected.description === current.description)
    && (expected.notes === undefined || expected.notes === current.notes)
    && (expected.confirmedClassificationId === undefined || expected.confirmedClassificationId === current.revision.confirmedClassificationId)
    && (expected.proposedClassificationId === undefined || expected.proposedClassificationId === current.revision.proposedClassificationId)
    && (expected.confirmedTreatmentId === undefined || expected.confirmedTreatmentId === current.revision.confirmedTreatmentId)
    && (expected.proposedTreatmentId === undefined || expected.proposedTreatmentId === current.revision.proposedTreatmentId)
}

function reviewMutation(current: TransactionFeedItem & { notes: string | null }, args: DemoRpcArgs): DemoMutation {
  const categoryId = args.p_category_id
  const category = typeof categoryId === "string" ? categories.find((entry) => entry.id === categoryId) : undefined
  if (typeof categoryId === "string" && !category) throw new Error("That category is no longer available.")
  const description = typeof args.p_description === "string" ? args.p_description.trim() : current.description
  if (!description) throw new Error("Description is required.")
  const notes = typeof args.p_notes === "string" || args.p_notes === null ? args.p_notes : current.notes
  const categoryChanged = Boolean(category && (current.category.id !== category.id || current.category.state !== "confirmed"))
  const detailsChanged = description !== current.description || notes !== current.notes
  const treatmentKnown = typeof args.p_is_transfer === "boolean" && typeof args.p_exclude_from_spend === "boolean"
  const nature = typeof args.p_nature === "string" ? args.p_nature.trim() || null : null
  const treatmentChanged = treatmentKnown && (current.treatment.state !== "confirmed"
    || current.treatment.isTransfer !== args.p_is_transfer
    || current.treatment.excludeFromSpend !== args.p_exclude_from_spend
    || current.treatment.nature !== nature)
  // Like the real command, response-loss retries resolve before the stale snapshot check.
  if (!categoryChanged && !detailsChanged && !treatmentChanged) {
    return { conflict: false, idempotent: true, item: structuredClone(current) }
  }
  if (!matchesReviewExpected(expectedReview(args), current) || (treatmentChanged && current.event)) return conflict(current)
  current.description = description
  current.notes = notes
  if (categoryChanged && category) {
    current.category = { ...current.category, id: category.id, name: category.name, provenance: "user", state: "confirmed", proposalDiffersFromSource: false }
    current.revision = { ...current.revision, confirmedClassificationId: `demo-confirmed-${crypto.randomUUID()}`, proposedClassificationId: null }
    current.reviewState = "confirmed"
  }
  if (treatmentChanged) {
    current.treatment = { ...current.treatment, isTransfer: args.p_is_transfer as boolean, excludeFromSpend: args.p_exclude_from_spend as boolean, nature, provenance: "user", state: "confirmed" }
    current.revision = { ...current.revision, confirmedTreatmentId: `demo-treatment-${crypto.randomUUID()}`, proposedTreatmentId: null }
  }
  return mutation(current)
}

export function demoRpc(name: string, rawArgs: DemoRpcArgs = {}): unknown {
  if (!demoEnabled()) throw new Error("Dashboard demo mode is only available in development.")
  const args = record(rawArgs)
  if (name === "finance_get_transaction_filters_v1") {
    return { accounts: [account], categories }
  }
  if (name === "finance_list_transactions_v1") {
    const filters = record(arg(args, "p_filters"))
    const reviewState = arg(filters, "reviewState", "review_state")
    const accountId = arg(filters, "accountId", "account_id")
    const categoryId = arg(filters, "categoryId", "category_id")
    const direction = arg(filters, "direction")
    const fromDate = arg(filters, "fromDate", "from_date")
    const toDate = arg(filters, "toDate", "to_date")
    const search = typeof arg(filters, "search") === "string" ? String(arg(filters, "search")).toLowerCase() : ""
    const items = [...transactions.values()]
      .filter((current) => reviewState !== "needs_review" || (REVIEW_QUEUE as readonly string[]).includes(current.reviewState))
      .filter((current) => reviewState !== "not_reviewed" || current.reviewState !== "confirmed")
      .filter((current) => !reviewState || reviewState === "needs_review" || reviewState === "not_reviewed" || current.reviewState === reviewState)
      .filter((current) => !accountId || current.account.id === accountId)
      .filter((current) => !categoryId || current.category.id === categoryId)
      .filter((current) => !direction || direction === "debit" && Number(current.amount) < 0 || direction === "credit" && Number(current.amount) >= 0)
      .filter((current) => !fromDate || current.occurredOn >= String(fromDate))
      .filter((current) => !toDate || current.occurredOn <= String(toDate))
      .filter((current) => !search || `${current.description} ${current.merchant.name}`.toLowerCase().includes(search))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    return { items: items.map((entry) => structuredClone(entry)), nextCursor: null, reviewCount: [...transactions.values()].filter((entry) => entry.reviewState !== "confirmed").length }
  }
  if (name === "finance_get_transaction_v1") {
    const current = transaction(args)
    if (!current) return { history: { classifications: [], runs: [] } }
    return {
      item: structuredClone(current),
      history: {
        classifications: [{ categoryName: current.category.name, decisionSource: current.category.provenance, status: current.category.state, confidence: current.category.confidence }],
        runs: [{ classifier: "jev", status: "succeeded", confidence: current.classifier.confidence, abstained: false, categoryName: current.category.name }],
      },
    }
  }
  const current = transaction(args)
  if (!current) return { conflict: true, idempotent: false, item: null }
  if (name === "finance_review_transaction_v1") return reviewMutation(current, args)
  if (!matchesExpected(args, current)) return conflict(current)
  if (name === "finance_set_transaction_category_v1") {
    const categoryId = arg(args, "p_category_id", "categoryId")
    const next = categories.find((entry) => entry.id === categoryId)
    if (next) current.category = { ...current.category, id: next.id, name: next.name, provenance: "user", state: "confirmed", proposalDiffersFromSource: false }
    current.reviewState = "confirmed"
    current.revision = { ...current.revision, confirmedClassificationId: `demo-confirmed-${current.id}`, proposedClassificationId: null }
    return mutation(current)
  }
  if (name === "finance_set_transaction_treatment_v1") {
    current.treatment = { ...current.treatment, isTransfer: Boolean(arg(args, "p_is_transfer", "isTransfer")), excludeFromSpend: Boolean(arg(args, "p_exclude_from_spend", "excludeFromSpend")), nature: typeof arg(args, "p_nature", "nature") === "string" ? String(arg(args, "p_nature", "nature")) : current.treatment.nature, provenance: "user", state: "confirmed" }
    current.revision = { ...current.revision, confirmedTreatmentId: `demo-treatment-${current.id}-updated` }
    return mutation(current)
  }
  if (name === "finance_update_transaction_details_v1") {
    const description = arg(args, "p_description", "description")
    const notes = arg(args, "p_notes", "notes")
    if (typeof description === "string") current.description = description
    if (typeof notes === "string" || notes === null) current.notes = notes
    return mutation(current)
  }
  if (name === "finance_undo_transaction_category_v1") {
    const sourceCategory = categories.find((entry) => entry.name === current.source.categoryName)
    current.category = { ...current.category, id: sourceCategory?.id ?? null, name: sourceCategory?.name ?? current.source.categoryName, provenance: "source", state: "source_only", proposalDiffersFromSource: false }
    current.reviewState = "unclassified"
    current.revision = { ...current.revision, confirmedClassificationId: null }
    return mutation(current)
  }
  throw new Error(`Demo RPC is not implemented: ${name}`)
}
