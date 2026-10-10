import { isCents, isPositiveCents } from "./money"

export function newCommandId(): string {
  return crypto.randomUUID()
}

export type MoveKind = "assign" | "release" | "reallocate"

export type MoveFundsInput = {
  kind: MoveKind
  fromFundId?: string
  toFundId?: string
  amountCents: string
  effectiveOn: string
  expectedVersionId: string
  expectedReconciliationId: string
  expectedReconciliationFingerprint: string
  reason: string
}

export function buildMoveFundsPayload(input: MoveFundsInput): Record<string, string> {
  if (!isPositiveCents(input.amountCents)) {
    throw new Error("budget_invalid: amount")
  }
  if (input.reason.trim().length === 0) {
    throw new Error("budget_invalid: reason")
  }
  if (input.kind === "assign" && !input.toFundId) throw new Error("budget_invalid: fund")
  if (input.kind === "release" && !input.fromFundId) throw new Error("budget_invalid: fund")
  if (input.kind === "reallocate" && (!input.fromFundId || !input.toFundId || input.fromFundId === input.toFundId)) {
    throw new Error("budget_invalid: fund")
  }
  const payload: Record<string, string> = {
    kind: input.kind,
    amount_cents: input.amountCents,
    effective_on: input.effectiveOn,
    expected_version_id: input.expectedVersionId,
    expected_reconciliation_id: input.expectedReconciliationId,
    expected_reconciliation_fingerprint: input.expectedReconciliationFingerprint,
    reason: input.reason.trim(),
  }
  if (input.fromFundId) payload.from_fund_id = input.fromFundId
  if (input.toFundId) payload.to_fund_id = input.toFundId
  return payload
}

export type ReviewComponentInput = {
  amountCents: string
  beneficiaryScope: "shared" | "member"
  beneficiaryMemberId?: string
  effectKind: "consumption" | "contribution" | "required_debt_payment" | "extra_debt_payment" | "refund" | "movement" | "unresolved"
  fundId?: string
  categoryId?: string
}

export function buildReviewPayload(input: {
  transactionId?: string
  utilityEntryId?: string
  expectedCurrentSetId?: string
  expectedSourceFingerprint: string
  components: readonly ReviewComponentInput[]
  decisionUpdate?: {
    categoryId: string
    isTransfer: boolean
    excludeFromSpend: boolean
    nature?: string
  }
}): Record<string, unknown> {
  if (Boolean(input.transactionId) === Boolean(input.utilityEntryId)) {
    throw new Error("budget_invalid: source")
  }
  if (input.components.length === 0) throw new Error("budget_invalid: components")
  const payload: Record<string, unknown> = {
    expected_source_fingerprint: input.expectedSourceFingerprint,
    components: input.components.map((component) => ({
      amount_cents: component.amountCents,
      beneficiary_scope: component.beneficiaryScope,
      beneficiary_member_id: component.beneficiaryMemberId ?? null,
      effect_kind: component.effectKind,
      fund_id: component.fundId ?? null,
      category_id: component.categoryId ?? null,
    })),
    evidence: {},
  }
  if (input.transactionId) payload.transaction_id = input.transactionId
  if (input.utilityEntryId) payload.utility_entry_id = input.utilityEntryId
  if (input.expectedCurrentSetId) payload.expected_current_set_id = input.expectedCurrentSetId
  if (input.decisionUpdate) {
    payload.decision_update = {
      category_id: input.decisionUpdate.categoryId,
      is_transfer: input.decisionUpdate.isTransfer,
      exclude_from_spend: input.decisionUpdate.excludeFromSpend,
      nature: input.decisionUpdate.nature ?? null,
    }
  }
  return payload
}

export type DraftLineInput = {
  stableLineId: string
  fundId: string
  name: string
  kind: "consumption" | "contribution" | "debt_commitment"
  contributionCents: string
  fundingBehaviour: "cycle_allowance" | "accumulating" | "target_by_date" | "reserve_target"
  beneficiaryScope: "shared" | "member"
  beneficiaryMemberId?: string
  plannedPayerMemberId?: string
  targetCents?: string
  dueOn?: string
  recurrence: "cycle" | "annual" | "once"
  rolloverPolicy: "carry" | "release_explicit"
  categoryId?: string
  categoryNameSnapshot?: string
  groupNameSnapshot?: string
}

export function buildDraftPayload(input: {
  draftId?: string
  expectedDraftRevision?: string
  parentVersionId?: string
  startsOnCycle: string
  reason: string
  lines: readonly DraftLineInput[]
}): Record<string, unknown> {
  if (input.reason.trim().length === 0) throw new Error("budget_invalid: reason")
  if (input.lines.length === 0) throw new Error("budget_invalid: lines")
  const fundIds = new Set<string>()
  const lines = input.lines.map((line) => {
    if (!isCents(line.contributionCents) || line.contributionCents.startsWith("-")) {
      throw new Error("budget_invalid: amount")
    }
    if (fundIds.has(line.fundId)) throw new Error("budget_invalid: fund")
    fundIds.add(line.fundId)
    if (line.fundingBehaviour === "target_by_date" && (!line.targetCents || !line.dueOn)) {
      throw new Error("budget_invalid: target")
    }
    if (line.recurrence !== "cycle" && line.recurrence !== "annual" && line.recurrence !== "once") {
      throw new Error("budget_invalid: recurrence")
    }
    if (line.rolloverPolicy !== "carry" && line.rolloverPolicy !== "release_explicit") {
      throw new Error("budget_invalid: rollover")
    }
    return {
      stable_line_id: line.stableLineId,
      fund_id: line.fundId,
      name: line.name,
      kind: line.kind,
      contribution_cents: line.contributionCents,
      funding_behaviour: line.fundingBehaviour,
      beneficiary_scope: line.beneficiaryScope,
      beneficiary_member_id: line.beneficiaryMemberId ?? null,
      planned_payer_member_id: line.plannedPayerMemberId ?? null,
      target_cents: line.targetCents ?? null,
      due_on: line.dueOn ?? null,
      recurrence: line.recurrence,
      rollover_policy: line.rolloverPolicy,
      category_id: line.categoryId ?? null,
      category_name_snapshot: line.categoryNameSnapshot ?? null,
      group_name_snapshot: line.groupNameSnapshot ?? null,
    }
  })
  return {
    draft_id: input.draftId ?? null,
    expected_draft_revision: input.expectedDraftRevision ?? null,
    parent_version_id: input.parentVersionId ?? null,
    starts_on_cycle: input.startsOnCycle,
    reason: input.reason.trim(),
    income_assumptions: [],
    source_references: [],
    lines,
  }
}

export function buildPublishPayload(input: {
  draftId: string
  expectedDraftRevision: string
  expectedParentVersionId?: string
  expectedLatestVersionNumber: string
  reason: string
}): Record<string, string> {
  if (input.reason.trim().length === 0) throw new Error("budget_invalid: reason")
  const payload: Record<string, string> = {
    draft_id: input.draftId,
    expected_draft_revision: input.expectedDraftRevision,
    expected_latest_version_number: input.expectedLatestVersionNumber,
    reason: input.reason.trim(),
  }
  if (input.expectedParentVersionId) payload.expected_parent_version_id = input.expectedParentVersionId
  return payload
}
