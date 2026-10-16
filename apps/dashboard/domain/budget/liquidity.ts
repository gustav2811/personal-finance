import { copy, reasonSentence } from "./copy"
import { assertIsoDate } from "./cycle"
import { memberName, type MemberRef } from "./members"
import { formatCents, parseCents } from "./money"
import { readArray, readComplete, readReasons, readRecord, readString } from "./wire"

export type LiquidityAmount = {
  label: string
  amount: string | null
  caption: string
}

export type LiquidityAccount = {
  id: string
  owner: string
  cash: string | null
  note: string | null
  pendingReserved: string | null
}

export type PendingLiquidityReservation = {
  id: string
  amount: string
  purpose: string
  date: string | null
}

type PendingLiquidityReservationWire = PendingLiquidityReservation & { amountCents: string }

export type LiquidityEntry = {
  label: string
  date: string | null
  amount: string | null
}

export type LiquidityProjection = {
  complete: boolean
  headline: string
  detail: string
  reasons: string[]
  accounts: LiquidityAccount[]
  cardDebt: LiquidityAmount
  expectedIncome: LiquidityAmount
  expectedPayments: LiquidityAmount
  gap: LiquidityAmount
  uncertainty: string[]
  entries: LiquidityEntry[]
  moveCash: {
    label: string
    detail: string
  }
  pendingReservations: PendingLiquidityReservation[]
  pendingReserved: string | null
}

function money(complete: boolean, value: unknown): string | null {
  if (!complete) return null
  return formatCents(parseCents(value))
}

function uncertaintyCodes(value: unknown): string[] {
  return readArray(value).flatMap((entry) => {
    if (typeof entry === "string" && entry.length > 0) return [entry]
    const record = readRecord(entry)
    const code = record ? readString(record, "code") : null
    return code ? [code] : []
  })
}

function sentences(codes: readonly string[]): string[] {
  return [...new Set(codes.map((code) => reasonSentence(code)))]
}

function gapCaption(codes: readonly string[]): string {
  if (codes.includes("no_statement_forecast")) {
    return `${copy.forecastDetail} ${copy.notStatementForecast}`
  }
  return copy.forecastDetail
}

function ownerLabel(record: Record<string, unknown>, members: readonly MemberRef[]): string {
  const scope = readString(record, "owner_scope")
  const ownerId = readString(record, "owner_member_id")
  if (scope === "member") return memberName(members, ownerId) ?? "A household member"
  if (scope !== "shared" && ownerId) return memberName(members, ownerId) ?? "A household member"
  return copy.shared
}

function accountNote(resourceClass: string | null): string | null {
  if (resourceClass === "restricted" || resourceClass === "mortgage") {
    return `${copy.restricted}. ${copy.fundedNotAccessible}`
  }
  return null
}

function accountOf(value: unknown, members: readonly MemberRef[], complete: boolean): LiquidityAccount | null {
  const record = readRecord(value)
  const id = record ? readString(record, "account_id") : null
  if (!record || !id) return null
  const pendingReserved = parseCents(record.pending_reserved_cents ?? record.pending_reservation_cents)
  const reported = parseCents(record.available_cents ?? record.available_after_pending_cents)
  const posted = parseCents(record.normalized_cash_cents)
  const available = reported ?? (posted !== null && pendingReserved !== null ? (BigInt(posted) - BigInt(pendingReserved)).toString() : posted)
  return {
    id,
    owner: ownerLabel(record, members),
    cash: money(complete, available),
    note: accountNote(readString(record, "resource_class")),
    pendingReserved: pendingReserved === null ? null : formatCents(pendingReserved),
  }
}

function workingComplete(record: Record<string, unknown>): boolean | null {
  if (typeof record.working_complete === "boolean") return record.working_complete
  if (typeof record.workingComplete === "boolean") return record.workingComplete
  return null
}

function pendingReservations(record: Record<string, unknown>): PendingLiquidityReservationWire[] {
  const rows = [
    ...readArray(record.pending_reservations),
    ...readArray(record.pending_adjustments).filter((value) => readRecord(value)?.kind === "pending"),
  ]
  const seen = new Set<string>()
  return rows.flatMap((value) => {
    const row = readRecord(value)
    if (!row) return []
    const id = readString(row, "transaction_id") ?? readString(row, "id")
    const amount = parseCents(row.amount_cents ?? row.amount ?? row.pending_reserved_cents)
    if (!id || !amount || seen.has(id)) return []
    seen.add(id)
    const positive = amount.startsWith("-") ? amount.slice(1) : amount
    return [{ id, amount: formatCents(positive), amountCents: positive, purpose: readString(row, "purpose") ?? readString(row, "name") ?? copy.withheld, date: readString(row, "occurred_on") ?? readString(row, "date") }]
  })
}

function readIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null
  try {
    return assertIsoDate(value)
  } catch {
    return null
  }
}

function entryLabel(kind: string | null): string {
  if (kind === "income") return "Expected income"
  if (kind === "payment") return "Expected payments"
  return copy.forecast
}

function entryOf(value: unknown, complete: boolean): LiquidityEntry | null {
  const record = readRecord(value)
  if (!record) return null
  const kind = readString(record, "kind")
  const date = readIsoDate(record.date)
  if (!kind && !date) return null
  return { label: entryLabel(kind), date, amount: money(complete, record.amount_cents) }
}

export function projectLiquidity(wire: unknown, members: readonly MemberRef[]): LiquidityProjection {
  const record = readRecord(wire) ?? {}
  const forecast = readRecord(record.forecast)
  const uncertainty = uncertaintyCodes(forecast?.uncertainty_reasons)
  const complete = workingComplete(record) ?? readComplete(record)
  const accounts = readArray(record.accounts).flatMap((entry) => {
    const account = accountOf(entry, members, complete)
    return account ? [account] : []
  })

  return {
    complete,
    headline: complete ? copy.liquidity : copy.needsReconciliation,
    detail: complete ? copy.liquidityDetail : copy.needsReconciliationDetail,
    reasons: sentences(readReasons(record.reasons).map((reason) => reason.code)),
    accounts,
    cardDebt: {
      label: copy.cardDebt,
      amount: money(complete, record.card_debt_cents),
      caption: copy.cardDebtDetail,
    },
    expectedIncome: {
      label: "Expected income",
      amount: money(complete, forecast?.expected_income_cents),
      caption: copy.forecastDetail,
    },
    expectedPayments: {
      label: "Expected payments",
      amount: money(complete, forecast?.expected_payment_cents),
      caption: copy.forecastDetail,
    },
    gap: {
      label: copy.forecast,
      amount: money(complete, forecast?.indicative_net_gap_cents),
      caption: gapCaption(uncertainty),
    },
    uncertainty: sentences(uncertainty),
    entries: readArray(forecast?.entries).flatMap((entry) => {
      const row = entryOf(entry, complete)
      return row ? [row] : []
    }),
    moveCash: {
      label: copy.moveCash,
      detail: copy.moveCashDetail,
    },
    pendingReservations: pendingReservations(record).map(({ amountCents: _amountCents, ...row }) => row),
    pendingReserved: pendingReservations(record).length === 0 ? null : pendingReservations(record).reduce((sum, row) => (BigInt(sum) + BigInt(row.amountCents)).toString(), "0"),
  }
}
