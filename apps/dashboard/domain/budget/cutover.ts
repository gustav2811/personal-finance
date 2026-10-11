import { copy } from "./copy"
import { parseCents } from "./money"
import { readArray, readRecord, readString } from "./wire"

export type CutoverMember = {
  id: string
  email: string | null
}

export type CutoverCategory = {
  id: string
  name: string
  groupName: string | null
}

export type CutoverSettings = {
  ownerScope: "shared" | "member"
  ownerMemberId: string | null
  included: boolean
  exclusionReason: string | null
  resourceClass: "liquid" | "restricted" | "mortgage" | "card" | "tracking_only"
  settlementAccountId: string | null
  usualDueDay: number | null
  freshnessHours: number
  transactionSignConvention: "outflow_negative" | "outflow_positive" | "unknown"
  signEvidence: string | null
  settingsFingerprint: string
}

export type CutoverSnapshot = {
  date: string
  amountCents: string | null
  currencyCode: string | null
  observedAt: string | null
  snapshotFingerprint: string
}

export type CutoverAccount = {
  id: string
  name: string
  currencyCode: string | null
  settings: CutoverSettings | null
  latestSnapshot: CutoverSnapshot | null
  pendingIds: string[]
}

export type CutoverFund = {
  id: string
  name: string
  status: "active" | "retired"
  beneficiaryScope: "shared" | "member"
  beneficiaryMemberId: string | null
}

export type CutoverReconciliation = {
  id: string
  storedStatus: string
  status: string
  asOf: string | null
  openingFundCutover: string | null
  fingerprint: string | null
  reasons: string[]
}

export type CutoverEarmark = {
  id: string
  fundId: string
  accountId: string
  amountCents: string
  effectiveOn: string
  reason: string
}

export type CutoverMovement = {
  id: string
  kind: string
  fromFundId: string | null
  toFundId: string | null
  amountCents: string
  effectiveOn: string
  reason: string
  budgetVersionId: string | null
}

export type CutoverWorkspace = {
  members: CutoverMember[]
  categories: CutoverCategory[]
  accounts: CutoverAccount[]
  funds: CutoverFund[]
  reconciliation: CutoverReconciliation | null
  earmarks: CutoverEarmark[]
  movements: CutoverMovement[]
}

function unreadable(): Error {
  return new Error(copy.couldNotRead)
}

function text(record: Record<string, unknown>, key: string): string | null {
  return readString(record, key)
}

function requireText(record: Record<string, unknown>, key: string): string {
  const value = text(record, key)
  if (!value) throw unreadable()
  return value
}

const CLASSES = ["liquid", "restricted", "mortgage", "card", "tracking_only"] as const
const SIGNS = ["outflow_negative", "outflow_positive", "unknown"] as const

function settingsOf(value: unknown): CutoverSettings | null {
  if (value === null || value === undefined) return null
  const record = readRecord(value)
  if (!record) throw unreadable()
  const ownerScope = requireText(record, "owner_scope")
  const resourceClass = requireText(record, "resource_class")
  const sign = requireText(record, "transaction_sign_convention")
  if (ownerScope !== "shared" && ownerScope !== "member") throw unreadable()
  if (!CLASSES.includes(resourceClass as (typeof CLASSES)[number])) throw unreadable()
  if (!SIGNS.includes(sign as (typeof SIGNS)[number])) throw unreadable()
  if (typeof record.included !== "boolean") throw unreadable()
  if (typeof record.freshness_hours !== "number" || !Number.isInteger(record.freshness_hours)) throw unreadable()
  const due = record.usual_due_day
  return {
    ownerScope,
    ownerMemberId: text(record, "owner_member_id"),
    included: record.included,
    exclusionReason: text(record, "exclusion_reason"),
    resourceClass: resourceClass as CutoverSettings["resourceClass"],
    settlementAccountId: text(record, "settlement_account_id"),
    usualDueDay: typeof due === "number" ? due : null,
    freshnessHours: record.freshness_hours,
    transactionSignConvention: sign as CutoverSettings["transactionSignConvention"],
    signEvidence: text(record, "sign_evidence"),
    settingsFingerprint: requireText(record, "settings_fingerprint"),
  }
}

function snapshotOf(value: unknown): CutoverSnapshot | null {
  if (value === null || value === undefined) return null
  const record = readRecord(value)
  if (!record) throw unreadable()
  return {
    date: requireText(record, "date"),
    amountCents: parseCents(record.amount_cents),
    currencyCode: text(record, "currency_code"),
    observedAt: text(record, "observed_at"),
    snapshotFingerprint: requireText(record, "snapshot_fingerprint"),
  }
}

function accountOf(value: unknown): CutoverAccount {
  const record = readRecord(value)
  if (!record) throw unreadable()
  return {
    id: requireText(record, "account_id"),
    name: requireText(record, "name"),
    currencyCode: text(record, "currency_code"),
    settings: settingsOf(record.settings),
    latestSnapshot: snapshotOf(record.latest_snapshot),
    pendingIds: readArray(record.pending_ids).flatMap((entry) => (typeof entry === "string" && entry.length > 0 ? [entry] : [])),
  }
}

function fundOf(value: unknown): CutoverFund {
  const record = readRecord(value)
  if (!record) throw unreadable()
  const status = requireText(record, "status")
  const scope = requireText(record, "beneficiary_scope")
  if (status !== "active" && status !== "retired") throw unreadable()
  if (scope !== "shared" && scope !== "member") throw unreadable()
  return {
    id: requireText(record, "fund_id"),
    name: requireText(record, "name"),
    status,
    beneficiaryScope: scope,
    beneficiaryMemberId: text(record, "beneficiary_member_id"),
  }
}

function reconciliationOf(value: unknown): CutoverReconciliation | null {
  if (value === null || value === undefined) return null
  const record = readRecord(value)
  if (!record) throw unreadable()
  return {
    id: requireText(record, "reconciliation_id"),
    storedStatus: requireText(record, "stored_status"),
    status: requireText(record, "status"),
    asOf: text(record, "as_of"),
    openingFundCutover: text(record, "opening_fund_cutover"),
    fingerprint: text(record, "reconciliation_fingerprint"),
    reasons: readArray(record.reasons).flatMap((entry) => {
      const reason = readRecord(entry)
      const code = reason ? text(reason, "code") : null
      return code ? [code] : []
    }),
  }
}

export function readMemberList(payload: unknown): CutoverMember[] {
  const record = readRecord(payload)
  if (!record || !Array.isArray(record.members)) throw unreadable()
  return record.members.map((entry) => {
    const member = readRecord(entry)
    if (!member) throw unreadable()
    return { id: requireText(member, "id"), email: text(member, "email") }
  })
}

export function readCutover(payload: unknown): CutoverWorkspace {
  const record = readRecord(payload)
  if (!record) throw unreadable()
  return {
    members: readMemberList(record),
    categories: readArray(record.categories).map((entry) => {
      const category = readRecord(entry)
      if (!category) throw unreadable()
      return {
        id: requireText(category, "id"),
        name: requireText(category, "name"),
        groupName: text(category, "group_name"),
      }
    }),
    accounts: readArray(record.accounts).map(accountOf),
    funds: readArray(record.funds).map(fundOf),
    reconciliation: reconciliationOf(record.reconciliation),
    earmarks: readArray(record.earmarks).map((entry) => {
      const earmark = readRecord(entry)
      if (!earmark) throw unreadable()
      const amount = parseCents(earmark.amount_cents)
      if (!amount) throw unreadable()
      return {
        id: requireText(earmark, "id"),
        fundId: requireText(earmark, "fund_id"),
        accountId: requireText(earmark, "restricted_account_id"),
        amountCents: amount,
        effectiveOn: requireText(earmark, "effective_on"),
        reason: requireText(earmark, "reason"),
      }
    }),
    movements: readArray(record.movements).map((entry) => {
      const movement = readRecord(entry)
      if (!movement) throw unreadable()
      const amount = parseCents(movement.amount_cents)
      if (!amount) throw unreadable()
      return {
        id: requireText(movement, "movement_id"),
        kind: requireText(movement, "kind"),
        fromFundId: text(movement, "from_fund_id"),
        toFundId: text(movement, "to_fund_id"),
        amountCents: amount,
        effectiveOn: requireText(movement, "effective_on"),
        reason: requireText(movement, "reason"),
        budgetVersionId: text(movement, "budget_version_id"),
      }
    }),
  }
}
