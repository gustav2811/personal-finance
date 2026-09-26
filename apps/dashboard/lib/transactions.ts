import type { Json } from "@/lib/supabase/database.types"
import { getBrowserClient } from "@/lib/supabase/browser"

export type Provenance = "user" | "policy" | "jev" | "agent" | "source" | "none"

export type CategoryState = "confirmed" | "proposed" | "source_only" | "unclassified"

export type TreatmentState = "confirmed" | "proposed" | "source_only" | "unknown"

export type ClassifierState = "not_run" | "succeeded" | "abstained" | "failed"

export type ReviewState =
  | "confirmed"
  | "jev_agrees"
  | "jev_disagrees"
  | "unclassified"
  | "awaiting_classifier"
  | "classifier_abstained"
  | "classifier_failed"

export type TransactionFeedItem = {
  id: string
  occurredAt: string
  occurredOn: string
  description: string
  originalDescription: string | null
  amount: string
  currencyCode: string
  merchant: { id: string | null; name: string | null }
  account: { id: string; name: string; type: string | null }
  source: {
    system: string
    categoryId: string | null
    categoryName: string | null
    isTransfer: boolean | null
    isPending: boolean | null
    isArchived: boolean
    lastSeenAt: string | null
  }
  category: {
    id: string | null
    name: string | null
    provenance: Provenance
    state: CategoryState
    confidence: number | null
    proposalDiffersFromSource: boolean
  }
  treatment: {
    isTransfer: boolean | null
    excludeFromSpend: boolean | null
    nature: string | null
    provenance: Provenance
    state: TreatmentState
  }
  classifier: {
    runId: string | null
    classifier: string | null
    classifierVersion: string | null
    modelId: string | null
    completedAt: string | null
    confidence: number | null
    margin: number | null
    topProbability: number | null
    accepted: boolean | null
    state: ClassifierState
  }
  event: {
    id: string
    type: string
    role: string
    status: string
  } | null
  reviewState: ReviewState
  revision: {
    confirmedClassificationId: string | null
    proposedClassificationId: string | null
    confirmedTreatmentId: string | null
    proposedTreatmentId: string | null
  }
}

export type CategoryOption = {
  id: string
  name: string
  group: string | null
  slug: string
  lifecycleStatus: string
}

export type AccountOption = {
  id: string
  name: string
  type: string | null
  lifecycleStatus: string
}

export type TransactionFilters = {
  fromDate?: string
  toDate?: string
  accountId?: string
  categoryId?: string
  reviewState?: ReviewState | "needs_review"
  sourceSystem?: string
  transfer?: "yes" | "no" | "unknown"
  spend?: "included" | "excluded" | "unknown"
  direction?: "debit" | "credit"
  search?: string
  archived?: boolean
}

export type LedgerActivity = {
  lastFinwiseSyncAt: string | null
  lastSourceObservationAt: string | null
  lastClassifierRunAt: string | null
  classifier: string | null
  classifierVersion: string | null
}

export type MutationResult = {
  conflict: boolean
  idempotent: boolean
  item: TransactionFeedItem
}

export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in to keep this decision.")
    this.name = "SignInRequiredError"
  }
}

const READ_RPCS = new Set([
  "finance_list_transactions_v1",
  "finance_get_transaction_v1",
  "finance_get_transaction_filters_v1",
  "finance_get_transaction_activity_v1",
])

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("The ledger returned an unreadable response.")
  }
  return value as Record<string, unknown>
}

function friendlyError(message: string): Error {
  if (message.includes("reviewer identity is not available")) {
    return new SignInRequiredError()
  }
  if (message.includes("not a household member")) {
    return new Error("This Google account is not on the household ledger.")
  }
  if (message.includes("category is not active")) {
    return new Error("That category is no longer available.")
  }
  if (message.includes("transaction not found")) {
    return new Error("That movement is no longer in the ledger.")
  }
  if (message.includes("event membership")) {
    return new Error("This movement belongs to an event. Treatment cannot be changed here.")
  }
  if (message.includes("invalid cursor")) {
    return new Error("The ledger page expired. Refresh the list.")
  }
  return new Error("The ledger could not complete that request.")
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const supabase = getBrowserClient()
  const { data, error } = await supabase.rpc(name as never, args as never)
  if (error) throw friendlyError(error.message)
  return data as T
}

async function readLocal<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  })
  const body = (await response.json()) as { error?: string; data?: T }
  if (!response.ok || body.error) {
    throw friendlyError(body.error ?? "The ledger could not be read.")
  }
  return body.data as T
}

async function readRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  if (!READ_RPCS.has(name)) {
    throw new Error("Unsupported ledger read.")
  }
  if (process.env.NODE_ENV !== "production") {
    const hasBrowserConfig = Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    )
    if (!hasBrowserConfig) return readLocal<T>(name, args)
    const supabase = getBrowserClient()
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session) return readLocal<T>(name, args)
  }
  return rpc<T>(name, args)
}

async function writeRpc(name: string, args: Record<string, unknown>): Promise<MutationResult> {
  const supabase = getBrowserClient()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) throw new SignInRequiredError()
  const data = await rpc<MutationResult>(name, args)
  const record = asObject(data)
  if (!record.item) {
    throw new Error("The ledger returned an unreadable response.")
  }
  return data
}

export async function listTransactions(input: {
  cursor?: string | null
  limit?: number
  filters?: TransactionFilters
}): Promise<{ items: TransactionFeedItem[]; nextCursor: string | null }> {
  const data = await readRpc<Json>("finance_list_transactions_v1", {
    p_cursor: input.cursor ?? null,
    p_limit: input.limit ?? 50,
    p_filters: input.filters ?? {},
  })
  const record = asObject(data)
  return {
    items: Array.isArray(record.items) ? (record.items as TransactionFeedItem[]) : [],
    nextCursor: typeof record.nextCursor === "string" ? record.nextCursor : null,
  }
}

export async function getTransactionFilters(): Promise<{
  accounts: AccountOption[]
  categories: CategoryOption[]
}> {
  const data = await readRpc<{
    accounts: AccountOption[]
    categories: CategoryOption[]
  }>("finance_get_transaction_filters_v1", {})
  const record = asObject(data)
  return {
    accounts: Array.isArray(record.accounts) ? (record.accounts as AccountOption[]) : [],
    categories: Array.isArray(record.categories) ? (record.categories as CategoryOption[]) : [],
  }
}

export async function getTransactionActivity(): Promise<LedgerActivity> {
  return readRpc<LedgerActivity>("finance_get_transaction_activity_v1", {})
}

export function setTransactionCategory(input: {
  transactionId: string
  categoryId: string
  expectedConfirmedClassificationId: string | null
  expectedProposedClassificationId: string | null
  reviewCommandId: string
}): Promise<MutationResult> {
  return writeRpc("finance_set_transaction_category_v1", {
    p_transaction_id: input.transactionId,
    p_category_id: input.categoryId,
    p_expected_confirmed_classification_id: input.expectedConfirmedClassificationId,
    p_expected_proposed_classification_id: input.expectedProposedClassificationId,
    p_review_command_id: input.reviewCommandId,
  })
}

export function undoTransactionCategory(input: {
  transactionId: string
  categoryId: string | null
  expectedConfirmedClassificationId: string | null
  reviewCommandId: string
}): Promise<MutationResult> {
  return writeRpc("finance_undo_transaction_category_v1", {
    p_transaction_id: input.transactionId,
    p_category_id: input.categoryId,
    p_expected_confirmed_classification_id: input.expectedConfirmedClassificationId,
    p_review_command_id: input.reviewCommandId,
  })
}

export function setTransactionTreatment(input: {
  transactionId: string
  isTransfer: boolean
  excludeFromSpend: boolean
  nature: string | null
  expectedConfirmedTreatmentId: string | null
  expectedProposedTreatmentId: string | null
  reviewCommandId: string
}): Promise<MutationResult> {
  return writeRpc("finance_set_transaction_treatment_v1", {
    p_transaction_id: input.transactionId,
    p_is_transfer: input.isTransfer,
    p_exclude_from_spend: input.excludeFromSpend,
    p_nature: input.nature,
    p_expected_confirmed_treatment_id: input.expectedConfirmedTreatmentId,
    p_expected_proposed_treatment_id: input.expectedProposedTreatmentId,
    p_review_command_id: input.reviewCommandId,
  })
}
