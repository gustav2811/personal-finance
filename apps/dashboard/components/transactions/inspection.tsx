"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatAmount } from "@/lib/format"
import {
  setTransactionTreatment,
  SignInRequiredError,
  type LedgerActivity,
  type TransactionDetail,
  type TransactionFeedItem,
} from "@/lib/transactions"
import {
  classifierSummary,
  commandId,
  formatDay,
  formatWhen,
  storyBeats,
  subject,
  words,
} from "./model"

export function Inspection({
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
  const beats = storyBeats(item, detail)
  const amount = Number(item.amount)

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
        error instanceof SignInRequiredError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Treatment could not be saved.",
      )
    } finally {
      setSavingTreatment(false)
    }
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1 pr-8">
        <h2 className="type-section-title">{subject(item)}</h2>
        <p className="type-numeric text-lg font-semibold">
          <span className="sr-only">{amount < 0 ? "Money out" : "Money in"}</span>
          {formatAmount(item.amount, item.currencyCode)}
        </p>
        <p className="type-caption">
          {formatDay(item.occurredOn)} · {item.account.name}
        </p>
      </header>
      <ol className="space-y-3">
        {beats.map((beat, index) => (
          <li key={`${beat.label}-${beat.title}-${index}`}>
            <p className="type-label text-muted-foreground">{beat.label}</p>
            <p className="text-sm font-medium">{beat.title}</p>
            {beat.meta ? <p className="type-caption">{beat.meta}</p> : null}
          </li>
        ))}
      </ol>
      {detailLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-full" />
          <span className="sr-only">Reading the history</span>
        </div>
      ) : null}
      {detailError ? (
        <p className="type-body-small text-destructive" role="alert">
          {detailError}{" "}
          <Button onClick={onRetryDetail} size="sm" variant="link">
            Retry inspection
          </Button>
        </p>
      ) : null}
      {item.event ? (
        <p className="type-body-small text-muted-foreground">
          Part of {words(item.event.type)}, as {words(item.event.role)}.
        </p>
      ) : null}
      <form
        className="space-y-3 border-t pt-4"
        onSubmit={(event) => {
          event.preventDefault()
          void saveTreatment()
        }}
      >
        <div>
          <h3 className="type-label">Spend treatment</h3>
          <p className="type-caption">Changing this does not change the category.</p>
        </div>
        <div className="space-y-1.5">
          <Label>Transfer</Label>
          <ToggleGroup
            aria-label="Transfer"
            onValueChange={(value) => {
              if (value === "yes") setIsTransfer(true)
              if (value === "no") setIsTransfer(false)
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
            aria-label="Spend"
            onValueChange={(value) => {
              if (value === "include") setExcludeFromSpend(false)
              if (value === "exclude") setExcludeFromSpend(true)
            }}
            size="sm"
            spacing={0}
            type="single"
            value={
              excludeFromSpend == null ? "" : excludeFromSpend ? "exclude" : "include"
            }
            variant="outline"
          >
            <ToggleGroupItem value="include">Include in spend</ToggleGroupItem>
            <ToggleGroupItem value="exclude">Exclude</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`nature-${item.id}`}>Nature</Label>
          <Input
            id={`nature-${item.id}`}
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
          {savingTreatment ? "Saving treatment…" : "Save treatment"}
        </Button>
        {treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {treatmentError}
          </p>
        ) : null}
      </form>
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost">
            Classifier and source
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          <Fact label="FinWise category" value={item.source.categoryName ?? "None recorded"} />
          <Fact
            label="Source transfer"
            value={
              item.source.isTransfer == null
                ? "Not recorded"
                : item.source.isTransfer
                  ? "Marked transfer"
                  : "Not a transfer"
            }
          />
          <Fact label="Classifier" value={classifierSummary(item)} />
          <Fact
            label="FinWise sync"
            value={
              activity?.lastFinwiseSyncAt
                ? formatWhen(activity.lastFinwiseSyncAt)
                : "Not recorded"
            }
          />
          {detail
            ? detail.history.runs.map((run) => (
                <Fact
                  key={run.id}
                  label="Run"
                  value={`${run.classifier} ${run.classifierVersion} · ${run.status}${
                    run.completedAt ? ` · ${formatWhen(run.completedAt)}` : ""
                  }`}
                />
              ))
            : null}
          {detail && detail.history.eventLegs.length > 1
            ? detail.history.eventLegs.map((leg) => (
                <Fact
                  key={`${leg.transactionId}-${leg.role}`}
                  label={words(leg.role)}
                  value={`${leg.accountName}${leg.description ? ` · ${leg.description}` : ""}`}
                />
              ))
            : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="type-body-small">{value}</dd>
    </div>
  )
}
