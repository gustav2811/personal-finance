"use client"

import { useEffect, useState, type ReactNode } from "react"
import { ArrowLeftRight, Copy } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
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
import { rankCategories, useCategoryRanking } from "./category-suggest"
import type { CategoryOption, TransactionFeedItem, TransactionInspection } from "./model"
import { getTransaction } from "./queries"
import { formatAmount, moneyDirection, subject } from "./copy"

export function Inspector({
  categories,
  categoryError,
  item,
  onConfirm,
  onUndo,
  onDirtyChange,
  pending,
  undo,
  budget,
}: {
  categories: CategoryOption[]
  categoryError: string | null
  item: TransactionFeedItem
  onConfirm: (input: {
    isTransfer: boolean | null
    excludeFromSpend: boolean | null
    nature: string | null
    categoryId: string | null
    description: string
    notes: string | null
  }) => Promise<string | null>
  onDirtyChange: (dirty: boolean) => void
  onUndo: () => void
  pending: boolean
  undo: boolean
  budget?: ReactNode
}) {
  const [isTransfer, setIsTransfer] = useState<boolean | null>(item.treatment.isTransfer)
  const [excludeFromSpend, setExcludeFromSpend] = useState<boolean | null>(
    item.treatment.excludeFromSpend,
  )
  const [nature, setNature] = useState(item.treatment.nature ?? "")
  const [treatmentError, setTreatmentError] = useState<string | null>(null)
  const [treatmentSaved, setTreatmentSaved] = useState(false)
  const [savingTreatment, setSavingTreatment] = useState(false)
  const [inspection, setInspection] = useState<TransactionInspection | null>(null)
  const direction = moneyDirection(item.amount)
  const [selectedCategory, setSelectedCategory] = useState(() => categoryValue(categories, item))
  const [description, setDescription] = useState(item.description)
  const [notes, setNotes] = useState(item.notes ?? "")
  const categoryItems = selectedCategory && !categories.some((entry) => entry.id === selectedCategory.id)
    ? [selectedCategory, ...categories]
    : categories
  const [categoryInput, setCategoryInput] = useState("")
  const categoryQuery = selectedCategory && categoryInput === categoryLabel(selectedCategory) ? "" : categoryInput
  const { loading: ranking, ranking: categoryRanking } = useCategoryRanking(categoryQuery)
  const { items: matchedCategories, probabilityById } = rankCategories(categoryItems, categoryQuery, categoryRanking)
  const treatmentKey = [
    item.id,
    item.revision.confirmedTreatmentId ?? "",
    item.revision.proposedTreatmentId ?? "",
    String(item.treatment.isTransfer),
    String(item.treatment.excludeFromSpend),
    item.treatment.nature ?? "",
  ].join(":")

  const dirty = description.trim() !== item.description || (notes.trim() || null) !== (item.notes ?? null)
    || (selectedCategory?.id ?? null) !== item.category.id
    || isTransfer !== item.treatment.isTransfer || excludeFromSpend !== item.treatment.excludeFromSpend
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

  useEffect(() => {
    setIsTransfer(item.treatment.isTransfer)
    setExcludeFromSpend(item.treatment.excludeFromSpend)
    setNature(item.treatment.nature ?? "")
    setTreatmentError(null)
  }, [treatmentKey, item.treatment.excludeFromSpend, item.treatment.isTransfer, item.treatment.nature])

  useEffect(() => {
    setTreatmentSaved(false)
  }, [item.id])

  useEffect(() => {
    let cancelled = false
    setInspection(null)
    void getTransaction(item.id)
      .then((detail) => {
        if (!cancelled) setInspection(detail)
      })
      .catch(() => {
        if (!cancelled) setInspection(null)
      })
    return () => {
      cancelled = true
    }
  }, [item.id, item.revision.confirmedClassificationId])

  async function saveTreatment() {
    if (!description.trim()) return
    setSavingTreatment(true)
    setTreatmentError(null)
    try {
      const error = await onConfirm({
        excludeFromSpend,
        isTransfer,
        categoryId: selectedCategory?.id ?? null,
        description: description.trim(),
        notes: notes.trim() || null,
        nature: nature.trim() || null,
      })
      setTreatmentError(error)
      setTreatmentSaved(error == null)
    } catch (error) {
      setTreatmentError(error instanceof Error ? error.message : "Treatment could not be saved.")
    } finally {
      setSavingTreatment(false)
    }
  }

  async function copyDescription() {
    await navigator.clipboard.writeText(item.description)
  }

  const lines = provenanceLines(item, inspection)

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 pr-8">
        <h2 className="min-w-0 flex-1 text-base font-medium text-balance">{subject(item)}</h2>
        <Button aria-label="Copy description" onClick={() => void copyDescription()} size="icon-sm" variant="ghost">
          <Copy />
        </Button>
      </div>

      <div className="divide-y rounded-lg border">
        <div className="space-y-2 px-3 py-2">
          <Label htmlFor="transaction-description">Description</Label>
          <Input id="transaction-description" value={description} onChange={(event) => { setDescription(event.target.value); setTreatmentSaved(false) }} disabled={savingTreatment} />
          {item.originalDescription && item.originalDescription !== description ? <p className="type-caption text-muted-foreground">Original: {item.originalDescription}</p> : null}
        </div>
        <div className="space-y-2 px-3 py-2">
          <Label htmlFor="transaction-notes">Notes</Label>
          <Textarea rows={3} id="transaction-notes" placeholder="Add a note about this transaction" value={notes} onChange={(event) => { setNotes(event.target.value); setTreatmentSaved(false) }} disabled={savingTreatment} />
        </div>
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

      {lines.length > 0 ? (
        <div className="divide-y rounded-lg border">
          {lines.map((line) => (
            <Fact key={line.label} label={line.label} value={line.value} />
          ))}
          {inspection && inspection.runs.length > 0 ? (
            <details className="px-3 py-2">
              <summary className="cursor-pointer text-muted-foreground">Classifier runs</summary>
              <ul className="mt-2 space-y-1">
                {inspection.runs.map((run, index) => (
                  <li className="type-caption text-muted-foreground" key={`${run.classifier}-${index}`}>
                    {run.classifier} · {run.status}
                    {run.categoryName ? ` · ${run.categoryName}` : ""}
                    {run.confidence != null ? ` · ${Math.round(run.confidence * 100)}%` : ""}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="divide-y rounded-lg border">
        <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 px-3 py-2" data-category-for={item.id}>
          <span className="text-muted-foreground">Category</span>
          <Combobox
            autoHighlight
            filteredItems={matchedCategories}
            items={categoryItems}
            itemToStringLabel={categoryLabel}
            itemToStringValue={(category) => category.id}
            isItemEqualToValue={(first, second) => first.id === second.id}
            onInputValueChange={setCategoryInput}
            onValueChange={(category) => {
              if (category) { setSelectedCategory(category); setTreatmentSaved(false) }
            }}
            value={selectedCategory}
          >
            <ComboboxInput
              aria-label="Category"
              disabled={pending || savingTreatment}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => {
                if (selectedCategory && event.currentTarget.value === categoryLabel(selectedCategory)) {
                  event.currentTarget.select()
                }
              }}
              placeholder="Uncategorised"
              showClear={false}
            />
            {/* The popup is portalled outside Radix Dialog, whose modal layer disables outside mouse events. */}
            <ComboboxContent className="pointer-events-auto">
              <ComboboxEmpty>{ranking ? "Matching…" : "No category"}</ComboboxEmpty>
              <ComboboxList>
                {(category: CategoryOption) => {
                  const probability = probabilityById.get(category.id)
                  return (
                    <ComboboxItem key={category.id} value={category}>
                      <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{category.name}</span>
                          {category.group ? (
                            <span className="type-caption block truncate text-muted-foreground">{category.group}</span>
                          ) : null}
                        </span>
                        {probability != null && probability >= 0.01 ? (
                          <span className="type-caption shrink-0 text-muted-foreground tabular-nums">
                            {Math.round(probability * 100)}%
                          </span>
                        ) : null}
                      </span>
                    </ComboboxItem>
                  )
                }}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        {item.event ? (
          <div className="space-y-1 px-3 py-2">
            <p>Part of an internal movement.</p>
            <p className="text-muted-foreground">Role: {item.event.role}</p>
            <p className="text-muted-foreground">Treatment is controlled by the reconciled event.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 px-3 py-2">
              <span className="text-muted-foreground">Transfer</span>
              <ToggleGroup
                disabled={savingTreatment || pending}
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
                disabled={savingTreatment || pending}
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
          </>
        )}
      </div>
      <p className="type-caption text-muted-foreground">{item.reviewState === "confirmed" ? "Reviewed" : "Not reviewed"} · Changes are saved when you select Save.</p>
      <div className="flex items-center justify-end gap-2">
        {categoryError && categoryError !== treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {categoryError}
          </p>
        ) : null}
        {undo ? (
          <Button disabled={pending || savingTreatment} onClick={onUndo} size="sm" variant="ghost">
            Undo
          </Button>
        ) : null}
        {treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {treatmentError}
          </p>
        ) : treatmentSaved ? (
          <p className="type-caption" role="status">
            Saved
          </p>
        ) : null}
        <Button
            disabled={pending || savingTreatment || !description.trim()}
            onClick={() => void saveTreatment()}
            size="sm"
          >
            {savingTreatment ? "Saving…" : item.reviewState === "confirmed" || !selectedCategory ? "Save changes" : "Save & mark reviewed"}
          </Button>
      </div>
      {budget}
    </div>
  )
}

function categoryLabel(category: CategoryOption): string {
  return category.group ? `${category.name} · ${category.group}` : category.name
}

function categoryValue(categories: CategoryOption[], item: TransactionFeedItem): CategoryOption | null {
  if (!item.category.id || !item.category.name) return null
  return (
    categories.find((entry) => entry.id === item.category.id) ?? {
      group: null,
      id: item.category.id,
      lifecycleStatus: "active",
      name: item.category.name,
      slug: item.category.id,
    }
  )
}

function provenanceLines(
  item: TransactionFeedItem,
  inspection: TransactionInspection | null,
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = []
  if (item.source.categoryName) lines.push({ label: "FinWise", value: item.source.categoryName })
  const jev = inspection?.classifications.find(
    (entry) => entry.decisionSource === "jev" || entry.decisionSource === "agent",
  )
  if (jev) {
    const confidence = jev.confidence ?? item.classifier.confidence
    lines.push({
      label: "JEV",
      value: confidence == null ? jev.categoryName : `${jev.categoryName} · ${Math.round(confidence * 100)}%`,
    })
  } else if (item.category.provenance === "jev" && item.category.name) {
    const confidence = item.category.confidence ?? item.classifier.confidence
    lines.push({
      label: "JEV",
      value: confidence == null ? item.category.name : `${item.category.name} · ${Math.round(confidence * 100)}%`,
    })
  }
  const yours = inspection?.classifications.find(
    (entry) => entry.decisionSource === "user" && entry.status === "confirmed",
  )
  if (yours) lines.push({ label: "You", value: yours.categoryName })
  else if (item.category.provenance === "user" && item.category.name) {
    lines.push({ label: "You", value: item.category.name })
  }
  return lines
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
