"use client"

import { useEffect, useState, useRef, useImperativeHandle, type Ref, type ReactNode } from "react"
import { ArrowLeftRight, Copy } from "lucide-react"
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { shortDate } from "@/lib/format/date"
import { rankCategories, useCategoryRanking } from "./category-suggest"
import type { CategoryOption, TransactionFeedItem, TransactionInspection } from "./model"
import { createSaveGate } from "./save-gate"
import { reviewNature } from "./review-nature"
import { getTransaction } from "./queries"
import { formatAmount, moneyDirection, subject } from "./copy"

export type InspectorSave = { flush: () => Promise<boolean> }

export function Inspector({
  categories,
  categoryError,
  item,
  onConfirm,
  onUndo,
  onDiscard,
  onDirtyChange,
  saveRef,
  pending: saving,
  readOnly = false,
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
  }, options?: { advance?: boolean }) => Promise<string | null>
  saveRef: Ref<InspectorSave>
  onDirtyChange: (dirty: boolean) => void
  onUndo: () => void
  onDiscard?: () => void
  pending: boolean
  readOnly?: boolean
  undo: boolean
  budget?: ReactNode
}) {
  const [popupContainer, setPopupContainer] = useState<HTMLDivElement | null>(null)
  const pending = saving || readOnly
  const [isTransfer, setIsTransfer] = useState<boolean | null>(item.treatment.isTransfer)
  const [excludeFromSpend, setExcludeFromSpend] = useState<boolean | null>(
    item.treatment.excludeFromSpend,
  )
  const [treatmentError, setTreatmentError] = useState<string | null>(null)
  const [treatmentSaved, setTreatmentSaved] = useState(false)
  const [savingTreatment, setSavingTreatment] = useState(false)
  const [inspection, setInspection] = useState<TransactionInspection | null>(null)
  const direction = moneyDirection(item.amount)
  const [selectedCategory, setSelectedCategory] = useState(() => categoryValue(categories, item))
  const [description, setDescription] = useState(item.description)
  const [notes, setNotes] = useState(item.notes ?? "")
  const nature = reviewNature(item, { categoryId: selectedCategory?.id ?? null, isTransfer, excludeFromSpend })
  const categoryItems = selectedCategory && !categories.some((entry) => entry.id === selectedCategory.id)
    ? [selectedCategory, ...categories]
    : categories
  const [categoryInput, setCategoryInput] = useState("")
  const categoryQuery = selectedCategory && categoryInput === categoryLabel(selectedCategory) ? "" : categoryInput
  const { loading: ranking, ranking: categoryRanking } = useCategoryRanking(categoryQuery)
  const { items: matchedCategories, probabilityById } = rankCategories(categoryItems, categoryQuery, categoryRanking)
  const dirty = description.trim() !== item.description || (notes.trim() || null) !== (item.notes ?? null)
    || (selectedCategory?.id ?? null) !== item.category.id
    || isTransfer !== item.treatment.isTransfer || excludeFromSpend !== item.treatment.excludeFromSpend
    || nature !== item.treatment.nature
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])

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

  const saveGate = useRef(createSaveGate())
  const draftKey = JSON.stringify([description, notes, selectedCategory?.id, isTransfer, excludeFromSpend, nature])

  function saveTreatment(confirm = false): Promise<boolean> {
    return saveGate.current(async () => {
      if (!dirty && !confirm) return true
      if (!description.trim()) {
        setTreatmentError("Enter a description before leaving this transaction.")
        return false
      }
      setSavingTreatment(true)
      setTreatmentError(null)
      try {
        const error = await onConfirm({
          excludeFromSpend, isTransfer, categoryId: selectedCategory?.id ?? null,
          description: description.trim(), notes: notes.trim() || null, nature,
        }, { advance: confirm })
        setTreatmentError(error)
        setTreatmentSaved(error == null)
        return error == null
      } catch (error) {
        setTreatmentError(error instanceof Error ? error.message : "Changes could not be saved.")
        return false
      } finally {
        setSavingTreatment(false)
      }
    })
  }

  useImperativeHandle(saveRef, () => ({ flush: () => treatmentError ? Promise.resolve(false) : saveTreatment() }))
  useEffect(() => {
    if (!dirty || pending || savingTreatment || treatmentError) return
    const timer = window.setTimeout(() => { void saveTreatment() }, 650)
    return () => window.clearTimeout(timer)
  }, [draftKey, dirty, pending, savingTreatment, treatmentError])

  async function copyDescription() {
    await navigator.clipboard.writeText(item.description)
  }

  const lines = provenanceLines(item, inspection)

  return (
    <div ref={setPopupContainer} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-start gap-2 pb-3">
        <h2 className="min-w-0 flex-1 text-base font-medium text-balance">{subject(item)}</h2>
        <Button aria-label="Copy description" onClick={() => void copyDescription()} size="icon-sm" variant="ghost">
          <Copy />
        </Button>
      </div>

      <div className="mb-3 flex shrink-0 items-baseline justify-between gap-3 type-caption">
        <span className="text-muted-foreground">{shortDate(item.occurredOn)} · {item.account.name}</span>
        <span className="type-numeric">{formatAmount(item.amount, item.currencyCode)}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
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
              if (category) { setSelectedCategory(category); setTreatmentSaved(false); setTreatmentError(null) }
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
            {/* Keep the popup inside the editor so the modal focus trap includes its options. */}
            {popupContainer && (
              <ComboboxPrimitive.Portal container={popupContainer}>
                <ComboboxPrimitive.Positioner sideOffset={6} collisionBoundary={popupContainer} className="z-50">
                  <ComboboxPrimitive.Popup className="max-h-[min(18rem,var(--available-height))] w-[var(--anchor-width)] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
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
                  </ComboboxPrimitive.Popup>
                </ComboboxPrimitive.Positioner>
              </ComboboxPrimitive.Portal>
            )}
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
                  if (value === "yes" || value === "no") { setIsTransfer(value === "yes"); setTreatmentError(null); setTreatmentSaved(false) }
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
                  if (value === "include" || value === "exclude") { setExcludeFromSpend(value === "exclude"); setTreatmentError(null); setTreatmentSaved(false) }
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
          </>
        )}
      </div>
      <div className="divide-y rounded-lg border">
        <div className="space-y-2 px-3 py-2">
          <Label htmlFor="transaction-description">Description</Label>
          <Input id="transaction-description" value={description} onChange={(event) => { setDescription(event.target.value); setTreatmentSaved(false); setTreatmentError(null) }} disabled={pending || savingTreatment} />
        </div>
        <div className="space-y-2 px-3 py-2">
          <Label htmlFor="transaction-notes">Notes</Label>
          <Textarea rows={2} id="transaction-notes" placeholder="Add a note about this transaction" value={notes} onChange={(event) => { setNotes(event.target.value); setTreatmentSaved(false); setTreatmentError(null) }} disabled={pending || savingTreatment} />
        </div>
      </div>
      <details className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer type-caption text-muted-foreground">Transaction details</summary>
        <div className="mt-2 divide-y">
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
          {item.originalDescription ? <Fact label="Original" value={item.originalDescription} /> : null}
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

        </details>
      {budget ? <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer type-caption text-muted-foreground">Budget</summary><div className="mt-2">{budget}</div></details> : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-3 mt-3" aria-live="polite">
        {categoryError && categoryError !== treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {categoryError}
          </p>
        ) : null}
        {undo ? (
          <Button disabled={pending || savingTreatment || dirty} onClick={onUndo} size="sm" variant="ghost">
            Undo
          </Button>
        ) : null}
        {treatmentError ? (
          <p className="type-caption text-destructive" role="status">
            {treatmentError}
          </p>
        ) : null}
        {treatmentError && onDiscard ? <Button disabled={pending || savingTreatment} onClick={onDiscard} size="sm" variant="ghost">Discard changes</Button> : null}
        {readOnly ? (
          <span className="type-caption text-muted-foreground">Local snapshot · read only</span>
        ) : treatmentError ? (
          <Button disabled={pending || savingTreatment} onClick={() => void saveTreatment(true)} size="sm" variant="outline">Retry</Button>
        ) : pending || savingTreatment ? (
          <span className="type-caption text-muted-foreground">Saving…</span>
        ) : dirty ? (
          <Button onClick={() => void saveTreatment(true)} size="sm">Save</Button>
        ) : treatmentSaved ? (
          <span className="type-caption text-muted-foreground">Saved</span>
        ) : item.reviewState !== "confirmed" && selectedCategory ? (
          <Button onClick={() => void saveTreatment(true)} size="sm" variant="outline">Mark reviewed</Button>
        ) : null}
      </div>
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

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-3 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-balance">{value}</span>
    </div>
  )
}
