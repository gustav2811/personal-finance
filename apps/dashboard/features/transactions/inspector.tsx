"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ArrowLeftRight, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { shortDate } from "@/lib/format/date"
import {
  setTransactionTreatment,
  type CategoryOption,
  type TransactionFeedItem,
} from "@/lib/transactions"
import { commandId, formatAmount, moneyDirection, subject } from "./copy"

export function Inspector({
  categories,
  categoryError,
  item,
  onClassify,
  onTreatmentSaved,
  onUndo,
  pending,
  undo,
}: {
  categories: CategoryOption[]
  categoryError: string | null
  item: TransactionFeedItem
  onClassify: (category: CategoryOption) => void
  onTreatmentSaved: (item: TransactionFeedItem) => void
  onUndo: () => void
  pending: boolean
  undo: boolean
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
      setTreatmentError(result.conflict ? "Treatment changed. Showing the current decision." : null)
    } catch (error) {
      setTreatmentError(error instanceof Error ? error.message : "Treatment could not be saved.")
    } finally {
      setSavingTreatment(false)
    }
  }

  async function copyDescription() {
    await navigator.clipboard.writeText(item.description)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 pr-8">
        <h2 className="min-w-0 flex-1 text-base font-medium text-balance">{subject(item)}</h2>
        <Button aria-label="Copy description" onClick={() => void copyDescription()} size="icon-sm" variant="ghost">
          <Copy />
        </Button>
      </div>

      <div className="divide-y rounded-lg border">
        <Fact label="Description" value={item.description} />
        <Fact label="Merchant" value={item.merchant.name ?? "None"} />
        <Fact label="Posted" value={shortDate(item.occurredOn)} />
        <Fact label="Account" value={item.account.name} />
        <Fact
          label="Amount"
          value={
            <span className={direction === "in" ? "text-electric-cyan-700" : "text-shocking-pink-700"}>
              <span className="sr-only">{direction === "out" ? "Money out" : "Money in"}</span>
              {formatAmount(item.amount, item.currencyCode)}
            </span>
          }
        />
      </div>

      <div className="divide-y rounded-lg border">
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 px-3 py-2" data-category-for={item.id}>
          <span className="text-muted-foreground">Category</span>
          <Combobox
            items={categories.map((category) => category.name)}
            onValueChange={(value) => {
              const category = categories.find((entry) => entry.name === value)
              if (category) onClassify(category)
            }}
            value={item.category.name}
          >
            <ComboboxInput aria-label="Category" disabled={pending} placeholder="Uncategorised" showClear={false} />
            <ComboboxContent>
              <ComboboxEmpty>No category</ComboboxEmpty>
              <ComboboxList>
                {(name: string) => (
                  <ComboboxItem key={name} value={name}>
                    {name}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 px-3 py-2">
          <span className="text-muted-foreground">Transfer</span>
          <ToggleGroup
            aria-label="Transfer"
            onValueChange={(value) => {
              if (value === "yes" || value === "no") setIsTransfer(value === "yes")
            }}
            size="sm"
            spacing={0}
            type="single"
            value={isTransfer == null ? "" : isTransfer ? "yes" : "no"}
            variant="outline"
          >
            <ToggleGroupItem value="no">No</ToggleGroupItem>
            <ToggleGroupItem value="yes">
              <ArrowLeftRight />
              Yes
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 px-3 py-2">
          <span className="text-muted-foreground">Spend</span>
          <ToggleGroup
            aria-label="Spend"
            onValueChange={(value) => {
              if (value === "include" || value === "exclude") setExcludeFromSpend(value === "exclude")
            }}
            size="sm"
            spacing={0}
            type="single"
            value={excludeFromSpend == null ? "" : excludeFromSpend ? "exclude" : "include"}
            variant="outline"
          >
            <ToggleGroupItem value="include">Include</ToggleGroupItem>
            <ToggleGroupItem value="exclude">Exclude</ToggleGroupItem>
          </ToggleGroup>
        </div>
        {showNature(nature) ? (
          <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 px-3 py-2">
            <span className="text-muted-foreground">Nature</span>
            <span className="text-right">{nature}</span>
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        {categoryError ? (
          <p className="type-caption text-destructive" role="status">
            {categoryError}
          </p>
        ) : null}
        {undo ? (
          <Button onClick={onUndo} size="sm" variant="ghost">
            Undo
          </Button>
        ) : null}
        {isTransfer == null || excludeFromSpend == null ? (
          <p className="type-caption">Set transfer and spend before saving.</p>
        ) : null}
        {treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {treatmentError}
          </p>
        ) : null}
        <Button
          disabled={savingTreatment || isTransfer == null || excludeFromSpend == null}
          onClick={() => void saveTreatment()}
          size="sm"
          title={
            isTransfer == null || excludeFromSpend == null
              ? "Set transfer and spend before saving."
              : undefined
          }
        >
          {savingTreatment ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  )
}

function showNature(nature: string): boolean {
  const value = nature.trim().toLowerCase()
  return value !== "" && value !== "purchase" && value !== "other"
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-3 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-balance">{value}</span>
    </div>
  )
}
