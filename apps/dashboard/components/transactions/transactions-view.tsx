"use client"

import { Check, Search } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useHousehold } from "@/components/app/household-context"
import { DateField } from "@/components/app/date-field"
import { PageHeader } from "@/components/app/page-header"
import { CategoryField } from "@/components/transactions/category-field"
import { Inspection } from "@/components/transactions/inspection"
import {
  accountLine,
  ADVANCED_REVIEWS,
  applyCategory,
  decisionNote,
  focusCategory,
  formatDay,
  formatWhen,
  gutterParts,
  readRecent,
  rememberCategory,
  subject,
  type ReviewFilter,
  type RowOverlay,
  type UndoOffer,
} from "@/components/transactions/model"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatAmount } from "@/lib/format"
import { cn } from "@/lib/utils"
import {
  getTransaction,
  getTransactionActivity,
  getTransactionFilters,
  listTransactions,
  setTransactionCategory,
  SignInRequiredError,
  undoTransactionCategory,
  type AccountOption,
  type CategoryOption,
  type LedgerActivity,
  type TransactionDetail,
  type TransactionFeedItem,
  type TransactionFilters,
} from "@/lib/transactions"

const ALL = "all"

export function TransactionsView() {
  const { signIn } = useHousehold()
  const searchId = useId()
  const [items, setItems] = useState<TransactionFeedItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [feedState, setFeedState] = useState<"loading" | "ready" | "error">("loading")
  const [feedError, setFeedError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [activity, setActivity] = useState<LedgerActivity | null>(null)
  const [review, setReview] = useState<ReviewFilter>("all")
  const [accountId, setAccountId] = useState("")
  const [categoryId, setCategoryId] = useState("")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showMore, setShowMore] = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [direction, setDirection] = useState<"" | "debit" | "credit">("")
  const [transfer, setTransfer] = useState<"" | "yes" | "no" | "unknown">("")
  const [spend, setSpend] = useState<"" | "included" | "excluded" | "unknown">("")
  const [archived, setArchived] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TransactionDetail>>({})
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [overlays, setOverlays] = useState<Record<string, RowOverlay>>({})
  const [signInHint, setSignInHint] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [recentIds, setRecentIds] = useState<string[]>([])
  const [wide, setWide] = useState(false)
  const requestRef = useRef(0)

  useEffect(() => {
    setRecentIds(readRecent())
  }, [])

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)")
    const update = () => setWide(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const filters = useMemo<TransactionFilters>(() => {
    const next: TransactionFilters = {}
    if (review !== "all") next.reviewState = review
    if (accountId) next.accountId = accountId
    if (categoryId) next.categoryId = categoryId
    if (debouncedSearch) next.search = debouncedSearch
    if (fromDate) next.fromDate = fromDate
    if (toDate) next.toDate = toDate
    if (direction) next.direction = direction
    if (transfer) next.transfer = transfer
    if (spend) next.spend = spend
    if (archived) next.archived = true
    return next
  }, [
    accountId,
    archived,
    categoryId,
    debouncedSearch,
    direction,
    fromDate,
    review,
    spend,
    toDate,
    transfer,
  ])

  useEffect(() => {
    let cancelled = false
    void getTransactionFilters()
      .then((catalogue) => {
        if (cancelled) return
        setAccounts(catalogue.accounts)
        setCategories(catalogue.categories)
      })
      .catch(() => {
        if (!cancelled) setAccounts([])
      })
    void getTransactionActivity()
      .then((next) => {
        if (!cancelled) setActivity(next)
      })
      .catch(() => {
        if (!cancelled) setActivity(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const requestId = requestRef.current + 1
    requestRef.current = requestId
    setFeedState("loading")
    setFeedError(null)
    void listTransactions({ filters, limit: 50 })
      .then((page) => {
        if (requestRef.current !== requestId) return
        setItems(page.items)
        setNextCursor(page.nextCursor)
        setFeedState("ready")
      })
      .catch((error: unknown) => {
        if (requestRef.current !== requestId) return
        setFeedState("error")
        setFeedError(
          error instanceof Error ? error.message : "The ledger could not be read.",
        )
      })
  }, [filters, reloadKey])

  useEffect(() => {
    if (!selectedId || details[selectedId]) return
    let cancelled = false
    setDetailLoading(true)
    setDetailError(null)
    void getTransaction(selectedId)
      .then((detail) => {
        if (cancelled) return
        setDetails((current) => ({ ...current, [selectedId]: detail }))
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDetailError(
          error instanceof Error ? error.message : "The inspection could not be read.",
        )
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [details, selectedId])

  const visibleItems = items.map((item) => overlays[item.id]?.item ?? item)
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null
  const selectedDetail = selectedId ? details[selectedId] : undefined
  const activeCategories = categories.filter((category) => category.lifecycleStatus === "active")
  const orderedCategories = useMemo(() => {
    const recent = recentIds
      .map((id) => activeCategories.find((category) => category.id === id))
      .filter((category): category is CategoryOption => Boolean(category))
    const rest = activeCategories.filter(
      (category) => !recent.some((entry) => entry.id === category.id),
    )
    return [...recent, ...rest]
  }, [activeCategories, recentIds])

  function followingId(id: string): string | null {
    const index = visibleItems.findIndex((entry) => entry.id === id)
    return visibleItems[index + 1]?.id ?? null
  }

  function closePlate(id: string) {
    setSelectedId(null)
    window.setTimeout(() => {
      document.querySelector<HTMLButtonElement>(`[data-open-for="${CSS.escape(id)}"]`)?.focus()
    }, 0)
  }

  function toggleRow(id: string) {
    setSelectedId((current) => (current === id ? null : id))
  }

  async function loadOlder() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listTransactions({ cursor: nextCursor, filters, limit: 50 })
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (error) {
      setFeedError(
        error instanceof Error ? error.message : "Older movements could not be read.",
      )
    } finally {
      setLoadingMore(false)
    }
  }

  async function classify(item: TransactionFeedItem, category: CategoryOption) {
    const priorCategoryId = item.category.id
    const command = crypto.randomUUID()
    const following = followingId(item.id)
    rememberCategory(category.id)
    setRecentIds(readRecent())
    setSignInHint(false)
    setOverlays((current) => ({
      ...current,
      [item.id]: {
        error: null,
        item: applyCategory(item, category),
        pending: true,
        undo: null,
      },
    }))
    if (following) focusCategory(following)
    try {
      const result = await setTransactionCategory({
        categoryId: category.id,
        expectedConfirmedClassificationId: item.revision.confirmedClassificationId,
        expectedProposedClassificationId: item.revision.proposedClassificationId,
        reviewCommandId: command,
        transactionId: item.id,
      })
      const undo =
        priorCategoryId !== category.id
          ? {
              categoryId: priorCategoryId,
              expectedConfirmedClassificationId:
                result.item.revision.confirmedClassificationId,
            }
          : null
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict
            ? "This movement changed. Showing the current decision."
            : null,
          item: result.item,
          pending: false,
          undo,
        },
      }))
      setDetails((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
      if (result.conflict) focusCategory(item.id)
    } catch (error) {
      if (error instanceof SignInRequiredError) setSignInHint(true)
      focusCategory(item.id)
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: error instanceof Error ? error.message : "The decision could not be saved.",
          item,
          pending: false,
          undo: null,
        },
      }))
    }
  }

  async function undo(item: TransactionFeedItem, offer: UndoOffer) {
    const command = crypto.randomUUID()
    setOverlays((current) => ({
      ...current,
      [item.id]: { ...current[item.id], error: null, pending: true, undo: null },
    }))
    try {
      const result = await undoTransactionCategory({
        categoryId: offer.categoryId,
        expectedConfirmedClassificationId: offer.expectedConfirmedClassificationId,
        reviewCommandId: command,
        transactionId: item.id,
      })
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict
            ? "This movement changed. Showing the current decision."
            : null,
          item: result.item,
          pending: false,
          undo: null,
        },
      }))
      setDetails((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
    } catch (error) {
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: error instanceof Error ? error.message : "Undo could not be saved.",
          item,
          pending: false,
          undo: offer,
        },
      }))
    }
  }

  function clearFilters() {
    setReview("all")
    setAccountId("")
    setCategoryId("")
    setSearch("")
    setFromDate("")
    setToDate("")
    setDirection("")
    setTransfer("")
    setSpend("")
    setArchived(false)
  }

  function onLogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && selectedId) {
      event.preventDefault()
      closePlate(selectedId)
      return
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    if (target.closest("input, select, textarea")) return
    const current = target.closest<HTMLButtonElement>("[data-category-for]")
    if (!current) return
    const buttons = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-category-for]"),
    ]
    const next = buttons[buttons.indexOf(current) + (event.key === "ArrowDown" ? 1 : -1)]
    if (!next) return
    event.preventDefault()
    next.focus()
  }

  const inspection = selected ? (
    <Inspection
      activity={activity}
      detail={selectedDetail}
      detailError={detailError}
      detailLoading={detailLoading && !selectedDetail}
      item={selected}
      onRetryDetail={() => {
        if (!selectedId) return
        setDetails((current) => {
          const next = { ...current }
          delete next[selectedId]
          return next
        })
      }}
      onTreatmentSaved={(next) => {
        setOverlays((current) => ({
          ...current,
          [next.id]: {
            error: null,
            item: next,
            pending: false,
            undo: current[next.id]?.undo ?? null,
          },
        }))
        setDetails((current) => {
          const copy = { ...current }
          delete copy[next.id]
          return copy
        })
      }}
    />
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader
        description="Review and classify household transactions."
        title="Transactions"
      />
      <div className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor={searchId}>Search</Label>
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                id={searchId}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Merchant or description"
                type="search"
                value={search}
              />
            </InputGroup>
          </div>
          <FilterSelect
            label="Account"
            onChange={setAccountId}
            options={accounts.map((account) => ({ label: account.name, value: account.id }))}
            placeholder="All accounts"
            value={accountId}
          />
          <FilterSelect
            label="Category"
            onChange={setCategoryId}
            options={activeCategories.map((category) => ({
              label: category.name,
              value: category.id,
            }))}
            placeholder="All categories"
            value={categoryId}
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <ToggleGroup
            aria-label="Review"
            onValueChange={(value) => {
              if (value === "all" || value === "needs_review") setReview(value)
            }}
            size="sm"
            spacing={0}
            type="single"
            value={review === "all" || review === "needs_review" ? review : ""}
            variant="outline"
          >
            <ToggleGroupItem value="all">All</ToggleGroupItem>
            <ToggleGroupItem value="needs_review">Review</ToggleGroupItem>
          </ToggleGroup>
          <DateField id="from-date" label="From" onChange={setFromDate} value={fromDate} />
          <DateField id="to-date" label="To" onChange={setToDate} value={toDate} />
          <Collapsible onOpenChange={setShowMore} open={showMore}>
            <CollapsibleTrigger asChild>
              <Button aria-expanded={showMore} size="sm" variant="ghost">
                {showMore ? "Fewer filters" : "More filters"}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </div>
        <Collapsible onOpenChange={setShowMore} open={showMore}>
          <CollapsibleContent className="grid gap-3 border-t pt-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
              <Label>Review state</Label>
              <ToggleGroup
                aria-label="Review state"
                className="flex-wrap"
                onValueChange={(value) => {
                  const match = ADVANCED_REVIEWS.find((entry) => entry.value === value)
                  if (match) setReview(match.value)
                }}
                size="sm"
                spacing={1}
                type="single"
                value={ADVANCED_REVIEWS.some((entry) => entry.value === review) ? review : ""}
                variant="outline"
              >
                {ADVANCED_REVIEWS.map((filter) => (
                  <ToggleGroupItem key={filter.value} value={filter.value}>
                    {filter.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
            <FilterSelect
              label="Direction"
              onChange={(value) => setDirection(value as "" | "debit" | "credit")}
              options={[
                { label: "Money out", value: "debit" },
                { label: "Money in", value: "credit" },
              ]}
              placeholder="Either"
              value={direction}
            />
            <FilterSelect
              label="Transfer"
              onChange={(value) => setTransfer(value as "" | "yes" | "no" | "unknown")}
              options={[
                { label: "Transfer", value: "yes" },
                { label: "Not a transfer", value: "no" },
                { label: "Unknown", value: "unknown" },
              ]}
              placeholder="Any"
              value={transfer}
            />
            <FilterSelect
              label="Spend"
              onChange={(value) =>
                setSpend(value as "" | "included" | "excluded" | "unknown")
              }
              options={[
                { label: "Included", value: "included" },
                { label: "Excluded", value: "excluded" },
                { label: "Unknown", value: "unknown" },
              ]}
              placeholder="Any"
              value={spend}
            />
            <div className="flex items-center gap-2 self-end pb-2">
              <Checkbox
                checked={archived}
                id="archived-only"
                onCheckedChange={(checked) => setArchived(checked === true)}
              />
              <Label htmlFor="archived-only">Archived only</Label>
            </div>
            <p className="type-caption md:col-span-2 xl:col-span-4">
              {activity?.lastFinwiseSyncAt
                ? `FinWise ${formatWhen(activity.lastFinwiseSyncAt)}`
                : "FinWise sync not recorded"}
              {activity?.classifierVersion ? ` · JEV ${activity.classifierVersion}` : ""}
            </p>
          </CollapsibleContent>
        </Collapsible>
        {signInHint ? (
          <Alert>
            <AlertTitle>Sign in to keep a decision.</AlertTitle>
            <AlertDescription>
              <Button onClick={signIn} size="sm" variant="outline">
                Sign in with Google
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      <div className="grid min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ScrollArea className="max-h-[calc(100svh-12rem)]">
          <div aria-busy={feedState === "loading"} aria-label="Transactions" onKeyDown={onLogKeyDown}>
            {feedState === "loading" ? <LedgerSkeleton /> : null}
            {feedState === "error" ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>The ledger could not be read</EmptyTitle>
                  <EmptyDescription>{feedError}</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={() => setReloadKey((key) => key + 1)} size="sm">
                    Retry
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}
            {feedState === "ready" && visibleItems.length === 0 ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>Nothing matches</EmptyTitle>
                  <EmptyDescription>No transactions match these filters.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button onClick={clearFilters} size="sm" variant="outline">
                    Clear filters
                  </Button>
                </EmptyContent>
              </Empty>
            ) : null}
            {feedState === "ready"
              ? visibleItems.map((item, index) => {
                  const overlay = overlays[item.id]
                  const note = decisionNote(item)
                  const showDate =
                    index === 0 || visibleItems[index - 1]?.occurredOn !== item.occurredOn
                  const gutter = gutterParts(item.occurredOn)
                  const categoryName = item.category.name ?? "Uncategorised"
                  const amount = Number(item.amount)
                  return (
                    <article
                      aria-busy={overlay?.pending || undefined}
                      className={cn(
                        "grid min-h-12 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 gap-y-1 border-b px-2 py-2 sm:grid-cols-[3.25rem_minmax(0,1fr)_auto]",
                        selectedId === item.id && "bg-accent",
                      )}
                      key={item.id}
                    >
                      <div className="pt-1 text-center">
                        {showDate ? (
                          <time className="block" dateTime={item.occurredOn}>
                            <span className="type-numeric block text-sm font-medium">
                              {gutter.day}
                            </span>
                            <span className="type-caption">{gutter.month}</span>
                          </time>
                        ) : null}
                      </div>
                      <div className="min-w-0 space-y-1">
                        <button
                          aria-expanded={selectedId === item.id}
                          className="flex w-full items-baseline justify-between gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          data-open-for={item.id}
                          onClick={() => toggleRow(item.id)}
                          type="button"
                        >
                          <span className="truncate font-medium">{subject(item)}</span>
                          <span className="type-numeric shrink-0 text-sm">
                            <span className="sr-only">
                              {amount < 0 ? "Money out" : "Money in"}
                            </span>
                            {formatAmount(item.amount, item.currencyCode)}
                          </span>
                        </button>
                        <p className="type-caption">{accountLine(item)}</p>
                        {overlay?.error ? (
                          <p className="type-caption text-destructive" role="status">
                            {overlay.error}
                          </p>
                        ) : null}
                      </div>
                      <div className="col-start-2 flex flex-wrap items-center gap-1 sm:col-start-3 sm:justify-end">
                        {overlay?.pending ? <Spinner /> : null}
                        <CategoryField
                          categories={orderedCategories}
                          name={categoryName}
                          note={note}
                          onSelect={(category) => void classify(item, category)}
                          transactionId={item.id}
                        />
                        {note.accept ? (
                          <Button
                            aria-label={`Accept ${categoryName}`}
                            onClick={() => {
                              const category = categories.find(
                                (entry) => entry.id === item.category.id,
                              )
                              if (category) void classify(item, category)
                            }}
                            size="icon-sm"
                            type="button"
                            variant="outline"
                          >
                            <Check />
                          </Button>
                        ) : null}
                        {overlay?.undo ? (
                          <Button
                            onClick={() => void undo(item, overlay.undo as UndoOffer)}
                            size="sm"
                            type="button"
                            variant="ghost"
                          >
                            Undo
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              : null}
            {feedState === "ready" && nextCursor ? (
              <div className="p-3">
                <Button
                  disabled={loadingMore}
                  onClick={() => void loadOlder()}
                  size="sm"
                  variant="outline"
                >
                  {loadingMore ? "Reading older movements…" : "Older movements"}
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
        {wide ? (
          <aside aria-label="Inspection" className="border-l px-4 py-2">
            {selected ? (
              inspection
            ) : (
              <p className="type-caption pt-2">Select a transaction to inspect it.</p>
            )}
            {selected ? (
              <Button
                className="mt-4"
                onClick={() => closePlate(selected.id)}
                size="sm"
                variant="ghost"
              >
                Close
              </Button>
            ) : null}
          </aside>
        ) : null}
      </div>
      {wide ? null : (
        <Sheet
          onOpenChange={(open) => {
            if (!open && selectedId) closePlate(selectedId)
          }}
          open={Boolean(selected)}
        >
          <SheetContent className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{selected ? subject(selected) : "Transaction"}</SheetTitle>
              <SheetDescription>
                {selected ? formatDay(selected.occurredOn) : "Inspection"}
              </SheetDescription>
            </SheetHeader>
            <div className="overflow-y-auto px-4 pb-6">{inspection}</div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

function FilterSelect({
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  label: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  placeholder: string
  value: string
}) {
  const id = useId()
  return (
    <div className="grid min-w-40 gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        onValueChange={(next) => onChange(next === ALL ? "" : next)}
        value={value || ALL}
      >
        <SelectTrigger id={id} size="sm">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function LedgerSkeleton() {
  return (
    <div className="space-y-2 p-2" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton className="h-12 w-full" key={index} />
      ))}
    </div>
  )
}
