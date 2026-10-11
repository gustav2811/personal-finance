"use client"

import { useRef, useState } from "react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { commandFailureIsUncertain, commandFailureText, holdCommand, type HeldCommand } from "@/domain/budget/command-attempt"
import { buildReviewPayload, newCommandId, type ReviewComponentInput } from "@/domain/budget/commands"
import { copy } from "@/domain/budget/copy"
import { memberName, type MemberRef } from "@/domain/budget/members"
import { randsToCents } from "@/domain/budget/move"
import type { ReviewFund } from "@/domain/budget/review"
import { writeBudgetRpc } from "./rpc"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"

type WhoseExpense = { kind: "shared" } | { kind: "member"; memberId: string }
type CategoryOption = { id: string; name: string }
type SplitRow = { key: string; amount: string; fundId: string; categoryId: string; whose: WhoseExpense | null }

function message(caught: unknown): string {
  return caught instanceof Error && caught.message.length > 0 ? caught.message : copy.couldNotSave
}

export function PurchaseReview({
  amountCents,
  categories,
  drifted,
  fingerprint,
  funds,
  members,
  onSaved,
  setId,
  siblingCount = 1,
  sourceTransactionId,
}: {
  amountCents: string
  categories: CategoryOption[]
  drifted: boolean
  fingerprint: string
  funds: ReviewFund[]
  members: MemberRef[]
  onSaved: () => Promise<void>
  setId: string | null
  siblingCount?: number
  sourceTransactionId: string
}) {
  const [mixed, setMixed] = useState(false)
  const [mode, setMode] = useState<"purchase" | "transfer" | "refund" | "debt">("purchase")
  const [whose, setWhose] = useState<WhoseExpense | null>(null)
  const [fundId, setFundId] = useState<string | null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [refundAllocationId, setRefundAllocationId] = useState("")
  const [openingRefundReason, setOpeningRefundReason] = useState("")
  const [debtKind, setDebtKind] = useState<"required_debt_payment" | "extra_debt_payment">("required_debt_payment")
  const [splitReason, setSplitReason] = useState("")
  const [rows, setRows] = useState<SplitRow[]>([
    { key: "a", amount: "", fundId: "", categoryId: "", whose: null },
    { key: "b", amount: "", fundId: "", categoryId: "", whose: null },
  ])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [outstanding, setOutstanding] = useState(false)
  const heldRef = useRef<HeldCommand | null>(null)
  const needsSplit = mixed || siblingCount > 1

  async function save(components: ReviewComponentInput[], evidence?: { splitReviewReason?: string; receiptReference?: string }) {
    const payload = buildReviewPayload({
      transactionId: sourceTransactionId,
      expectedSourceFingerprint: fingerprint,
      expectedCurrentSetId: setId ?? undefined,
      sourceAmountCents: amountCents,
      mixed,
      drifted,
      existingComponentCount: siblingCount,
      components,
      evidence,
      decisionUpdate: categoryId
        ? { categoryId, isTransfer: mode === "transfer", excludeFromSpend: mode === "transfer" }
        : undefined,
    })
    const fingerprintKey = JSON.stringify(payload)
    if (outstanding && heldRef.current && heldRef.current.fingerprint !== fingerprintKey) {
      setError(copy.retryOutstandingMovement)
      return
    }
    const held = holdCommand(
      outstanding ? heldRef.current : null,
      { name: "budget_review_allocation_v1", fingerprint: fingerprintKey, payload },
      newCommandId,
    )
    heldRef.current = held
    setSaving(true)
    setError(null)
    try {
      await writeBudgetRpc(held.name, held.id, held.payload)
      heldRef.current = null
      setOutstanding(false)
      await onSaved()
    } catch (caught: unknown) {
      const uncertain = commandFailureIsUncertain(commandFailureText(caught))
      if (!uncertain) {
        heldRef.current = null
        setOutstanding(false)
      } else {
        setOutstanding(true)
      }
      setError(uncertain ? copy.retryOutstandingMovement : message(caught))
    } finally {
      setSaving(false)
    }
  }

  function saveSimple() {
    if (!whose || !categoryId) return
    if (mode === "transfer") {
      void save([
        {
          amountCents,
          beneficiaryScope: whose.kind,
          beneficiaryMemberId: whose.kind === "member" ? whose.memberId : undefined,
          effectKind: "movement",
          categoryId,
        },
      ])
      return
    }
    if (mode === "refund") {
      if (!fundId) return
      void save([
        {
          amountCents,
          beneficiaryScope: whose.kind,
          beneficiaryMemberId: whose.kind === "member" ? whose.memberId : undefined,
          effectKind: "refund",
          fundId,
          categoryId,
          originalRefundAllocationId: refundAllocationId.trim() || undefined,
          openingRefundReason: openingRefundReason.trim() || undefined,
        },
      ])
      return
    }
    if (mode === "debt") {
      if (!fundId) return
      void save([
        {
          amountCents,
          beneficiaryScope: whose.kind,
          beneficiaryMemberId: whose.kind === "member" ? whose.memberId : undefined,
          effectKind: debtKind,
          fundId,
          categoryId,
        },
      ])
      return
    }
    if (needsSplit || !fundId) return
    void save([
      {
        amountCents,
        beneficiaryScope: whose.kind,
        beneficiaryMemberId: whose.kind === "member" ? whose.memberId : undefined,
        effectKind: "consumption",
        fundId,
        categoryId,
      },
    ])
  }

  function saveSplit() {
    const components = rows.flatMap((row) => {
      const cents = randsToCents(row.amount)
      if (!cents || cents === "0" || !row.fundId || !row.categoryId || !row.whose) return []
      const signed = cents.startsWith("-") ? cents : `-${cents}`
      return [
        {
          amountCents: signed,
          beneficiaryScope: row.whose.kind,
          beneficiaryMemberId: row.whose.kind === "member" ? row.whose.memberId : undefined,
          effectKind: "consumption" as const,
          fundId: row.fundId,
          categoryId: row.categoryId,
        },
      ]
    })
    if (components.length < 2) {
      setError(copy.mixedNeedsSplit)
      return
    }
    void save(components, { splitReviewReason: splitReason, receiptReference: splitReason })
  }

  return (
    <div className="space-y-3">
      {drifted ? <p className="type-caption text-muted-foreground">{copy.driftedNeedsSplit}</p> : null}
      {needsSplit ? <p className="type-caption text-muted-foreground">{copy.mixedNeedsSplit}</p> : null}
      <ToggleGroup
        aria-label={copy.purchase}
        onValueChange={(next) => {
          if (next === "purchase" || next === "transfer" || next === "refund" || next === "debt") setMode(next)
        }}
        size="sm"
        spacing={0}
        type="single"
        value={mode}
        variant="outline"
      >
        <ToggleGroupItem className={TOUCH} value="purchase">{copy.purchase}</ToggleGroupItem>
        <ToggleGroupItem className={TOUCH} value="transfer">{copy.transferNotPurchase}</ToggleGroupItem>
        <ToggleGroupItem className={TOUCH} value="refund">Refund</ToggleGroupItem>
        <ToggleGroupItem className={TOUCH} value="debt">{copy.commitments}</ToggleGroupItem>
      </ToggleGroup>
      {mode === "purchase" ? (
        <label className="flex items-center gap-2 text-sm">
          <input checked={mixed} onChange={(event) => setMixed(event.target.checked)} type="checkbox" />
          Mixed purchase
        </label>
      ) : null}
      {needsSplit && mode === "purchase" ? (
        <div className="space-y-3">
          {rows.map((row) => (
            <div className="grid gap-2 @md:grid-cols-4" key={row.key}>
              <Input aria-label="Amount" onChange={(event) => setRows(rows.map((entry) => entry.key === row.key ? { ...entry, amount: event.target.value } : entry))} value={row.amount} />
              <Select onValueChange={(next) => { if (next) setRows(rows.map((entry) => entry.key === row.key ? { ...entry, fundId: next } : entry)) }} value={row.fundId || undefined}>
                <SelectTrigger aria-label={copy.purposes}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {funds.map((fund) => <SelectItem key={fund.id} value={fund.id}>{fund.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select onValueChange={(next) => { if (next) setRows(rows.map((entry) => entry.key === row.key ? { ...entry, categoryId: next } : entry)) }} value={row.categoryId || undefined}>
                <SelectTrigger aria-label="Category"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select onValueChange={(next) => {
                if (!next) return
                const whoseNext = next === "shared" ? { kind: "shared" as const } : { kind: "member" as const, memberId: next }
                setRows(rows.map((entry) => entry.key === row.key ? { ...entry, whose: whoseNext } : entry))
              }}>
                <SelectTrigger aria-label={copy.whoseExpense}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="shared">{copy.shared}</SelectItem>
                  {members.map((member) => <SelectItem key={member.id} value={member.id}>{memberName(members, member.id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
          <Input aria-label="Split reason" onChange={(event) => setSplitReason(event.target.value)} placeholder="Why this purchase is mixed" value={splitReason} />
          <Button disabled={saving} onClick={saveSplit} type="button">Save split</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Whose members={members} onChange={setWhose} value={whose} />
          {mode === "transfer" ? null : (
            <FundSelect fundId={fundId} funds={funds} onChange={setFundId} />
          )}
          <CategorySelect categories={categories} categoryId={categoryId} onChange={setCategoryId} />
          {mode === "refund" ? (
            <>
              <Input aria-label="Original allocation" onChange={(event) => setRefundAllocationId(event.target.value)} placeholder="Original allocation" value={refundAllocationId} />
              <Input aria-label={copy.refundNeedsLink} onChange={(event) => setOpeningRefundReason(event.target.value)} placeholder="Opening refund reason" value={openingRefundReason} />
            </>
          ) : null}
          {mode === "debt" ? (
            <ToggleGroup aria-label={copy.commitments} onValueChange={(next) => { if (next === "required_debt_payment" || next === "extra_debt_payment") setDebtKind(next) }} size="sm" type="single" value={debtKind} variant="outline">
              <ToggleGroupItem value="required_debt_payment">Required</ToggleGroupItem>
              <ToggleGroupItem value="extra_debt_payment">Extra</ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <Button disabled={saving || (needsSplit && mode === "purchase")} onClick={saveSimple} type="button">Save</Button>
        </div>
      )}
      {error ? <Alert><AlertDescription>{error}</AlertDescription></Alert> : null}
    </div>
  )
}

function Whose({ members, onChange, value }: { members: MemberRef[]; onChange: (next: WhoseExpense) => void; value: WhoseExpense | null }) {
  return (
    <ToggleGroup aria-label={copy.whoseExpense} onValueChange={(next) => { if (next === "shared") onChange({ kind: "shared" }); else if (next) onChange({ kind: "member", memberId: next }) }} size="sm" type="single" value={value?.kind === "member" ? value.memberId : value?.kind} variant="outline">
      <ToggleGroupItem className={TOUCH} value="shared">{copy.shared}</ToggleGroupItem>
      {members.map((member) => <ToggleGroupItem className={TOUCH} key={member.id} value={member.id}>{memberName(members, member.id)}</ToggleGroupItem>)}
    </ToggleGroup>
  )
}

function FundSelect({ fundId, funds, onChange }: { fundId: string | null; funds: ReviewFund[]; onChange: (id: string) => void }) {
  return (
    <Select onValueChange={(next) => { if (next) onChange(next) }} value={fundId ?? undefined}>
      <SelectTrigger aria-label={copy.purposes} className="pointer-coarse:h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        {funds.map((fund) => <SelectItem key={fund.id} value={fund.id}>{fund.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function CategorySelect({ categories, categoryId, onChange }: { categories: CategoryOption[]; categoryId: string | null; onChange: (id: string) => void }) {
  return (
    <Select onValueChange={(next) => { if (next) onChange(next) }} value={categoryId ?? undefined}>
      <SelectTrigger aria-label="Category" className="pointer-coarse:h-9"><SelectValue /></SelectTrigger>
      <SelectContent>
        {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

export function AlreadyApproved({ sentence }: { sentence: string }) {
  return <p>{sentence} {copy.alreadyApproved}</p>
}
