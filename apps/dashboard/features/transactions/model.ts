export type Provenance = "user" | "policy" | "jev" | "agent" | "source" | "none"

export type CategoryState = "confirmed" | "proposed" | "source_only" | "unclassified"

export type TreatmentState = "confirmed" | "proposed" | "source_only" | "unknown"

export type ClassifierState = "not_run" | "succeeded" | "abstained" | "failed"

export type ReviewState =
  | "confirmed"
  | "jev_agrees"
  | "jev_disagrees"
  | "jev_proposed"
  | "unclassified"
  | "awaiting_classifier"
  | "classifier_abstained"
  | "classifier_failed"

export const REVIEW_QUEUE = [
  "jev_disagrees",
  "jev_proposed",
  "unclassified",
  "classifier_abstained",
  "classifier_failed",
] as const satisfies readonly ReviewState[]

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

export type MutationResult = {
  conflict: boolean
  idempotent: boolean
  item: TransactionFeedItem
}

export type ClassificationRecord = {
  categoryName: string
  decisionSource: string
  status: string
  confidence: number | null
}

export type ClassifierRunRecord = {
  classifier: string
  status: string
  confidence: number | null
  abstained: boolean
  categoryName: string | null
}

export type TransactionInspection = {
  classifications: ClassificationRecord[]
  runs: ClassifierRunRecord[]
}
