import { copy, reasonSentence } from "./copy"
import { formatDayMonth } from "./cycle"
import { memberName, type MemberRef } from "./members"
import { compareCents, formatCents, isNegativeCents, parseCents } from "./money"
import { readArray, readReasons, readRecord, readString } from "./wire"

export type ReviewReason = {
  code: string
  sentence: string
}

export type ReviewFund = {
  id: string
  name: string
}

export type ReviewItem = {
  reviewKey: string
  kind: string
  severity: string
  occurredOn: string | null
  sourceTransactionId: string | null
  utilityEntryId: string | null
  amount: string
  fundId: string | null
  amountCents: string | null
  impactCents: string | null
  reasons: ReviewReason[]
  payerSentence: string | null
  fingerprint: string | null
  setId: string | null
  sourceAmountCents: string | null
  drifted: boolean
  siblingCount: number
  submittable: boolean
  unresolved: string | null
  provisional: boolean
  excluded: string | null
  decisionsConfirmed: boolean
}

export type RefundablePurchase = {
  allocationId: string
  fundId: string
  label: string
}

export type ReviewQueue = {
  items: ReviewItem[]
  reasons: ReviewReason[]
  partial: boolean
}

function present(value: string | null): string | null {
  if (!value || value.trim().length === 0) return null
  return value
}

function payerId(record: Record<string, unknown>, provenance: Record<string, unknown> | null): string | null {
  const snapshot = provenance ? readRecord(provenance.source_snapshot) : null
  return (
    (provenance ? readString(provenance, "paid_by_member_id") : null) ??
    (snapshot ? readString(snapshot, "paid_by_member_id") : null) ??
    (snapshot ? readString(snapshot, "owner_member_id") : null) ??
    readString(record, "paid_by_member_id")
  )
}

export function reviewFingerprint(provenance: unknown): string | null {
  const record = readRecord(provenance)
  if (!record) return null
  const snapshot = readRecord(record.source_snapshot)
  // The allocation command checks the live source snapshot, not the frozen copy.
  const live =
    present(readString(record, "current_fingerprint")) ??
    present(snapshot ? readString(snapshot, "source_fingerprint") : null)
  return live ?? present(readString(record, "frozen_fingerprint"))
}

function sentences(value: unknown): ReviewReason[] {
  return readReasons(value).map((reason) => ({
    code: reason.code,
    sentence: reasonSentence(reason.code),
  }))
}

function itemOf(value: unknown, index: number, members: readonly MemberRef[]): ReviewItem | null {
  const record = readRecord(value)
  if (!record) return null
  const provenance = readRecord(record.provenance)
  const sourceTransactionId = present(readString(record, "source_transaction_id"))
  const utilityEntryId = present(readString(record, "utility_entry_id"))
  const fingerprint = reviewFingerprint(provenance)
  const amountCents = parseCents(record.amount_cents)
  const impactCents = parseCents(record.impact_cents)
  const paidBy = memberName(members, payerId(record, provenance))
  const reviewKey =
    present(readString(record, "review_key")) ?? sourceTransactionId ?? utilityEntryId ?? `item:${index}`
  const bankSource = (sourceTransactionId !== null) !== (utilityEntryId !== null)
  const drifted = kindIsDrifted(readString(record, "kind"), sentences(record.reasons))
  const sourceAmount = sourceAmountCents(record, amountCents)
  return {
    reviewKey,
    kind: readString(record, "kind") ?? "",
    severity: readString(record, "severity") ?? "",
    occurredOn: readString(record, "occurred_on"),
    sourceTransactionId,
    utilityEntryId,
    amount: formatCents(amountCents),
    fundId: present(readString(record, "fund_id")),
    amountCents,
    impactCents,
    reasons: sentences(record.reasons),
    payerSentence: paidBy ? `${copy.actualPayer} ${paidBy}` : null,
    fingerprint,
    setId: provenance ? present(readString(provenance, "set_id")) : null,
    sourceAmountCents: sourceAmount,
    drifted,
    siblingCount: 1,
    submittable: bankSource && fingerprint !== null && sourceAmount !== null,
    unresolved: fingerprint === null || sourceAmount === null ? copy.somethingUnresolved : null,
    provisional: provenance ? readString(provenance, "status") === "needs_review" : false,
    excluded: readString(record, "kind") === "resource_reason" ? "Excluded from spend until the missing fact is reconciled." : null,
    decisionsConfirmed: decisionsConfirmedOf(record, provenance),
  }
}

const REFUNDABLE_EFFECTS = new Set(["consumption", "contribution", "required_debt_payment", "extra_debt_payment"])
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function decisionsConfirmedOf(record: Record<string, unknown>, provenance: Record<string, unknown> | null): boolean {
  if (present(readString(record, "utility_entry_id")) && !present(readString(record, "source_transaction_id"))) return true
  const snapshot = provenance ? readRecord(provenance.source_snapshot) : null
  if (snapshot && ("classification_id" in snapshot || "treatment_id" in snapshot)) {
    return present(readString(snapshot, "classification_id")) !== null && present(readString(snapshot, "treatment_id")) !== null
  }
  const kind = readString(record, "kind")
  return kind === "allocation" || kind === "source_drift"
}

function purchaseLabel(input: {
  name: string
  occurredOn: string | null
  amountCents: string
  payer: string | null
}): string {
  let when = ""
  if (input.occurredOn) {
    try {
      when = formatDayMonth(input.occurredOn)
    } catch {
      when = ""
    }
  }
  const paid = input.payer ? `Paid by ${input.payer}` : ""
  return [input.name, when, formatCents(input.amountCents), paid].filter((part) => part.length > 0).join(" · ")
}

export function refundablePurchases(input: {
  entries: readonly unknown[]
  funds: readonly { id: string; name: string }[]
  members: readonly MemberRef[]
}): RefundablePurchase[] {
  const fundNames = new Map(input.funds.map((fund) => [fund.id, fund.name]))
  const seen = new Set<string>()
  return input.entries.flatMap((entry) => {
    const record = readRecord(entry)
    if (!record) return []
    const allocationId = present(readString(record, "allocation_id"))
    const fundId = present(readString(record, "fund_id"))
    const effect = readString(record, "effect_kind")
    const amount = parseCents(record.amount_cents)
    const status = readString(record, "status")
    if (!allocationId || !fundId || !effect || !amount || !REFUNDABLE_EFFECTS.has(effect)) return []
    if (!isNegativeCents(amount) || status === "superseded" || seen.has(allocationId)) return []
    seen.add(allocationId)
    const snapshot = readString(record, "category_name_snapshot")
    const name = snapshot && !UUID.test(snapshot) ? snapshot : (fundNames.get(fundId) ?? "Purchase")
    return [
      {
        allocationId,
        fundId,
        label: purchaseLabel({
          name,
          occurredOn: readString(record, "occurred_on"),
          amountCents: absolutePurchase(amount),
          payer: memberName(input.members, readString(record, "paid_by_member_id")),
        }),
      },
    ]
  })
}

function absolutePurchase(cents: string): string {
  return isNegativeCents(cents) ? cents.slice(1) : cents
}

function kindIsDrifted(kind: string | null, reasons: readonly ReviewReason[]): boolean {
  return isDriftedReview({ kind: kind ?? "", reasons })
}

export function oneFormPerSource(items: readonly ReviewItem[]): ReviewItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.sourceTransactionId ?? item.utilityEntryId ?? item.reviewKey
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function byImpact(left: ReviewItem, right: ReviewItem): number {
  if (left.impactCents === null && right.impactCents === null) return 0
  if (left.impactCents === null) return 1
  if (right.impactCents === null) return -1
  return compareCents(left.impactCents, right.impactCents)
}

export function isDriftedReview(item: { kind: string; reasons: readonly { code: string }[] }): boolean {
  if (item.kind === "source_drift") return true
  return item.reasons.some((reason) => reason.code === "source_fingerprint_drift")
}

export function sourceAmountCents(record: Record<string, unknown> | null, fallback: string | null): string | null {
  const provenance = record ? readRecord(record.provenance) : null
  const live = provenance ? parseCents(provenance.live_source_amount_cents) : null
  if (live) return live
  const snapshot = provenance ? readRecord(provenance.source_snapshot) : null
  const fromSnapshot = snapshot ? parseCents(snapshot.amount_cents) : null
  if (fromSnapshot) return fromSnapshot
  const kind = record ? readString(record, "kind") : null
  // A queue row for an existing allocation is one component, not the live source total.
  if (kind === "source_drift" || kind === "allocation") return null
  return fallback
}

export function alreadyApproved(input: { inQueue: boolean; status: string | null; drifted: boolean }): boolean {
  if (input.drifted || input.inQueue) return false
  return input.status === "current"
}

export function reviewFunds(overview: unknown): ReviewFund[] {
  const record = readRecord(overview)
  const seen = new Set<string>()
  return readArray(record?.funds).flatMap((entry) => {
    const fund = readRecord(entry)
    const id = fund ? present(readString(fund, "fund_id")) : null
    const name = fund ? present(readString(fund, "name")) : null
    if (!fund || !id || !name || seen.has(id)) return []
    seen.add(id)
    return [{ id, name }]
  })
}

export function projectReviewQueue(input: {
  queue: unknown
  members: readonly MemberRef[]
  partial?: boolean
}): ReviewQueue {
  const record = readRecord(input.queue)
  const source = Array.isArray(record?.items) ? record.items : readArray(record?.entries)
  const items = source.flatMap((entry, index) => {
    const item = itemOf(entry, index, input.members)
    return item ? [item] : []
  })
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = item.sourceTransactionId ?? item.utilityEntryId ?? item.reviewKey
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const counted = items.map((item) => ({
    ...item,
    siblingCount: counts.get(item.sourceTransactionId ?? item.utilityEntryId ?? item.reviewKey) ?? 1,
  }))
  return {
    items: [...counted].sort(byImpact),
    reasons: sentences(record?.reasons),
    partial: input.partial === true || (record ? readString(record, "next_cursor") !== null : false),
  }
}
