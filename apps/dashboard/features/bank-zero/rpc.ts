import { getBrowserClient } from "@/lib/supabase/browser"

export type BankZeroCandidate = {
  movement_id: string
  account_id: string
  amount: number
  currency_code: string
  occurred_at: string | null
  posted_on: string | null
  description: string
  reconciliation_state: string
  publication_state: string
  finwise_transaction_id: string | null
}

export type BankZeroReviewItem = {
  observation_id: string
  received_email_id: string
  route_key: string
  status: string
  kind: string
  reason: string | null
  received_at: string
  source_expired_at: string | null
  raw_values: Record<string, unknown>
  parsed_values: Record<string, unknown>
  candidate_movements: BankZeroCandidate[]
}

export async function listBankZeroReview(): Promise<BankZeroReviewItem[]> {
  const { data, error } = await getBrowserClient().rpc("bank_zero_list_review_v1" as never, { p_limit: 50 } as never)
  if (error) throw new Error(error.message)
  const result = data as { items?: unknown } | null
  return Array.isArray(result?.items) ? result.items as BankZeroReviewItem[] : []
}

export async function reviewBankZeroObservation(
  observationId: string,
  action: "associate" | "dismiss" | "replay",
  movementId?: string,
): Promise<void> {
  const { error } = await getBrowserClient().rpc("bank_zero_review_observation_v1" as never, {
    p_observation_id: observationId,
    p_action: action,
    p_movement_id: movementId ?? null,
  } as never)
  if (error) throw new Error(error.message)
}
