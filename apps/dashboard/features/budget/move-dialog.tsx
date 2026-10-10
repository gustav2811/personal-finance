"use client"

import { useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { buildMoveFundsPayload, newCommandId, type MoveKind } from "@/domain/budget/commands"
import { copy } from "@/domain/budget/copy"
import { moveConfirmCopy, randsToCents } from "@/domain/budget/move"
import { localDateKey } from "@/lib/format/date"
import { writeBudgetRpc } from "./rpc"

const TOUCH = "pointer-coarse:h-9 pointer-coarse:px-3"
const KINDS = ["assign", "release", "reallocate"] as const

export type MoveFund = {
  id: string
  name: string
  balanceLabel: string
}

type Endpoints = {
  fromFundId?: string
  toFundId?: string
  fromName: string
  toName: string
  fromBalance: string | null
  toBalance: string | null
}

function isKind(value: string): value is MoveKind {
  return value === "assign" || value === "release" || value === "reallocate"
}

function fundById(funds: readonly MoveFund[], id: string): MoveFund | null {
  if (!id) return null
  return funds.find((fund) => fund.id === id) ?? null
}

function resolveEndpoints(kind: MoveKind, fromId: string, toId: string, funds: readonly MoveFund[]): Endpoints | null {
  const from = fundById(funds, fromId)
  const to = fundById(funds, toId)
  switch (kind) {
    case "assign":
      if (!to) return null
      return {
        toFundId: to.id,
        fromName: copy.unassigned,
        toName: to.name,
        fromBalance: null,
        toBalance: to.balanceLabel,
      }
    case "release":
      if (!from) return null
      return {
        fromFundId: from.id,
        fromName: from.name,
        toName: copy.unassigned,
        fromBalance: from.balanceLabel,
        toBalance: null,
      }
    case "reallocate":
      if (!from || !to || from.id === to.id) return null
      return {
        fromFundId: from.id,
        toFundId: to.id,
        fromName: from.name,
        toName: to.name,
        fromBalance: from.balanceLabel,
        toBalance: to.balanceLabel,
      }
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

function optionLabel(fund: MoveFund): string {
  return fund.balanceLabel ? `${fund.name} · ${fund.balanceLabel}` : fund.name
}

function FundSelect({
  funds,
  id,
  label,
  onChange,
  value,
}: {
  funds: readonly MoveFund[]
  id: string
  label: string
  onChange: (next: string) => void
  value: string
}) {
  return (
    <Select onValueChange={onChange} value={value || undefined}>
      <SelectTrigger aria-label={label} className="w-full" id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {funds.map((fund) => (
          <SelectItem key={fund.id} value={fund.id}>
            {optionLabel(fund)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function MoveMoneyDialog({
  canAssign,
  versionId,
  reconciliationId,
  reconciliationFingerprint,
  funds,
  onSaved,
}: {
  canAssign: boolean
  versionId: string | null
  reconciliationId: string | null
  reconciliationFingerprint: string | null
  funds: MoveFund[]
  onSaved?: () => void
}) {
  const pendingRef = useRef(false)
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<MoveKind | null>(null)
  const [fromId, setFromId] = useState("")
  const [toId, setToId] = useState("")
  const [amount, setAmount] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  const blocked = !canAssign || versionId === null || reconciliationId === null || reconciliationFingerprint === null
  const ends = kind ? resolveEndpoints(kind, fromId, toId, funds) : null
  const amountCents = randsToCents(amount)
  const sentences =
    kind && ends && amountCents
      ? moveConfirmCopy({
          kind,
          fromName: ends.fromName,
          toName: ends.toName,
          amountCents,
        })
      : null

  function reset() {
    setKind(null)
    setFromId("")
    setToId("")
    setAmount("")
    setError(null)
    setPending(false)
    pendingRef.current = false
  }

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) reset()
  }

  async function confirm() {
    if (pendingRef.current) return
    if (!canAssign || versionId === null || reconciliationId === null || reconciliationFingerprint === null) return
    if (!kind || !ends || !amountCents) return
    pendingRef.current = true
    setPending(true)
    setError(null)
    try {
      const payload = buildMoveFundsPayload({
        kind,
        fromFundId: ends.fromFundId,
        toFundId: ends.toFundId,
        amountCents,
        effectiveOn: localDateKey(new Date().toISOString()),
        expectedVersionId: versionId,
        expectedReconciliationId: reconciliationId,
        expectedReconciliationFingerprint: reconciliationFingerprint,
        reason: copy.moveBetweenPurposes,
      })
      await writeBudgetRpc("budget_move_funds_v1", newCommandId(), payload)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : copy.couldNotSave)
      return
    } finally {
      pendingRef.current = false
      setPending(false)
    }
    onSaved?.()
    onOpenChange(false)
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogTrigger asChild>
        <Button className={TOUCH} size="sm" type="button" variant="outline">
          {copy.moveBetweenPurposes}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{copy.moveBetweenPurposes}</DialogTitle>
          <DialogDescription className="sr-only">
            {blocked ? `${copy.needsReconciliation} ${copy.cannotCreateMoney}` : copy.planUnchanged}
          </DialogDescription>
        </DialogHeader>
        {blocked ? (
          <Alert>
            <AlertTitle>{copy.needsReconciliation}</AlertTitle>
            <AlertDescription>{copy.cannotCreateMoney}</AlertDescription>
          </Alert>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void confirm()
            }}
          >
            <ToggleGroup
              aria-label={copy.moveBetweenPurposes}
              className="w-full"
              onValueChange={(next) => {
                setKind(isKind(next) ? next : null)
                setFromId("")
                setToId("")
                setError(null)
              }}
              size="sm"
              spacing={0}
              type="single"
              value={kind ?? ""}
              variant="outline"
            >
              {KINDS.map((entry) => (
                <ToggleGroupItem className={`flex-1 ${TOUCH}`} key={entry} value={entry}>
                  {entry}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {kind ? (
              <div className="space-y-2">
                {kind === "assign" ? (
                  <p className="type-body">{copy.unassigned}</p>
                ) : (
                  <FundSelect
                    funds={kind === "reallocate" ? funds.filter((fund) => fund.id !== toId) : funds}
                    id="move-from"
                    label={ends?.fromName ?? kind}
                    onChange={setFromId}
                    value={fromId}
                  />
                )}
                <p aria-hidden="true" className="type-caption text-center text-muted-foreground">
                  ↓
                </p>
                {kind === "release" ? (
                  <p className="type-body">{copy.unassigned}</p>
                ) : (
                  <FundSelect
                    funds={kind === "reallocate" ? funds.filter((fund) => fund.id !== fromId) : funds}
                    id="move-to"
                    label={ends?.toName ?? kind}
                    onChange={setToId}
                    value={toId}
                  />
                )}
                <InputGroup>
                  <InputGroupAddon>
                    <InputGroupText>R</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-invalid={error ? true : undefined}
                    aria-label={sentences?.[3] ?? copy.moveBetweenPurposes}
                    autoComplete="off"
                    className="type-numeric"
                    inputMode="decimal"
                    onChange={(event) => setAmount(event.target.value)}
                    value={amount}
                  />
                </InputGroup>
              </div>
            ) : null}
            {sentences && ends ? (
              <ul className="space-y-1">
                <li className="type-body">{sentences[0]}</li>
                <li className="type-body">
                  {sentences[1]}
                  {ends.fromBalance ? (
                    <span className="type-numeric text-muted-foreground"> {ends.fromBalance}</span>
                  ) : null}
                </li>
                <li className="type-body">
                  {sentences[2]}
                  {ends.toBalance ? (
                    <span className="type-numeric text-muted-foreground"> {ends.toBalance}</span>
                  ) : null}
                </li>
                <li className="type-numeric text-2xl font-semibold tracking-tight">{sentences[3]}</li>
                <li className="type-caption text-muted-foreground">{sentences[4]}</li>
              </ul>
            ) : (
              <p className="type-caption text-muted-foreground">{copy.planUnchanged}</p>
            )}
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <DialogFooter>
              <Button className={TOUCH} disabled={pending || !sentences} type="submit">
                {copy.moveBetweenPurposes}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
