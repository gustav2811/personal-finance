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

export type ReviewEffectKind =
  | "consumption"
  | "contribution"
  | "required_debt_payment"
  | "extra_debt_payment"
  | "refund"
  | "movement"
  | "unresolved"

export type ReviewComponentInput = {
  amountCents: string
  beneficiaryScope: "shared" | "member"
  beneficiaryMemberId?: string
  effectKind: ReviewEffectKind
  fundId?: string
  categoryId?: string
  originalRefundAllocationId?: string
  openingRefundReason?: string
}

export type ReviewEvidenceInput = {
  receiptReference?: string
  splitReviewReason?: string
  reviewReason?: string
}

const PURPOSE_OUTFLOW = new Set<ReviewEffectKind>([
  "consumption",
  "contribution",
  "required_debt_payment",
  "extra_debt_payment",
])

export function componentSum(components: readonly ReviewComponentInput[]): bigint {
  return components.reduce((total, component) => {
    if (!isCents(component.amountCents)) throw new Error("budget_invalid: amount")
    return total + BigInt(component.amountCents)
  }, BigInt(0))
}

export function isOneConsumptionLine(components: readonly ReviewComponentInput[]): boolean {
  return components.length === 1 && components[0]?.effectKind === "consumption"
}

export function assertReviewEconomics(input: {
  sourceAmountCents: string
  mixed: boolean
  drifted: boolean
  existingComponentCount?: number
  components: readonly ReviewComponentInput[]
  evidence?: ReviewEvidenceInput
}): void {
  if (!isCents(input.sourceAmountCents)) throw new Error("budget_invalid: amount")
  if (input.components.length === 0) throw new Error("budget_invalid: components")
  if (componentSum(input.components) !== BigInt(input.sourceAmountCents)) {
    throw new Error("budget_invalid: split")
  }
  if (input.mixed && isOneConsumptionLine(input.components)) {
    throw new Error("budget_invalid: split")
  }
  if ((input.existingComponentCount ?? 0) > 1 && isOneConsumptionLine(input.components)) {
    throw new Error("budget_invalid: split")
  }
  if (input.mixed && input.components.length < 2) throw new Error("budget_invalid: split")
  const categories = new Set(
    input.components.flatMap((component) => (component.categoryId ? [component.categoryId] : [])),
  )
  if (categories.size > 1 && !input.evidence?.splitReviewReason?.trim()) {
    throw new Error("budget_invalid: split")
  }
  let negative = false
  let positive = false
  for (const component of input.components) {
    if (!isCents(component.amountCents) || component.amountCents === "0") {
      throw new Error("budget_invalid: amount")
    }
    if (component.amountCents.startsWith("-")) negative = true
    else positive = true
    if (component.effectKind === "refund") {
      if (!component.fundId) throw new Error("budget_invalid: fund")
      if (!component.originalRefundAllocationId && !component.openingRefundReason?.trim()) {
        throw new Error("budget_invalid: refund")
      }
    }
    if (PURPOSE_OUTFLOW.has(component.effectKind) && !component.fundId) {
      throw new Error("budget_invalid: fund")
    }
    if (
      (component.effectKind === "movement" || component.effectKind === "unresolved") &&
      component.fundId
    ) {
      throw new Error("budget_invalid: fund")
    }
  }
  if (negative && positive && !input.evidence?.receiptReference?.trim()) {
    throw new Error("budget_invalid: split")
  }
}

export function buildReviewPayload(input: {
  transactionId?: string
  utilityEntryId?: string
  expectedCurrentSetId?: string
  expectedSourceFingerprint: string
  sourceAmountCents: string
  mixed?: boolean
  drifted?: boolean
  existingComponentCount?: number
  components: readonly ReviewComponentInput[]
  evidence?: ReviewEvidenceInput
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
  assertReviewEconomics({
    sourceAmountCents: input.sourceAmountCents,
    mixed: input.mixed === true,
    drifted: input.drifted === true,
    existingComponentCount: input.existingComponentCount,
    components: input.components,
    evidence: input.evidence,
  })
  const payload: Record<string, unknown> = {
    expected_source_fingerprint: input.expectedSourceFingerprint,
    components: input.components.map((component) => ({
      amount_cents: component.amountCents,
      beneficiary_scope: component.beneficiaryScope,
      beneficiary_member_id: component.beneficiaryMemberId ?? null,
      effect_kind: component.effectKind,
      fund_id: component.fundId ?? null,
      category_id: component.categoryId ?? null,
      original_refund_allocation_id: component.originalRefundAllocationId ?? null,
      opening_refund_reason: component.openingRefundReason ?? null,
    })),
    evidence: {
      receipt_reference: input.evidence?.receiptReference?.trim() || null,
      split_review_reason: input.evidence?.splitReviewReason?.trim() || null,
      review_reason: input.evidence?.reviewReason?.trim() || null,
    },
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
  expectedPaymentOn?: string
  expectedPaymentAccountId?: string
  matchCategoryId?: string
}

export type IncomeAssumptionInput = {
  memberId: string
  expectedNetCents: string
  expectedOn: string
  provenance: string
}

export type SourceReferenceInput = {
  source: string
  reference: string
}

export function buildDraftPayload(input: {
  draftId?: string
  expectedDraftRevision?: string | number
  parentVersionId?: string
  startsOnCycle: string
  reason: string
  lines: readonly DraftLineInput[]
  incomeAssumptions?: readonly IncomeAssumptionInput[]
  sourceReferences?: readonly SourceReferenceInput[]
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
      expected_payment_on: line.expectedPaymentOn ?? null,
      expected_payment_account_id: line.expectedPaymentAccountId ?? null,
      match_category_id: line.matchCategoryId ?? null,
    }
  })
  const income = (input.incomeAssumptions ?? []).map((entry) => {
    if (!isCents(entry.expectedNetCents) || entry.expectedNetCents.startsWith("-")) {
      throw new Error("budget_invalid: amount")
    }
    if (entry.provenance.trim().length === 0) throw new Error("budget_invalid: provenance")
    return {
      member_id: entry.memberId,
      expected_net_cents: entry.expectedNetCents,
      expected_on: entry.expectedOn,
      provenance: entry.provenance.trim(),
    }
  })
  const sources = (input.sourceReferences ?? []).map((entry) => {
    if (entry.source.trim().length === 0 || entry.reference.trim().length === 0) {
      throw new Error("budget_invalid: source")
    }
    return { source: entry.source.trim(), reference: entry.reference.trim() }
  })
  return {
    draft_id: input.draftId ?? null,
    expected_draft_revision:
      input.expectedDraftRevision === undefined ? null : jsonInteger(input.expectedDraftRevision),
    parent_version_id: input.parentVersionId ?? null,
    starts_on_cycle: input.startsOnCycle,
    reason: input.reason.trim(),
    income_assumptions: income,
    source_references: sources,
    lines,
  }
}

function jsonInteger(value: string | number): number {
  const text = String(value)
  if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error("budget_invalid: revision")
  const number = Number(text)
  if (!Number.isSafeInteger(number)) throw new Error("budget_invalid: revision")
  return number
}

export function buildPublishPayload(input: {
  draftId: string
  expectedDraftRevision: string | number
  expectedParentVersionId?: string
  expectedLatestVersionNumber: string | number
  reason: string
}): Record<string, string | number> {
  if (input.reason.trim().length === 0) throw new Error("budget_invalid: reason")
  const payload: Record<string, string | number> = {
    draft_id: input.draftId,
    expected_draft_revision: jsonInteger(input.expectedDraftRevision),
    expected_latest_version_number: jsonInteger(input.expectedLatestVersionNumber),
    reason: input.reason.trim(),
  }
  if (input.expectedParentVersionId) payload.expected_parent_version_id = input.expectedParentVersionId
  return payload
}

export function movementInputsReady(input: {
  moveMoney: boolean
  amountCents: string | null
  fromFundId: string
  toFundId: string
  reconciliationFingerprint: string | null
}): boolean {
  if (!input.moveMoney) return true
  return Boolean(
    input.amountCents &&
      input.fromFundId &&
      input.toFundId &&
      input.fromFundId !== input.toFundId &&
      input.reconciliationFingerprint,
  )
}

export function buildPublishWithMovementPayload(input: {
  publishCommandId: string
  moveCommandId: string
  publish: ReturnType<typeof buildPublishPayload>
  movement: Omit<MoveFundsInput, "expectedVersionId">
}): Record<string, unknown> {
  const movement = buildMoveFundsPayload({ ...input.movement, expectedVersionId: input.publishCommandId })
  delete movement.expected_version_id
  return {
    publish_command_id: input.publishCommandId,
    move_command_id: input.moveCommandId,
    publish: input.publish,
    movement,
  }
}

const OWNER_SCOPES = ["shared", "member"] as const
const RESOURCE_CLASSES = ["liquid", "restricted", "mortgage", "card", "tracking_only"] as const
const SIGN_CONVENTIONS = ["outflow_negative", "outflow_positive", "unknown"] as const
const COVERAGE_STATUS = ["included", "excluded", "missing"] as const
const BALANCE_CONVENTIONS = ["cash_signed", "debt_positive", "debt_negative", "unknown"] as const
const UTILITY_STATUS = ["not_required", "verified", "unknown"] as const
const FUND_STATUS = ["active", "retired"] as const

function requireText(value: string, code: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new Error(code)
  return trimmed
}

export function buildConfigureAccountPayload(input: {
  accountId: string
  expectedSettingsFingerprint?: string
  ownerScope: "shared" | "member"
  ownerMemberId?: string
  included: boolean
  exclusionReason?: string
  resourceClass: (typeof RESOURCE_CLASSES)[number]
  settlementAccountId?: string
  usualDueDay?: number
  freshnessHours: number
  transactionSignConvention: (typeof SIGN_CONVENTIONS)[number]
  signEvidence?: string
  utilityDeviceId?: string
}): Record<string, unknown> {
  if (!OWNER_SCOPES.includes(input.ownerScope)) throw new Error("budget_invalid: owner")
  if (input.ownerScope === "shared" && input.ownerMemberId) throw new Error("budget_invalid: owner")
  if (input.ownerScope === "member" && !input.ownerMemberId) throw new Error("budget_invalid: owner")
  if (!RESOURCE_CLASSES.includes(input.resourceClass)) throw new Error("budget_invalid: class")
  if (input.included && input.resourceClass === "tracking_only") throw new Error("budget_invalid: class")
  if (!input.included && !input.exclusionReason?.trim()) throw new Error("budget_invalid: exclusion")
  if (!SIGN_CONVENTIONS.includes(input.transactionSignConvention)) throw new Error("budget_invalid: sign")
  if (input.transactionSignConvention !== "unknown" && !input.signEvidence?.trim()) {
    throw new Error("budget_invalid: sign")
  }
  if (!Number.isInteger(input.freshnessHours) || input.freshnessHours < 1) {
    throw new Error("budget_invalid: freshness")
  }
  if (input.usualDueDay !== undefined && (input.usualDueDay < 1 || input.usualDueDay > 31)) {
    throw new Error("budget_invalid: due")
  }
  return {
    account_id: input.accountId,
    expected_settings_fingerprint: input.expectedSettingsFingerprint ?? null,
    owner_scope: input.ownerScope,
    owner_member_id: input.ownerMemberId ?? null,
    included: input.included,
    exclusion_reason: input.exclusionReason?.trim() || null,
    resource_class: input.resourceClass,
    settlement_account_id: input.settlementAccountId ?? null,
    usual_due_day: input.usualDueDay ?? null,
    freshness_hours: input.freshnessHours,
    transaction_sign_convention: input.transactionSignConvention,
    sign_evidence: input.signEvidence?.trim() || null,
    utility_device_id: input.utilityDeviceId ?? null,
  }
}

export type CoverageAccountInput = {
  accountId: string
  status: (typeof COVERAGE_STATUS)[number]
  settingsFingerprint?: string
  snapshotDate?: string
  snapshotFingerprint?: string
  balanceConvention: (typeof BALANCE_CONVENTIONS)[number]
  activityThrough?: string
  pendingIncludedIds: readonly string[]
  eligibleRestrictedCents?: string
  restrictedEvidence?: string
  evidence: string
}

export function buildReconciliationPayload(input: {
  asOf: string
  openingFundCutover?: string
  notes: string
  evidence: string
  utilityStatus: (typeof UTILITY_STATUS)[number]
  utilityEvidence: string
  accounts: readonly CoverageAccountInput[]
}): Record<string, unknown> {
  if (input.accounts.length === 0) throw new Error("budget_invalid: inventory")
  const seen = new Set<string>()
  const accounts = input.accounts.map((account) => {
    if (seen.has(account.accountId)) throw new Error("budget_invalid: account")
    seen.add(account.accountId)
    if (!COVERAGE_STATUS.includes(account.status)) throw new Error("budget_invalid: status")
    if (!BALANCE_CONVENTIONS.includes(account.balanceConvention)) throw new Error("budget_invalid: convention")
    if (account.status !== "missing" && !account.settingsFingerprint) throw new Error("budget_invalid: fingerprint")
    if (Boolean(account.snapshotDate) !== Boolean(account.snapshotFingerprint)) {
      throw new Error("budget_invalid: snapshot")
    }
    if (Boolean(account.eligibleRestrictedCents) !== Boolean(account.restrictedEvidence?.trim())) {
      throw new Error("budget_invalid: restricted")
    }
    if (account.eligibleRestrictedCents && !isCents(account.eligibleRestrictedCents)) {
      throw new Error("budget_invalid: amount")
    }
    return {
      account_id: account.accountId,
      status: account.status,
      settings_fingerprint: account.settingsFingerprint ?? null,
      snapshot_date: account.snapshotDate ?? null,
      snapshot_fingerprint: account.snapshotFingerprint ?? null,
      balance_convention: account.balanceConvention,
      activity_through: account.activityThrough ?? null,
      pending_included_ids: [...account.pendingIncludedIds],
      eligible_restricted_cents: account.eligibleRestrictedCents ?? null,
      restricted_evidence: account.restrictedEvidence?.trim() || null,
      evidence: requireText(account.evidence, "budget_invalid: evidence"),
    }
  })
  return {
    as_of: input.asOf,
    opening_fund_cutover: input.openingFundCutover ?? null,
    notes: requireText(input.notes, "budget_invalid: notes"),
    coverage_snapshot: {
      schema_version: 1,
      accounts,
      utility_coverage: {
        status: input.utilityStatus,
        evidence: requireText(input.utilityEvidence, "budget_invalid: evidence"),
      },
      evidence: requireText(input.evidence, "budget_invalid: evidence"),
    },
  }
}

export function buildCreateFundPayload(input: {
  name: string
  beneficiaryScope: "shared" | "member"
  beneficiaryMemberId?: string
}): Record<string, string | null> {
  const name = requireText(input.name, "budget_invalid: name")
  if (input.beneficiaryScope === "member" && !input.beneficiaryMemberId) throw new Error("budget_invalid: beneficiary")
  if (input.beneficiaryScope === "shared" && input.beneficiaryMemberId) throw new Error("budget_invalid: beneficiary")
  return {
    name,
    beneficiary_scope: input.beneficiaryScope,
    beneficiary_member_id: input.beneficiaryMemberId ?? null,
  }
}

export function buildUpdateFundPayload(input: {
  fundId: string
  expectedName: string
  expectedStatus: "active" | "retired"
  name: string
  status: "active" | "retired"
}): Record<string, string> {
  if (!FUND_STATUS.includes(input.expectedStatus) || !FUND_STATUS.includes(input.status)) {
    throw new Error("budget_invalid: status")
  }
  return {
    fund_id: input.fundId,
    expected_name: requireText(input.expectedName, "budget_invalid: name"),
    expected_status: input.expectedStatus,
    name: requireText(input.name, "budget_invalid: name"),
    status: input.status,
  }
}

export function buildEarmarkPayload(input: {
  fundId: string
  restrictedAccountId: string
  amountCents: string
  effectiveOn: string
  reason: string
  expectedReconciliationId: string
  expectedReconciliationFingerprint: string
  link: {
    fundMovementId?: string
    allocationId?: string
    financialEventId?: string
    reconciliationId?: string
  }
}): Record<string, unknown> {
  if (!isCents(input.amountCents) || input.amountCents === "0" || input.amountCents === "-0") {
    throw new Error("budget_invalid: amount")
  }
  const links = [
    input.link.fundMovementId,
    input.link.allocationId,
    input.link.financialEventId,
    input.link.reconciliationId,
  ].filter((value) => value)
  if (links.length !== 1) throw new Error("budget_invalid: link")
  return {
    fund_id: input.fundId,
    restricted_account_id: input.restrictedAccountId,
    amount_cents: input.amountCents,
    effective_on: input.effectiveOn,
    reason: requireText(input.reason, "budget_invalid: reason"),
    expected_reconciliation_id: input.expectedReconciliationId,
    expected_reconciliation_fingerprint: input.expectedReconciliationFingerprint,
    link: {
      fund_movement_id: input.link.fundMovementId ?? null,
      allocation_id: input.link.allocationId ?? null,
      financial_event_id: input.link.financialEventId ?? null,
      reconciliation_id: input.link.reconciliationId ?? null,
    },
  }
}

export function buildCorrectMovementPayload(input: {
  movementId: string
  expectedReconciliationId: string
  expectedReconciliationFingerprint: string
  reason: string
  replacement?: {
    kind: "opening" | "assign" | "release" | "reallocate"
    fromFundId?: string
    toFundId?: string
    amountCents: string
    effectiveOn: string
    budgetVersionId?: string
  }
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    movement_id: input.movementId,
    expected_reconciliation_id: input.expectedReconciliationId,
    expected_reconciliation_fingerprint: input.expectedReconciliationFingerprint,
    reason: requireText(input.reason, "budget_invalid: reason"),
  }
  if (!input.replacement) return payload
  if (!isPositiveCents(input.replacement.amountCents)) throw new Error("budget_invalid: amount")
  const kind = input.replacement.kind
  if (
    (kind === "opening" || kind === "assign") &&
    (input.replacement.fromFundId || !input.replacement.toFundId)
  ) {
    throw new Error("budget_invalid: fund")
  }
  if (kind === "release" && (!input.replacement.fromFundId || input.replacement.toFundId)) {
    throw new Error("budget_invalid: fund")
  }
  if (
    kind === "reallocate" &&
    (!input.replacement.fromFundId ||
      !input.replacement.toFundId ||
      input.replacement.fromFundId === input.replacement.toFundId)
  ) {
    throw new Error("budget_invalid: fund")
  }
  payload.replacement = {
    kind,
    from_fund_id: input.replacement.fromFundId ?? null,
    to_fund_id: input.replacement.toFundId ?? null,
    amount_cents: input.replacement.amountCents,
    effective_on: input.replacement.effectiveOn,
    budget_version_id: input.replacement.budgetVersionId ?? null,
  }
  return payload
}
