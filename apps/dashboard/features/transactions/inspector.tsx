"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { shortDate } from "@/lib/format/date"
import {
  setTransactionTreatment,
  SignInRequiredError,
  type LedgerActivity,
  type TransactionDetail,
  type TransactionFeedItem,
} from "@/lib/transactions"
import { commandId, formatAmount, moneyDirection, subject, words } from "./copy"

export function Inspector({
  activity,
  detail,
  detailError,
  detailLoading,
  item,
  onRetryDetail,
  onTreatmentSaved,
}: {
  activity: LedgerActivity | null
  detail: TransactionDetail | undefined
  detailError: string | null
  detailLoading: boolean
  item: TransactionFeedItem
  onRetryDetail: () => void
  onTreatmentSaved: (item: TransactionFeedItem) => void
}) {
  const [isTransfer, setIsTransfer] = useState<boolean | null>(item.treatment.isTransfer)
  const [excludeFromSpend, setExcludeFromSpend] = useState<boolean | null>(
    item.treatment.excludeFromSpend,
  )
  const [nature, setNature] = useState(item.treatment.nature ?? "")
  const [treatmentError, setTreatmentError] = useState<string | null>(null)
  const [savingTreatment, setSavingTreatment] = useState(false)
  const direction = moneyDirection(item.amount)

  useEffect(() => {
    setIsTransfer(item.treatment.isTransfer)
    setExcludeFromSpend(item.treatment.excludeFromSpend)
    setNature(item.treatment.nature ?? "")
    setTreatmentError(null)
  }, [item])

  async function saveTreatment() {
    if (isTransfer == null || excludeFromSpend == null) return
    setSavingTreatment(true)
    setTreatmentError(null)
    try {
      const result = await setTransactionTreatment({
        excludeFromSpend,
        expectedConfirmedTreatmentId: item.revision.confirmedTreatmentId,
        expectedProposedTreatmentId: item.revision.proposedTreatmentId,
        isTransfer,
        nature: nature.trim() || null,
        reviewCommandId: commandId(),
        transactionId: item.id,
      })
      onTreatmentSaved(result.item)
      if (result.conflict) {
        setTreatmentError("Treatment changed. Showing the current decision.")
      }
    } catch (error) {
      setTreatmentError(
        error instanceof Error ? error.message : "Treatment could not be saved.",
      )
      if (error instanceof SignInRequiredError) {
        setTreatmentError(error.message)
      }
    } finally {
      setSavingTreatment(false)
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1 pr-8">
        <h2 className="type-section-title">{subject(item)}</h2>
        <p className="type-numeric text-base">
          <span className="sr-only">{direction === "out" ? "Money out" : "Money in"}</span>
          {formatAmount(item.amount, item.currencyCode)}
        </p>
        <p className="type-caption">
          {shortDate(item.occurredOn)} · {item.account.name}
        </p>
      </header>

      {detailLoading ? <Skeleton className="h-16 w-full" /> : null}
      {detailError ? (
        <p className="type-body-small text-destructive">
          {detailError}{" "}
          <Button onClick={onRetryDetail} size="sm" variant="ghost">
            Retry
          </Button>
        </p>
      ) : null}
      {item.event ? (
        <p className="type-body-small text-muted-foreground">
          Part of {words(item.event.type)}, as {words(item.event.role)}. Treatment stays with the
          event.
        </p>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void saveTreatment()
        }}
      >
        <div className="space-y-1">
          <h3 className="type-label">Spend treatment</h3>
          <p className="type-caption">This does not change the category.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Transfer</Label>
          <ToggleGroup
            onValueChange={(value) => {
              if (value === "yes" || value === "no") setIsTransfer(value === "yes")
            }}
            size="sm"
            spacing={0}
            type="single"
            value={isTransfer == null ? "" : isTransfer ? "yes" : "no"}
            variant="outline"
          >
            <ToggleGroupItem value="yes">Transfer</ToggleGroupItem>
            <ToggleGroupItem value="no">Not a transfer</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <Label>Spend</Label>
          <ToggleGroup
            onValueChange={(value) => {
              if (value === "include" || value === "exclude") {
                setExcludeFromSpend(value === "exclude")
              }
            }}
            size="sm"
            spacing={0}
            type="single"
            value={
              excludeFromSpend == null ? "" : excludeFromSpend ? "exclude" : "include"
            }
            variant="outline"
          >
            <ToggleGroupItem value="include">Include</ToggleGroupItem>
            <ToggleGroupItem value="exclude">Exclude</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="treatment-nature">Nature</Label>
          <Input
            id="treatment-nature"
            maxLength={80}
            onChange={(event) => setNature(event.target.value)}
            value={nature}
          />
        </div>
        <Button
          disabled={savingTreatment || isTransfer == null || excludeFromSpend == null}
          size="sm"
          type="submit"
        >
          {savingTreatment ? "Saving…" : "Save treatment"}
        </Button>
        {treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {treatmentError}
          </p>
        ) : null}
      </form>

      <details className="space-y-2">
        <summary className="type-label cursor-pointer">Source and classifier</summary>
        <dl className="space-y-2 pt-2">
          <Fact label="FinWise category" value={item.source.categoryName ?? "None recorded"} />
          <Fact
            label="Classifier"
            value={
              item.classifier.classifier
                ? `${item.classifier.classifier} ${item.classifier.classifierVersion ?? ""} · ${item.classifier.state}`.trim()
                : "Not run"
            }
          />
          <Fact
            label="FinWise sync"
            value={activity?.lastFinwiseSyncAt ? shortDate(activity.lastFinwiseSyncAt) : "Not recorded"}
          />
          {detail?.history.eventLegs.map((leg) => (
            <Fact
              key={`${leg.transactionId}-${leg.role}`}
              label={words(leg.role)}
              value={`${leg.accountName}${leg.description ? ` · ${leg.description}` : ""}`}
            />
          ))}
        </dl>
      </details>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="type-caption">{label}</dt>
      <dd className="type-body-small">{value}</dd>
    </div>
  )
}
