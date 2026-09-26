import type { Database, Json } from "@/lib/supabase/database.types"
import { getBrowserClient } from "@/lib/supabase/browser"
import type { MutationResult, TransactionFeedItem } from "./model"

type Functions = Database["public"]["Functions"]
type CategoryArgs = Functions["finance_set_transaction_category_v1"]["Args"]
type UndoArgs = Functions["finance_undo_transaction_category_v1"]["Args"]
type TreatmentArgs = Functions["finance_set_transaction_treatment_v1"]["Args"]

export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in to keep this decision.")
    this.name = "SignInRequiredError"
  }
}

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

async function readLocal(name: string, args: Record<string, unknown>): Promise<Json> {
  const response = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, args }),
  })
  const body = (await response.json()) as { error?: string; data?: Json }
  if (!response.ok || body.error) {
    throw friendlyError(body.error ?? "The ledger could not be read.")
  }
  if (body.data === undefined) {
    throw new Error("The ledger returned an unreadable response.")
  }
  return body.data
}

async function preferLocal(): Promise<boolean> {
  if (process.env.NODE_ENV === "production") return false
  const hasBrowserConfig = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  )
  if (!hasBrowserConfig) return true
  const supabase = getBrowserClient()
  const { data } = await supabase.auth.getSession()
  return !data.session
}

export async function readTransactionList(
  args: Functions["finance_list_transactions_v1"]["Args"],
): Promise<Json> {
  if (await preferLocal()) return readLocal("finance_list_transactions_v1", args)
  const { data, error } = await getBrowserClient().rpc("finance_list_transactions_v1", args)
  if (error) throw friendlyError(error.message)
  return data
}

export async function readTransactionFilters(): Promise<Json> {
  if (await preferLocal()) return readLocal("finance_get_transaction_filters_v1", {})
  const { data, error } = await getBrowserClient().rpc("finance_get_transaction_filters_v1")
  if (error) throw friendlyError(error.message)
  return data
}

export async function readTransactionDetail(transactionId: string): Promise<Json> {
  const args = { p_transaction_id: transactionId }
  if (await preferLocal()) return readLocal("finance_get_transaction_v1", args)
  const { data, error } = await getBrowserClient().rpc("finance_get_transaction_v1", args)
  if (error) throw friendlyError(error.message)
  return data
}

function mutationResult(data: Json): MutationResult {
  const record = asObject(data)
  if (!record.item || typeof record.item !== "object") {
    throw new Error("The ledger returned an unreadable response.")
  }
  return {
    conflict: record.conflict === true,
    idempotent: record.idempotent === true,
    item: record.item as TransactionFeedItem,
  }
}

export async function writeTransactionCategory(args: {
  [Key in keyof CategoryArgs]: CategoryArgs[Key] | null
}): Promise<MutationResult> {
  const supabase = getBrowserClient()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) throw new SignInRequiredError()
  const { data, error } = await supabase.rpc(
    "finance_set_transaction_category_v1",
    args as CategoryArgs,
  )
  if (error) throw friendlyError(error.message)
  return mutationResult(data)
}

export async function writeTransactionUndo(args: {
  [Key in keyof UndoArgs]: UndoArgs[Key] | null
}): Promise<MutationResult> {
  const supabase = getBrowserClient()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) throw new SignInRequiredError()
  const { data, error } = await supabase.rpc(
    "finance_undo_transaction_category_v1",
    args as UndoArgs,
  )
  if (error) throw friendlyError(error.message)
  return mutationResult(data)
}

export async function writeTransactionTreatment(args: {
  [Key in keyof TreatmentArgs]: TreatmentArgs[Key] | null
}): Promise<MutationResult> {
  const supabase = getBrowserClient()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session) throw new SignInRequiredError()
  const { data, error } = await supabase.rpc(
    "finance_set_transaction_treatment_v1",
    args as TreatmentArgs,
  )
  if (error) throw friendlyError(error.message)
  return mutationResult(data)
}
