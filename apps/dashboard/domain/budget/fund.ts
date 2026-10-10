import { copy, personalExpense, reasonSentence, sharedExpensePaidBy } from "./copy"
import { formatDayMonth } from "./cycle"
import { memberName, type MemberRef } from "./members"
import { formatCents, isNegativeCents, isPositiveCents, parseCents } from "./money"
import { readArray, readComplete, readReasons, readRecord, readString } from "./wire"

export type FundMoney = {
  label: string
  amount: string
  caption: string
}

export type FundEntry = {
  when: string
  amount: string
  sentence: string
  sourceTransactionId: string | null
  correctionOf: string | null
  kind: string | null
}

export type RestrictedHolding = {
  accountId: string
  accountName: string
  amount: string
  asOf: string
}

export type FundTimelinePoint = {
  when: string
  contribution: string
  spending: string
}

export type FundTarget = {
  fundedCents: string
  targetCents: string
  funded: string
  target: string
}

export type FundView = {
  name: string
  headline: string
  complete: boolean
  available: FundMoney
  assigned: FundMoney
  restricted: FundMoney | null
  suggestion: FundMoney | null
  notices: string[]
  target: FundTarget | null
  dueOn: string | null
  holdings: RestrictedHolding[]
  timeline: FundTimelinePoint[]
  reasons: string[]
  entries: FundEntry[]
  listNote: string | null
}

const PURCHASE_KINDS = new Set(["consumption", "purchase"])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

function centsAt(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null
  return parseCents(record[key])
}

function textAt(record: Record<string, unknown> | null, key: string): string | null {
  if (!record) return null
  return readString(record, key)
}

function reasonLabels(value: unknown): string[] {
  const coded = readReasons(value).map((reason) => reasonSentence(reason.code))
  const plain = readArray(value).flatMap((entry) =>
    typeof entry === "string" && entry.length > 0 ? [reasonSentence(entry)] : [],
  )
  return [...new Set([...coded, ...plain])]
}

function fundName(fund: Record<string, unknown> | null): string {
  const name = textAt(fund, "name")
  if (!name || UUID.test(name)) return "Purpose"
  return name
}

function whenOf(record: Record<string, unknown>): string {
  const value = readString(record, "effective_on")
  if (!value || !ISO_DATE.test(value)) return copy.withheld
  try {
    return formatDayMonth(value)
  } catch {
    return copy.withheld
  }
}

function isMovement(record: Record<string, unknown>): boolean {
  return readString(record, "entry_type") === "movement" || readString(record, "effect_kind") === "movement"
}

function isPurchase(record: Record<string, unknown>): boolean {
  if (isMovement(record)) return false
  const type = readString(record, "entry_type")
  const effect = readString(record, "effect_kind")
  return (type !== null && PURCHASE_KINDS.has(type)) || (effect !== null && PURCHASE_KINDS.has(effect))
}

function snapshotLabel(record: Record<string, unknown>): string {
  const snapshot = readString(record, "category_name_snapshot")
  if (!snapshot || UUID.test(snapshot)) return ""
  return snapshot
}

function purchaseSentence(record: Record<string, unknown>, members: readonly MemberRef[]): string {
  const payer = memberName(members, readString(record, "paid_by_member_id"))
  const scope = readString(record, "beneficiary_scope")
  if (scope === "shared") return payer ? sharedExpensePaidBy(payer) : copy.somethingUnresolved
  const beneficiary = memberName(members, readString(record, "beneficiary_member_id"))
  if (!beneficiary) return copy.somethingUnresolved
  return personalExpense(beneficiary, payer)
}

function entrySentence(record: Record<string, unknown>, members: readonly MemberRef[]): string {
  if (isMovement(record) || !isPurchase(record)) return snapshotLabel(record)
  return purchaseSentence(record, members)
}

function entryOf(value: unknown, members: readonly MemberRef[]): FundEntry | null {
  const record = readRecord(value)
  if (!record) return null
  const sentence = entrySentence(record, members)
  return {
    when: whenOf(record),
    amount: formatCents(centsAt(record, "signed_amount_cents") ?? centsAt(record, "amount_cents")),
    sentence: UUID.test(sentence) ? "" : sentence,
    sourceTransactionId: readString(record, "source_transaction_id"),
    correctionOf: readString(record, "correction_of") ?? readString(record, "supersedes_id"),
    kind: readString(record, "effect_kind") ?? readString(record, "entry_type"),
  }
}

function deficitSentence(cents: string | null): string | null {
  if (cents === null || !isNegativeCents(cents)) return null
  return `${copy.deficit}. ${formatCents(cents)}`
}

function scheduleNotice(behaviour: string | null): string | null {
  if (behaviour === "accumulating") return copy.staysInTheFund
  if (behaviour === "cycle_allowance") return copy.nextCycle
  return null
}

export type FundContext = {
  fundId?: string
  earmarks?: readonly {
    fundId: string
    accountId: string
    amountCents: string
    effectiveOn: string
  }[]
  accountNames?: ReadonlyMap<string, string>
}

function holdingsOf(wire: Record<string, unknown>, context: FundContext | undefined, asOf: string): RestrictedHolding[] {
  const fundId = context?.fundId ?? textAt(readRecord(wire.fund), "fund_id")
  if (!fundId || !context?.earmarks) return []
  return context.earmarks.flatMap((earmark) => {
    if (earmark.fundId !== fundId) return []
    return [
      {
        accountId: earmark.accountId,
        accountName: context.accountNames?.get(earmark.accountId) ?? copy.restricted,
        amount: formatCents(earmark.amountCents),
        asOf: earmark.effectiveOn || asOf,
      },
    ]
  })
}

function timelineOf(entries: readonly FundEntry[], behaviour: string | null): FundTimelinePoint[] {
  if (behaviour !== "accumulating") return []
  return entries.flatMap((entry) => {
    const spending = entry.kind === "consumption" || entry.kind === "purchase" || entry.kind === "refund"
    const contribution = entry.kind === "contribution" || entry.kind === "movement" || entry.kind === "assignment"
    if (!spending && !contribution) return []
    return [
      {
        when: entry.when,
        contribution: contribution ? entry.amount : copy.withheld,
        spending: spending ? entry.amount : copy.withheld,
      },
    ]
  })
}

export function projectFund(wire: unknown, members: readonly MemberRef[], context?: FundContext): FundView {
  const record = readRecord(wire) ?? {}
  const fund = readRecord(record.fund)
  const balances = readRecord(record.balances)
  const target = readRecord(record.target) ?? readRecord(record.target_suggestion)
  const complete = readComplete(record)
  const balanceCents = centsAt(balances, "balance_cents") ?? centsAt(record, "balance_cents")
  const liquidCents = centsAt(balances, "liquid_cents") ?? centsAt(record, "liquid_cents")
  const restrictedCents = centsAt(balances, "restricted_cents") ?? centsAt(record, "restricted_cents")
  const assignedCents = centsAt(balances, "assigned_cents") ?? centsAt(record, "assigned_cents")
  const restrictedActive = restrictedCents !== null && restrictedCents !== "0"
  const availableCents = restrictedActive && liquidCents !== null ? liquidCents : balanceCents
  const deficit = deficitSentence(balanceCents) ?? deficitSentence(availableCents)
  const availableAmount = deficit ?? formatCents(availableCents)
  const behaviour =
    textAt(target, "funding_behaviour") ?? textAt(fund, "funding_behaviour") ?? textAt(record, "funding_behaviour")
  const schedule = scheduleNotice(behaviour)
  const suggested = centsAt(target, "suggested_contribution_cents")
  const dueNow = target?.due_now === true
  const suggestion: FundMoney | null =
    suggested === null
      ? null
      : {
          label: copy.nextNeed,
          amount: dueNow ? `${copy.dueNow}. ${formatCents(suggested)}` : formatCents(suggested),
          caption: copy.suggestedNotAssigned,
        }
  const fundedCents = centsAt(target, "funded_cents") ?? balanceCents
  const targetCents = centsAt(target, "target_cents")
  const targetView: FundTarget | null =
    fundedCents !== null &&
    targetCents !== null &&
    !isNegativeCents(fundedCents) &&
    isPositiveCents(targetCents)
      ? {
          fundedCents,
          targetCents,
          funded: formatCents(fundedCents),
          target: formatCents(targetCents),
        }
      : null
  const notices = [
    restrictedActive ? copy.fundedNotAccessible : null,
    schedule,
  ].flatMap((sentence) => (sentence ? [sentence] : []))
  const entries = readArray(record.entries).flatMap((entry) => {
    const row = entryOf(entry, members)
    return row ? [row] : []
  })
  const dueOn = textAt(target, "due_on") ?? textAt(fund, "due_on")
  const asOf = textAt(record, "as_of") ?? ""

  return {
    name: fundName(fund),
    headline: complete ? availableAmount : copy.needsReconciliation,
    complete,
    available: {
      label: copy.available,
      amount: availableAmount,
      caption: complete ? (schedule ?? "") : copy.needsReconciliationDetail,
    },
    assigned: {
      label: copy.assigned,
      amount: formatCents(assignedCents),
      caption: copy.assignedDetail,
    },
    restricted: restrictedActive
      ? {
          label: copy.restricted,
          amount: formatCents(restrictedCents),
          caption: copy.fundedNotAccessible,
        }
      : null,
    suggestion,
    notices,
    target: targetView,
    dueOn,
    holdings: holdingsOf(record, context, asOf),
    timeline: timelineOf(entries, behaviour),
    reasons: reasonLabels(record.reasons),
    entries,
    listNote: readString(record, "next_cursor") ? copy.partialList : null,
  }
}
