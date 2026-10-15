import type { Database, Json } from "@/lib/supabase/database.types"
import { demoEnabled, demoRpc } from "@/lib/demo/transactions"
import { getBrowserClient } from "@/lib/supabase/browser"

export class SignInRequiredError extends Error {
  constructor() {
    super("Sign in to keep this decision.")
    this.name = "SignInRequiredError"
  }
}

export function friendlyError(message: string): Error {
  if (message.includes("reviewer identity is not available"))
    return new SignInRequiredError()
  if (message.includes("not a household member"))
    return new Error("This Google account is not on the household ledger.")
  if (message.includes("category is not active"))
    return new Error("That category is no longer available.")
  if (message.includes("transaction not found"))
    return new Error("That movement is no longer in the ledger.")
  if (message.includes("event membership"))
    return new Error(
      "This movement belongs to an event. Treatment cannot be changed here.",
    )
  if (message.includes("invalid cursor"))
    return new Error("The ledger page expired. Refresh the list.")
  return new Error("The ledger could not complete that request.")
}

export async function readTransactionList(
  args: Database["public"]["Functions"]["finance_list_transactions_v1"]["Args"],
): Promise<Json> {
  if (demoEnabled())
    return demoRpc("finance_list_transactions_v1", args) as Json
  const { data, error } = await getBrowserClient().rpc(
    "finance_list_transactions_v1",
    args,
  )
  if (error) throw friendlyError(error.message)
  return data
}

export async function readTransactionFilters(): Promise<Json> {
  if (demoEnabled())
    return demoRpc("finance_get_transaction_filters_v1", {}) as Json
  const { data, error } = await getBrowserClient().rpc(
    "finance_get_transaction_filters_v1",
  )
  if (error) throw friendlyError(error.message)
  return data
}

export async function readTransactionDetail(
  transactionId: string,
): Promise<Json> {
  const args = { p_transaction_id: transactionId }
  if (demoEnabled()) return demoRpc("finance_get_transaction_v1", args) as Json
  const { data, error } = await getBrowserClient().rpc(
    "finance_get_transaction_v1",
    args,
  )
  if (error) throw friendlyError(error.message)
  return data
}
