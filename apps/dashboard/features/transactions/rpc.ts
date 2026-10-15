import type { Database, Json } from "@/lib/supabase/database.types"
import { demoEnabled, demoRpc } from "@/lib/demo/transactions"
import { getBrowserClient } from "@/lib/supabase/browser"
import type { MutationResult, TransactionFeedItem } from "./model"
import { friendlyError } from "@/lib/finance/transaction-read"
export { SignInRequiredError } from "@/lib/finance/transaction-read"
export { readTransactionDetail, readTransactionFilters, readTransactionList } from "@/lib/finance/transaction-read"

type Functions = Database["public"]["Functions"]
type CategoryArgs = Functions["finance_set_transaction_category_v1"]["Args"]
type UndoArgs = Functions["finance_undo_transaction_category_v1"]["Args"]
type TreatmentArgs = Functions["finance_set_transaction_treatment_v1"]["Args"]

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new Error("The ledger returned an unreadable response.")
  }
  return value as Record<string, unknown>
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
  if (demoEnabled()) return mutationResult(demoRpc("finance_set_transaction_category_v1", args) as Json)
  const supabase = getBrowserClient()
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
  if (demoEnabled()) return mutationResult(demoRpc("finance_undo_transaction_category_v1", args) as Json)
  const supabase = getBrowserClient()
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
  if (demoEnabled()) return mutationResult(demoRpc("finance_set_transaction_treatment_v1", args) as Json)
  const supabase = getBrowserClient()
  const { data, error } = await supabase.rpc(
    "finance_set_transaction_treatment_v1",
    args as TreatmentArgs,
  )
  if (error) throw friendlyError(error.message)
  return mutationResult(data)
}


export async function writeTransactionReview(args: {
  p_transaction_id: string
  p_category_id: string | null
  p_description: string
  p_notes: string | null
  p_is_transfer: boolean | null
  p_exclude_from_spend: boolean | null
  p_nature: string | null
  p_expected: {
    description: string
    notes: string | null
    confirmedClassificationId: string | null
    proposedClassificationId: string | null
    confirmedTreatmentId: string | null
    proposedTreatmentId: string | null
  }
  p_review_command_id: string
}): Promise<MutationResult> {
  if (demoEnabled()) return mutationResult(demoRpc("finance_review_transaction_v1", args) as Json)
  // Introduced by the review migration; keep the generated database types untouched.
  const { data, error } = await getBrowserClient().rpc(
    "finance_review_transaction_v1" as never,
    args as never,
  )
  if (error) throw friendlyError(error.message)
  return mutationResult(data)
}
