import type { MutationResult } from "./model"
import { writeTransactionCategory, writeTransactionTreatment, writeTransactionUndo } from "./rpc"

export function setTransactionCategory(input: {
  transactionId: string
  categoryId: string
  expectedConfirmedClassificationId: string | null
  expectedProposedClassificationId: string | null
  reviewCommandId: string
}): Promise<MutationResult> {
  return writeTransactionCategory({
    p_category_id: input.categoryId,
    p_expected_confirmed_classification_id: input.expectedConfirmedClassificationId,
    p_expected_proposed_classification_id: input.expectedProposedClassificationId,
    p_review_command_id: input.reviewCommandId,
    p_transaction_id: input.transactionId,
  })
}

export function undoTransactionCategory(input: {
  transactionId: string
  categoryId: string | null
  expectedConfirmedClassificationId: string | null
  reviewCommandId: string
}): Promise<MutationResult> {
  return writeTransactionUndo({
    p_category_id: input.categoryId,
    p_expected_confirmed_classification_id: input.expectedConfirmedClassificationId,
    p_review_command_id: input.reviewCommandId,
    p_transaction_id: input.transactionId,
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
  return writeTransactionTreatment({
    p_exclude_from_spend: input.excludeFromSpend,
    p_expected_confirmed_treatment_id: input.expectedConfirmedTreatmentId,
    p_expected_proposed_treatment_id: input.expectedProposedTreatmentId,
    p_is_transfer: input.isTransfer,
    p_nature: input.nature,
    p_review_command_id: input.reviewCommandId,
    p_transaction_id: input.transactionId,
  })
}
