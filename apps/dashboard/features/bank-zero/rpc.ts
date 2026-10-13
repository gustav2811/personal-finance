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
  replay_status: string | null
  replay_error: string | null
  received_at: string
  source_expired_at: string | null
  raw_values: Record<string, unknown>
  parsed_values: Record<string, unknown>
  candidate_movements: BankZeroCandidate[]
}

export type BankZeroOpsSummary = {
  receipt_processing_p95_seconds: number | null
  unclassified_templates: number
  unresolved_account_routes: number
  match_outcomes: { matched: number; needs_review: number; deferred: number }
  reconciliation_older_than_24h: number
  publication_backlog: number
  unknown_publication_outcomes: number
  exhausted_publication_retries: number
  statement_balance_gaps: number | null
  routes: Array<{ route_key: string; status: string; unresolved_observations: number }>
}

export async function getBankZeroOpsSummary(): Promise<BankZeroOpsSummary> {
  const { data, error } = await getBrowserClient().rpc("bank_zero_ops_summary_v1" as never, {} as never)
  if (error) throw new Error(error.message)
  if (!data || typeof data !== "object") throw new Error("Could not load Bank Zero operational summary")
  return data as BankZeroOpsSummary
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

export async function adoptUncertainBankZeroCreate(observationId: string, finwiseTransactionId: string): Promise<void> {
  const { error } = await getBrowserClient().rpc("bank_zero_adopt_uncertain_create_v1" as never, {
    p_observation_id: observationId,
    p_finwise_transaction_id: finwiseTransactionId.trim(),
  } as never)
  if (error) throw new Error(error.message)
}
