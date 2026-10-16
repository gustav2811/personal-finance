import { copy, paidBySentence, personalExpense, reasonSentence, sharedExpensePaidBy } from "./copy"
import { cycleLabel, formatAsOf } from "./cycle"
import { memberName, type MemberRef } from "./members"
import { formatCents, isNegativeCents, parseCents } from "./money"
import { coverageFreshness, freshnessSentence, projectCashNeed, projectTransfers, provisionalSentence, type CashNeedProjection, type TransferRow } from "./v1"
import { readArray, readComplete, readReasons, readRecord, readString } from "./wire"

export type BeneficiaryFilter =
  | { kind: "household" }
  | { kind: "shared" }
  | { kind: "member"; memberId: string }

export type LabelledAmount = {
  label: string
  amount: string | null
  caption: string
  withheld: boolean
}

export type PurposeRow = {
  fundId: string
  name: string
  plan: string
  assigned: string
  spent: string
  available: string
  pendingReserved: string | null
  nextNeed: string
  disclosure: string[]
  deficit: boolean
}

export type PendingReservation = {
  id: string
  purpose: string
  amount: string
  date: string | null
}

type PendingReservationWire = PendingReservation & { amountCents: string }

export type PurchaseRow = {
  id: string
  attribution: string
  purpose: string
  amount: string
  fundId: string | null
  sourceTransactionId: string | null
  utilityEntryId: string | null
  sourceFingerprint: string | null
  setId: string | null
}

export type CashBacking = "paying" | "restricted" | "mortgage" | "card"

export type CashAccount = {
  id: string
  label: string
  amount: string
  backing: CashBacking
}

export type CalendarEntry = {
  label: string
  date: string | null
  amount: string
  payer: string | null
}

export type PayerFact = {
  id: string
  sentence: string
  amount: string
}

export type BudgetOverview = {
  complete: boolean
  cycleLabel: string
  revisionLabel: string
  asOfLabel: string
  reasons: string[]
  purposes: PurposeRow[]
  commitments: PurposeRow[]
  retired: PurposeRow[]
  purchases: PurchaseRow[]
  householdConsumption: string | null
  listPartial: boolean
  unassigned: LabelledAmount
  liquidity: LabelledAmount
  forecast: LabelledAmount
  cardDebt: string | null
  accounts: CashAccount[]
  restrictedBacking: CashAccount[]
  calendar: CalendarEntry[]
  payers: PayerFact[]
  moveCash: { label: string; detail: string }
  cashNeed: CashNeedProjection
  freshness: string
  provisional: string | null
  transfers: TransferRow[]
  canAssign: boolean
  versionId: string | null
  reconciliationId: string | null
  reconciliationFingerprint: string | null
  members: Array<{ id: string; name: string }>
  pendingReservations: PendingReservation[]
  pendingReserved: string | null
}

type Line = {
  fundId: string
  name: string
  kind: string
  contributionCents: string | null
  fundingBehaviour: string | null
  beneficiaryScope: string | null
  beneficiaryMemberId: string | null
  plannedPayerMemberId: string | null
  dueOn: string | null
  targetCents: string | null
}

type Fund = {
  fundId: string
  name: string
  status: string | null
  beneficiaryScope: string | null
  beneficiaryMemberId: string | null
  balanceCents: string | null
  assignedCents: string | null
  liquidCents: string | null
  restrictedCents: string | null
  plannedPayerMemberId: string | null
  suggestion: string | null
  dueNow: boolean
  pendingReservedCents: string | null
  availableCents: string | null
}

function scalar(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value === "string" && value.length > 0) return value
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function uncertaintyCodes(value: unknown): string[] {
  return readArray(value).flatMap((entry) => {
    if (typeof entry === "string" && entry.length > 0) return [entry]
    const record = readRecord(entry)
    return record && typeof record.code === "string" ? [record.code] : []
  })
}

const PURPOSE_EFFECTS = new Set([
  "consumption",
  "contribution",
  "required_debt_payment",
  "extra_debt_payment",
  "refund",
])

function lineOf(value: unknown): Line | null {
  const record = readRecord(value)
  const fundId = record ? readString(record, "fund_id") : null
  if (!record || !fundId) return null
  return {
    fundId,
    name: readString(record, "name") ?? "Purpose",
    kind: readString(record, "kind") ?? "consumption",
    contributionCents: parseCents(record.contribution_cents),
    fundingBehaviour: readString(record, "funding_behaviour"),
    beneficiaryScope: readString(record, "beneficiary_scope"),
    beneficiaryMemberId: readString(record, "beneficiary_member_id"),
    plannedPayerMemberId: readString(record, "planned_payer_member_id"),
    dueOn: readString(record, "due_on"),
    targetCents: parseCents(record.target_cents),
  }
}

function fundOf(value: unknown): Fund | null {
  const record = readRecord(value)
  const fundId = record ? readString(record, "fund_id") : null
  if (!record || !fundId) return null
  const suggestion = readRecord(record.target_suggestion)
  return {
    fundId,
    name: readString(record, "name") ?? "Purpose",
    status: readString(record, "status"),
    beneficiaryScope: readString(record, "beneficiary_scope"),
    beneficiaryMemberId: readString(record, "beneficiary_member_id"),
    balanceCents: parseCents(record.balance_cents),
    assignedCents: parseCents(record.assigned_cents),
    liquidCents: parseCents(record.liquid_cents),
    restrictedCents: parseCents(record.restricted_cents),
    plannedPayerMemberId: readString(record, "planned_payer_member_id"),
    suggestion: suggestion ? parseCents(suggestion.suggested_contribution_cents) : null,
    dueNow: suggestion?.due_now === true,
    pendingReservedCents: parseCents(record.pending_reserved_cents ?? record.pending_reservation_cents),
    availableCents: parseCents(record.available_cents ?? record.available_after_pending_cents),
  }
}

function matches(scope: string | null, memberId: string | null, filter: BeneficiaryFilter): boolean {
  if (filter.kind === "household") return true
  if (filter.kind === "shared") return scope === "shared"
  return scope === "member" && memberId === filter.memberId
}

function nextNeed(line: Line | undefined, fund: Fund): string {
  if (!line) return copy.retired
  if (line.fundingBehaviour === "accumulating") return copy.staysInTheFund
  if (line.fundingBehaviour === "cycle_allowance") return copy.nextCycle
  if (fund.dueNow) return `${copy.dueNow}. ${copy.suggestedNotAssigned}`
  if (fund.suggestion) return `${formatCents(fund.suggestion)}. ${copy.suggestedNotAssigned}`
  if (line.dueOn) return `${line.dueOn}. ${copy.suggestedNotAssigned}`
  return copy.nextCycle
}

function disclosure(line: Line | undefined, original: Line | undefined, fund: Fund, members: readonly MemberRef[]): string[] {
  const lines = [
    `${copy.beneficiary}: ${beneficiaryLabel(line?.beneficiaryScope ?? fund.beneficiaryScope, line?.beneficiaryMemberId ?? fund.beneficiaryMemberId, members)}`,
    `${copy.plannedPayer}: ${memberName(members, line?.plannedPayerMemberId ?? fund.plannedPayerMemberId) ?? copy.withheld}`,
    `${copy.assigned}: ${formatCents(fund.assignedCents)}. ${copy.assignedDetail}`,
  ]
  if (original?.contributionCents) {
    lines.push(`${copy.originalPlan}: ${formatCents(original.contributionCents)}`)
  }
  if (line?.contributionCents) {
    lines.push(`${copy.revisedPlan}: ${formatCents(line.contributionCents)}`)
  }
  if (fund.restrictedCents && fund.restrictedCents !== "0") {
    lines.push(`${copy.restricted}: ${formatCents(fund.restrictedCents)}. ${copy.fundedNotAccessible}`)
  }
  if (fund.suggestion) {
    lines.push(`${formatCents(fund.suggestion)}. ${copy.suggestedNotAssigned}`)
  }
  return lines
}

function beneficiaryLabel(scope: string | null, memberId: string | null, members: readonly MemberRef[]): string {
  if (scope === "shared") return copy.shared
  return memberName(members, memberId) ?? copy.withheld
}

function rowFor(fund: Fund, line: Line | undefined, original: Line | undefined, spent: string | null, members: readonly MemberRef[], provisional: boolean): PurposeRow {
  const restricted = fund.restrictedCents !== null && fund.restrictedCents !== "0"
  const balance = restricted ? fund.liquidCents : fund.balanceCents
  const pendingReserved = fund.pendingReservedCents
  const availableCents = fund.availableCents ?? (balance !== null && pendingReserved !== null
    ? (BigInt(balance) - BigInt(pendingReserved)).toString()
    : balance)
  const deficit = availableCents !== null && isNegativeCents(availableCents)
  const sentences = disclosure(line, original, fund, members)
  if (provisional) sentences.push(`${copy.needsReconciliation}. ${copy.needsReconciliationDetail}`)
  return {
    fundId: fund.fundId,
    name: line?.name ?? fund.name,
    plan: formatCents(line?.contributionCents ?? null),
    assigned: formatCents(fund.assignedCents),
    spent: spent === null ? copy.withheld : formatCents(spent),
    pendingReserved: pendingReserved === null ? null : formatCents(pendingReserved),
    available: provisional
      ? copy.needsReconciliation
      : deficit
        ? `${copy.deficit}. ${formatCents(availableCents)}`
        : formatCents(availableCents),
    nextNeed: nextNeed(line, fund),
    disclosure: sentences,
    deficit,
  }
}

function pendingReservationOf(value: unknown, names: ReadonlyMap<string, string>): PendingReservationWire | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, "transaction_id") ?? readString(record, "id")
  const amount = parseCents(record.amount_cents ?? record.amount ?? record.pending_reserved_cents)
  if (!id || !amount) return null
  const fundId = readString(record, "fund_id")
  const purpose = readString(record, "purpose") ?? readString(record, "name") ?? (fundId ? names.get(fundId) : null) ?? copy.withheld
  const positiveAmount = amount.startsWith("-") ? amount.slice(1) : amount
  return { id, purpose, amount: formatCents(positiveAmount), amountCents: positiveAmount, date: readString(record, "occurred_on") ?? readString(record, "date") }
}

function pendingReservations(overview: Record<string, unknown>, liquidity: Record<string, unknown>, names: ReadonlyMap<string, string>): PendingReservationWire[] {
  const sources = [
    ...readArray(overview.pending_reservations),
    ...readArray(liquidity.pending_reservations),
    ...readArray(overview.pending_adjustments).filter((value) => readRecord(value)?.kind === "pending"),
    ...readArray(liquidity.pending_adjustments).filter((value) => readRecord(value)?.kind === "pending"),
  ]
  const seen = new Set<string>()
  return sources.flatMap((value) => {
    const row = pendingReservationOf(value, names)
    if (!row || seen.has(row.id)) return []
    seen.add(row.id)
    return [row]
  })
}

function workingComplete(record: Record<string, unknown>): boolean | null {
  if (typeof record.working_complete === "boolean") return record.working_complete
  if (typeof record.workingComplete === "boolean") return record.workingComplete
  return null
}

function spendByFund(entries: unknown[], completeList: boolean): Map<string, string> | null {
  if (!completeList) return null
  const totals = new Map<string, bigint>()
  for (const entry of entries) {
    const record = readRecord(entry)
    if (!record) continue
    const effect = readString(record, "effect_kind")
    const fundId = readString(record, "fund_id")
    const amount = parseCents(record.amount_cents)
    if (!effect || !fundId || !amount || !PURPOSE_EFFECTS.has(effect)) continue
    totals.set(fundId, (totals.get(fundId) ?? BigInt(0)) + BigInt(amount))
  }
  return new Map([...totals].map(([fundId, total]) => [fundId, total.toString()]))
}

function purchaseOf(value: unknown, members: readonly MemberRef[], names: Map<string, string>): PurchaseRow | null {
  const record = readRecord(value)
  if (!record) return null
  const effect = readString(record, "effect_kind")
  if (!effect || !PURPOSE_EFFECTS.has(effect)) return null
  const amount = parseCents(record.amount_cents)
  if (!amount) return null
  const scope = readString(record, "beneficiary_scope")
  const beneficiaryId = readString(record, "beneficiary_member_id")
  const payerId = readString(record, "paid_by_member_id")
  const payer = memberName(members, payerId)
  const beneficiary = scope === "shared" ? copy.shared : memberName(members, beneficiaryId)
  const attribution =
    scope === "shared" && payer
      ? sharedExpensePaidBy(payer)
      : beneficiary
        ? personalExpense(beneficiary, payer)
        : copy.somethingUnresolved
  const fundId = readString(record, "fund_id")
  const id = readString(record, "allocation_id") ?? readString(record, "source_transaction_id") ?? attribution
  return {
    id,
    attribution,
    purpose: fundId ? (names.get(fundId) ?? "Purpose") : copy.withheld,
    amount: formatCents(amount),
    fundId,
    sourceTransactionId: readString(record, "source_transaction_id"),
    utilityEntryId: readString(record, "utility_entry_id"),
    sourceFingerprint: readString(record, "source_fingerprint"),
    setId: readString(record, "set_id"),
  }
}

function lineNameById(current: Record<string, unknown> | null): Map<string, string> {
  const names = new Map<string, string>()
  for (const entry of readArray(current?.lines)) {
    const record = readRecord(entry)
    const id = record ? readString(record, "id") : null
    const name = record ? readString(record, "name") : null
    if (record && id && name) names.set(id, name)
  }
  return names
}

function paymentLabel(record: Record<string, unknown>, names: ReadonlyMap<string, string>): string | null {
  const provenance = readRecord(record.provenance)
  const lineId = provenance ? readString(provenance, "line_id") : null
  if (lineId) {
    const named = names.get(lineId)
    if (named) return named
  }
  return readString(record, "name")
}

function resourcesOf(overview: Record<string, unknown>): Record<string, unknown> | null {
  const provenance = readRecord(overview.provenance)
  const nested = provenance ? readRecord(provenance.resources) : null
  if (nested) return nested
  const query = readRecord(overview.query_provenance)
  return query ? readRecord(query.resources) : null
}

function withheld(label: string, caption: string): LabelledAmount {
  return { label, amount: null, caption, withheld: true }
}

export function projectBudget(input: {
  overview: unknown
  actuals: unknown
  liquidity: unknown
  members: readonly MemberRef[]
  filter: BeneficiaryFilter
}): BudgetOverview {
  const overview = readRecord(input.overview) ?? {}
  const actuals = readRecord(input.actuals) ?? {}
  const liquidity = readRecord(input.liquidity) ?? {}
  const current = readRecord(overview.current_plan)
  const original = readRecord(overview.original_plan)
  const currentLines = readArray(current?.lines).flatMap((entry) => {
    const line = lineOf(entry)
    return line ? [line] : []
  })
  const originalLines = new Map(
    readArray(original?.lines).flatMap((entry) => {
      const line = lineOf(entry)
      return line ? [[line.fundId, line] as const] : []
    }),
  )
  const lines = new Map(currentLines.map((line) => [line.fundId, line]))
  const funds = readArray(overview.funds).flatMap((entry) => {
    const fund = fundOf(entry)
    return fund ? [fund] : []
  })
  const names = new Map(funds.map((fund) => [fund.fundId, lines.get(fund.fundId)?.name ?? fund.name]))
  const entries = readArray(actuals.entries)
  const listPartial = readString(actuals, "next_cursor") !== null
  const spent = spendByFund(entries, !listPartial)
  const reasons = [...readReasons(overview.reasons), ...readReasons(liquidity.reasons)]
  const overviewUsable = workingComplete(overview) ?? readComplete(overview)
  const liquidityUsable = workingComplete(liquidity) ?? readComplete(liquidity)
  const working = overviewUsable && liquidityUsable
  const reasonLabels = [...new Set(reasons.map((reason) => reasonSentence(reason.code)))]
  const pendingRows = pendingReservations(overview, liquidity, names)

  const purposes: PurposeRow[] = []
  const commitments: PurposeRow[] = []
  const retired: PurposeRow[] = []
  for (const fund of funds) {
    const line = lines.get(fund.fundId)
    const scope = line?.beneficiaryScope ?? fund.beneficiaryScope
    const memberId = line?.beneficiaryMemberId ?? fund.beneficiaryMemberId
    if (!matches(scope, memberId, input.filter)) continue
    const row = rowFor(
      fund,
      line,
      originalLines.get(fund.fundId),
      spent?.get(fund.fundId) ?? (spent ? "0" : null),
      input.members,
      !working,
    )
    if (!line || fund.status === "retired") retired.push(row)
    else if (line.kind === "debt_commitment" || line.kind === "contribution") commitments.push(row)
    else purposes.push(row)
  }

  const purchases = entries.flatMap((entry) => {
    const record = readRecord(entry)
    if (!record) return []
    if (!matches(readString(record, "beneficiary_scope"), readString(record, "beneficiary_member_id"), input.filter)) {
      return []
    }
    const purchase = purchaseOf(entry, input.members, names)
    return purchase ? [purchase] : []
  })

  const householdTotals = readRecord(actuals.household_totals)
  const byGroup = householdTotals ? readRecord(householdTotals.by_group) : null
  const householdConsumption = byGroup ? parseCents(byGroup.consumption) : null
  const resources = resourcesOf(overview)
  const versionId = readString(overview, "current_version_id")
  const reconciliationId = resources ? readString(resources, "reconciliation_id") : null
  const reconciliationFingerprint = resources ? readString(resources, "reconciliation_fingerprint") : null
  const unassignedCents = working ? parseCents(overview.unassigned_cents) : null
  const forecastCents = parseCents(overview.forecast_gap_cents)
  const forecastRecord = readRecord(liquidity.forecast)
  const uncertainty = uncertaintyCodes(forecastRecord?.uncertainty_reasons)
  const liquidityComplete = liquidityUsable
  const cashAccounts = liquidityComplete
    ? readArray(liquidity.accounts).flatMap((entry) => {
        const record = readRecord(entry)
        const id = record ? readString(record, "account_id") : null
        const amount = record ? parseCents(record.normalized_cash_cents) : null
        if (!record || !id || !amount) return []
        const owner = memberName(input.members, readString(record, "owner_member_id"))
        const resourceClass = readString(record, "resource_class")
        const backing: CashBacking =
          resourceClass === "restricted"
            ? "restricted"
            : resourceClass === "mortgage"
              ? "mortgage"
              : resourceClass === "card"
                ? "card"
                : "paying"
        return [{ id, label: owner ?? copy.shared, amount: formatCents(amount), backing }]
      })
    : []
  const accounts = cashAccounts.filter((account) => account.backing === "paying" || account.backing === "card")
  const restrictedBacking = cashAccounts.filter(
    (account) => account.backing === "restricted" || account.backing === "mortgage",
  )
  const forecastEntries = readArray(forecastRecord?.entries)
  const expectedEntries = readArray(liquidity.expected)
  const paymentNames = lineNameById(current)
  const calendarSource = expectedEntries.length > 0 ? expectedEntries : forecastEntries
  const calendar = calendarSource.flatMap((entry) => {
    const record = readRecord(entry)
    if (!record) return []
    const kind = readString(record, "kind")
    const date = readString(record, "date")
    const amount = parseCents(record.amount_cents)
    if (!kind && !date) return []
    const payerId = readString(record, "planned_payer_member_id")
    return [
      {
        label: kind === "income" ? "Expected income" : copy.expectedPayments,
        date,
        amount: formatCents(amount),
        payer: memberName(input.members, payerId),
      },
    ]
  })
  const byPayer = householdTotals ? readRecord(householdTotals.by_actual_payer) : null
  const payers = byPayer
    ? Object.entries(byPayer).flatMap(([id, value]) => {
        const groups = readRecord(value)
        const consumption = groups ? parseCents(groups.consumption) : null
        if (!consumption) return []
        const name = id === "shared" || id === "unassigned" ? copy.shared : (memberName(input.members, id) ?? "A household member")
        return [{ id, sentence: paidBySentence(name), amount: formatCents(consumption) }]
      })
    : []

  const versionNumber = current ? scalar(current, "version_number") : null
  const revisionLabel = versionNumber ? `${copy.revision} ${versionNumber}` : copy.noPublishedPlan
  const cycleStart = readString(overview, "cycle_start")
  const cycleEnd = readString(overview, "end_exclusive")

  return {
    complete: working,
    cycleLabel: cycleStart && cycleEnd ? cycleLabel(cycleStart, cycleEnd) : copy.withheld,
    revisionLabel,
    asOfLabel: `${copy.asOf} ${formatAsOf(readString(overview, "as_of") ?? "")}`,
    reasons: reasonLabels,
    purposes,
    commitments,
    retired,
    purchases,
    householdConsumption: householdConsumption === null ? null : formatCents(householdConsumption),
    listPartial,
    unassigned: working
      ? {
          label: copy.unassigned,
          amount: formatCents(unassignedCents),
          caption: copy.unassignedDetail,
          withheld: unassignedCents === null,
        }
      : withheld(copy.unassigned, copy.needsReconciliationDetail),
    liquidity: liquidityComplete
      ? {
          label: copy.liquidity,
          amount: null,
          caption: copy.liquidityDetail,
          withheld: false,
        }
      : withheld(copy.liquidity, copy.needsReconciliationDetail),
    forecast: {
      label: copy.forecast,
      amount: formatCents(forecastCents),
      caption: uncertainty.includes("no_statement_forecast")
        ? `${copy.forecastDetail} ${copy.notStatementForecast}`
        : copy.forecastDetail,
      withheld: false,
    },
    cardDebt: liquidityComplete ? formatCents(parseCents(liquidity.card_debt_cents)) : null,
    accounts,
    restrictedBacking,
    calendar,
    payers,
    moveCash: { label: copy.moveCash, detail: copy.moveCashDetail },
    cashNeed: projectCashNeed({
      complete: liquidityComplete,
      accounts: readArray(liquidity.accounts).flatMap((entry) => {
        const record = readRecord(entry)
        const id = record ? readString(record, "account_id") : null
        if (!record || !id) return []
        return [
          {
            id,
            ownerId: readString(record, "owner_member_id"),
            ownerScope: readString(record, "owner_scope"),
            resourceClass: readString(record, "resource_class"),
            cashCents: parseCents(record.normalized_cash_cents),
          },
        ]
      }),
      expected: calendarSource.flatMap((entry) => {
        const record = readRecord(entry)
        if (!record) return []
        return [
          {
            kind: readString(record, "kind"),
            date: readString(record, "date"),
            amountCents: parseCents(record.amount_cents),
            payerId: readString(record, "planned_payer_member_id"),
            accountId: readString(record, "account_id"),
            label: paymentLabel(record, paymentNames),
          },
        ]
      }),
      members: input.members,
    }),
    freshness: freshnessSentence({
      asOf: readString(overview, "as_of"),
      accounts: coverageFreshness(resources),
    }),
    provisional: provisionalSentence(parseCents(overview.provisional_unassigned_cents)),
    transfers: projectTransfers(entries, input.members),
    canAssign: working && versionId !== null && reconciliationId !== null && reconciliationFingerprint !== null && unassignedCents !== null,
    versionId,
    reconciliationId,
    reconciliationFingerprint,
    members: input.members.map((member) => ({ id: member.id, name: memberName(input.members, member.id) ?? "A household member" })),
    pendingReservations: pendingRows.map(({ amountCents: _amountCents, ...row }) => row),
    pendingReserved: pendingRows.length === 0 ? null : pendingRows.reduce((sum, row) => (BigInt(sum) + BigInt(row.amountCents)).toString(), "0"),
  }
}
