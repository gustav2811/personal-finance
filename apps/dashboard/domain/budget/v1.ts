import { copy } from "./copy"
import { assertIsoDate, formatSpokenDate } from "./cycle"
import { memberName, type MemberRef } from "./members"
import { formatCents, isCents, parseCents } from "./money"
import { readArray, readRecord, readString } from "./wire"

export type CashNeed = {
  id: string
  owner: string
  backing: "paying" | "restricted" | "mortgage" | "card"
  cash: string | null
  dueBeforeIncome: string | null
  shortfall: string | null
  sentence: string
}

export type CashNeedProjection = {
  nextIncome: string | null
  incomeKnown: boolean
  needs: CashNeed[]
  withheld: boolean
}

type NeedAccount = {
  id: string
  ownerId: string | null
  ownerScope: string | null
  resourceClass: string | null
  cashCents: string | null
}

type NeedEntry = {
  kind: string | null
  date: string | null
  amountCents: string | null
  payerId: string | null
  accountId: string | null
  label?: string | null
}

function add(left: bigint, right: string | null): bigint {
  if (!right || !isCents(right)) return left
  return left + BigInt(right)
}

function dateOrNull(value: string | null): string | null {
  if (!value) return null
  try {
    return assertIsoDate(value)
  } catch {
    return null
  }
}

function joinNames(names: readonly string[]): string {
  const unique = [...new Set(names)]
  if (unique.length <= 1) return unique[0] ?? ""
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`
  return `${unique.slice(0, -1).join(", ")}, and ${unique[unique.length - 1]}`
}

function duePayments(accountId: string, nextIncome: string | null, expected: readonly NeedEntry[]): NeedEntry[] {
  return expected.filter((entry) => {
    if (entry.kind === "income" || entry.accountId !== accountId) return false
    const date = dateOrNull(entry.date)
    if (!nextIncome || !date || date >= nextIncome) return false
    return true
  })
}

function payingSentence(owner: string, shortfall: string | null, payments: readonly NeedEntry[], nextIncome: string | null): string {
  const dates = payments.flatMap((entry) => {
    const date = dateOrNull(entry.date)
    return date ? [date] : []
  })
  const earliest = dates.sort()[0] ?? null
  const spoken = earliest ? formatSpokenDate(earliest) : nextIncome ? formatSpokenDate(nextIncome) : null
  const when = spoken ? `before ${spoken}` : "before the next income"
  if (shortfall && shortfall !== "0") {
    const names = payments.flatMap((entry) => (entry.label ? [entry.label] : []))
    const bills = names.length > 0 ? `to pay ${joinNames(names)}` : "for the payments due from this account"
    return `${owner} needs ${formatCents(shortfall)} ${when} ${bills}.`
  }
  return `${owner} can cover the payments due ${when} from this account.`
}

export function projectCashNeed(input: {
  complete: boolean
  accounts: readonly NeedAccount[]
  expected: readonly NeedEntry[]
  members: readonly MemberRef[]
}): CashNeedProjection {
  const incomeDates = input.expected.flatMap((entry) => {
    if (entry.kind !== "income") return []
    const date = dateOrNull(entry.date)
    return date ? [date] : []
  })
  const nextIncome = incomeDates.sort()[0] ?? null
  const payingIds = new Set(
    input.accounts.flatMap((account) =>
      account.resourceClass === "restricted" || account.resourceClass === "mortgage" || account.resourceClass === "card"
        ? []
        : [account.id],
    ),
  )
  const unassignedPayment = input.expected.some((entry) => {
    if (entry.kind === "income") return false
    const date = dateOrNull(entry.date)
    if (!nextIncome || !date || date >= nextIncome) return false
    return entry.accountId === null || !payingIds.has(entry.accountId)
  })
  const withheld = !input.complete || nextIncome === null || unassignedPayment
  const needs = input.accounts.map((account) => {
    const backing: CashNeed["backing"] =
      account.resourceClass === "restricted"
        ? "restricted"
        : account.resourceClass === "mortgage"
          ? "mortgage"
          : account.resourceClass === "card"
            ? "card"
            : "paying"
    const owner =
      account.ownerScope === "member"
        ? (memberName(input.members, account.ownerId) ?? "A household member")
        : copy.shared
    const payments = duePayments(account.id, nextIncome, input.expected)
    const due = payments.reduce((total, entry) => add(total, entry.amountCents), BigInt(0))
    const cash = account.cashCents && isCents(account.cashCents) ? BigInt(account.cashCents) : null
    const shortfall = cash === null ? null : due - cash > BigInt(0) ? (due - cash).toString() : "0"
    const pays = backing === "paying"
    return {
      id: account.id,
      owner,
      backing,
      cash: withheld || cash === null ? null : formatCents(cash.toString()),
      dueBeforeIncome: withheld ? null : formatCents(due.toString()),
      shortfall: !pays || withheld || shortfall === null ? null : formatCents(shortfall),
      sentence: pays
        ? withheld
          ? unassignedPayment
            ? "A payment due before the next income has no paying account."
            : nextIncome
              ? "We can't say who needs money in their account until the missing facts are agreed."
              : "Expected income date is not known, so we can't say who needs money in their account."
          : payingSentence(owner, shortfall, payments, nextIncome)
        : `${copy.backing} ${copy.fundedNotAccessible}`,
    }
  })
  return { nextIncome, incomeKnown: nextIncome !== null, needs, withheld }
}

function observationLabel(at: Date): string {
  return at.toISOString().slice(0, 16).replace("T", " ")
}

export function freshnessSentence(input: {
  asOf: string | null
  accounts: readonly { observedAt: string | null; freshnessHours: number | null; included: boolean }[]
}): string {
  const included = input.accounts.filter((account) => account.included)
  const asOf = input.asOf ? new Date(input.asOf) : null
  if (included.length === 0 || asOf === null || Number.isNaN(asOf.getTime())) return "Source freshness is unknown."
  let oldest: Date | null = null
  for (const account of included) {
    if (!account.observedAt || account.freshnessHours === null) return "Source freshness is unknown."
    const at = new Date(account.observedAt)
    if (Number.isNaN(at.getTime())) return "Source freshness is unknown."
    if (at.getTime() + account.freshnessHours * 60 * 60 * 1000 < asOf.getTime()) {
      return `Source is stale. Observation ${observationLabel(at)} UTC is outside its freshness window.`
    }
    if (oldest === null || at < oldest) oldest = at
  }
  if (oldest === null) return "Source freshness is unknown."
  return `Source fresh. Oldest observation ${observationLabel(oldest)} UTC.`
}

export function provisionalSentence(cents: string | null): string | null {
  if (!cents || !isCents(cents)) return null
  return `Provisional ${formatCents(cents)}. Not currently available money.`
}

export function forecastGap(incomeCents: readonly string[], contributionCents: readonly string[]): string | null {
  if (incomeCents.some((value) => !isCents(value)) || contributionCents.some((value) => !isCents(value))) return null
  const income = incomeCents.reduce((total, value) => total + BigInt(value), BigInt(0))
  const uses = contributionCents.reduce((total, value) => total + BigInt(value), BigInt(0))
  return (income - uses).toString()
}

export type TransferRow = {
  id: string
  sentence: string
  amount: string
  sourceTransactionId: string | null
}

export function projectTransfers(entries: readonly unknown[], members: readonly MemberRef[]): TransferRow[] {
  return entries.flatMap((entry, index) => {
    const record = readRecord(entry)
    if (!record || readString(record, "effect_kind") !== "movement") return []
    const amount = parseCents(record.amount_cents)
    if (!amount) return []
    const payer = memberName(members, readString(record, "paid_by_member_id"))
    return [
      {
        id: readString(record, "allocation_id") ?? readString(record, "source_transaction_id") ?? `transfer:${index}`,
        sentence: payer
          ? `Transfer · Paid by ${payer}. Not a purchase, and not a debt.`
          : "Transfer. Not a purchase, and not a debt.",
        amount: formatCents(amount),
        sourceTransactionId: readString(record, "source_transaction_id"),
      },
    ]
  })
}

export type MonthActual = {
  month: string
  label: string
  consumption: string
}

export function groupActualsByMonth(entries: readonly unknown[]): MonthActual[] {
  const totals = new Map<string, bigint>()
  for (const entry of entries) {
    const record = readRecord(entry)
    if (!record || readString(record, "effect_kind") !== "consumption") continue
    const occurred = readString(record, "occurred_on")
    const amount = parseCents(record.amount_cents)
    if (!occurred || !amount || occurred.length < 7) continue
    const month = occurred.slice(0, 7)
    totals.set(month, (totals.get(month) ?? BigInt(0)) + BigInt(amount))
  }
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, total]) => ({
      month,
      label: monthLabel(month),
      consumption: formatCents(total.toString()),
    }))
}

function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number) as [number, number]
  return new Intl.DateTimeFormat("en-ZA", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  )
}

export type CorrectionHop = {
  id: string
  supersedesId: string
  sourceTransactionId: string | null
  sentence: string
}

export function correctionChain(entries: readonly unknown[]): CorrectionHop[] {
  return entries.flatMap((entry) => {
    const record = readRecord(entry)
    const supersedesId = record ? readString(record, "supersedes_id") : null
    if (!record || !supersedesId) return []
    const source = readString(record, "source_transaction_id")
    return [
      {
        id: readString(record, "allocation_id") ?? supersedesId,
        supersedesId,
        sourceTransactionId: source,
        sentence: source
          ? `${copy.correctedSpend} This allocation replaces ${supersedesId}.`
          : `${copy.correctedSpend} Replaces ${supersedesId}.`,
      },
    ]
  })
}

export type SavedReview = {
  found: boolean
  status: string | null
  provisional: boolean
  sentence: string
  trail: string[]
}

export function readSavedReview(payload: unknown, members: readonly MemberRef[]): SavedReview {
  const record = readRecord(payload)
  if (!record || record.found !== true) {
    return { found: false, status: null, provisional: false, sentence: "", trail: [] }
  }
  const components = readArray(record.components)
  const first = readRecord(components[0])
  const payer = memberName(members, first ? readString(first, "paid_by_member_id") : null)
  const scope = first ? readString(first, "beneficiary_scope") : null
  const sentence = scope === "shared" && payer
    ? `Shared expense · Paid by ${payer}. ${record.status === "needs_review" ? "Provisional." : "Confirmed."}`
    : record.status === "needs_review"
      ? "Provisional review."
      : "Confirmed review."
  return {
    found: true,
    status: readString(record, "status"),
    provisional: record.provisional === true,
    sentence,
    trail: readArray(record.trail).flatMap((entry) => {
      const hop = readRecord(entry)
      const supersedes = hop ? readString(hop, "supersedes_id") : null
      return supersedes ? [`Replaces ${supersedes}.`] : []
    }),
  }
}

export function coverageFreshness(resources: Record<string, unknown> | null): {
  observedAt: string | null
  freshnessHours: number | null
  included: boolean
}[] {
  if (!resources) return []
  return readArray(resources.accounts).flatMap((entry) => {
    const record = readRecord(entry)
    if (!record) return []
    const settings = readRecord(record.settings_snapshot)
    const snapshot = readRecord(record.snapshot_snapshot)
    const hours = settings?.freshness_hours
    return [
      {
        observedAt: snapshot ? readString(snapshot, "observed_at") : null,
        freshnessHours: typeof hours === "number" ? hours : null,
        included: readString(record, "status") === "included",
      },
    ]
  })
}
