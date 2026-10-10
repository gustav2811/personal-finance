import { copy, reasonSentence, sharedExpensePaidBy } from "./copy"
import { memberName, type MemberRef } from "./members"
import { compareCents, formatCents, parseCents } from "./money"
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
  amountCents: string | null
  impactCents: string | null
  reasons: ReviewReason[]
  payerSentence: string | null
  fingerprint: string | null
  setId: string | null
  submittable: boolean
  unresolved: string | null
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
  const bankSource = sourceTransactionId !== null && utilityEntryId === null
  return {
    reviewKey,
    kind: readString(record, "kind") ?? "",
    severity: readString(record, "severity") ?? "",
    occurredOn: readString(record, "occurred_on"),
    sourceTransactionId,
    utilityEntryId,
    amount: formatCents(amountCents),
    amountCents,
    impactCents,
    reasons: sentences(record.reasons),
    payerSentence: paidBy ? sharedExpensePaidBy(paidBy) : null,
    fingerprint,
    setId: provenance ? present(readString(provenance, "set_id")) : null,
    submittable: bankSource && fingerprint !== null,
    unresolved: fingerprint === null ? copy.somethingUnresolved : null,
  }
}

function byImpact(left: ReviewItem, right: ReviewItem): number {
  if (left.impactCents === null && right.impactCents === null) return 0
  if (left.impactCents === null) return 1
  if (right.impactCents === null) return -1
  return compareCents(left.impactCents, right.impactCents)
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
  return {
    items: [...items].sort(byImpact),
    reasons: sentences(record?.reasons),
    partial: input.partial === true || (record ? readString(record, "next_cursor") !== null : false),
  }
}
