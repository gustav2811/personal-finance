"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { PageHeader } from "@/components/patterns/page-header"
import { DateField } from "@/components/patterns/date-field"
import { useHousehold } from "@/components/shell/household-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { shortDate } from "@/lib/format/date"
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
  type ReviewState,
  type TransactionDetail,
  type TransactionFeedItem,
  type TransactionFilters,
} from "@/lib/transactions"
import { Inspector } from "./inspector"
import {
  accountLine,
  commandId,
  decisionNote,
  formatAmount,
  moneyDirection,
  noteClass,
  subject,
  type DecisionNote,
} from "./copy"

type ReviewFilter = "all" | "needs_review" | ReviewState

type UndoOffer = {
  categoryId: string | null
  expectedConfirmedClassificationId: string | null
}

type RowOverlay = {
  error: string | null
  item: TransactionFeedItem
  pending: boolean
  undo: UndoOffer | null
}

const NARROW_QUERY = "(max-width: 1023px)"

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(NARROW_QUERY)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return narrow
}

function applyCategory(
  item: TransactionFeedItem,
  category: CategoryOption,
): TransactionFeedItem {
  return {
    ...item,
    category: {
      confidence: null,
      id: category.id,
      name: category.name,
      proposalDiffersFromSource: false,
      provenance: "user",
      state: "confirmed",
    },
    reviewState: "confirmed",
  }
}

export function TransactionsView() {
  const { signIn } = useHousehold()
  const narrow = useNarrow()
  const requestRef = useRef(0)
  const [items, setItems] = useState<TransactionFeedItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [feedState, setFeedState] = useState<"loading" | "ready" | "error">("loading")
  const [feedError, setFeedError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [activity, setActivity] = useState<LedgerActivity | null>(null)
  const [review, setReview] = useState<ReviewFilter>("all")
  const [accountId, setAccountId] = useState("all")
  const [categoryId, setCategoryId] = useState("all")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showMore, setShowMore] = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [direction, setDirection] = useState<"all" | "debit" | "credit">("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, TransactionDetail>>({})
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [overlays, setOverlays] = useState<Record<string, RowOverlay>>({})
  const [signInHint, setSignInHint] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [search])

  const filters = useMemo<TransactionFilters>(() => {
    const next: TransactionFilters = {}
    if (review !== "all") next.reviewState = review
    if (accountId !== "all") next.accountId = accountId
    if (categoryId !== "all") next.categoryId = categoryId
    if (debouncedSearch) next.search = debouncedSearch
    if (fromDate) next.fromDate = fromDate
    if (toDate) next.toDate = toDate
    if (direction !== "all") next.direction = direction
    return next
  }, [accountId, categoryId, debouncedSearch, direction, fromDate, review, toDate])

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
        setFeedError(error instanceof Error ? error.message : "The ledger could not be read.")
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
        setDetailError(error instanceof Error ? error.message : "The inspection could not be read.")
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

  function followingId(id: string): string | null {
    const index = visibleItems.findIndex((entry) => entry.id === id)
    return visibleItems[index + 1]?.id ?? null
  }

  function focusCategory(id: string) {
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>(`[data-category-for="${CSS.escape(id)}"] input`)?.focus()
    }, 0)
  }

  async function loadOlder() {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const page = await listTransactions({ cursor: nextCursor, filters, limit: 50 })
      setItems((current) => [...current, ...page.items])
      setNextCursor(page.nextCursor)
    } catch (error) {
      setFeedError(error instanceof Error ? error.message : "Older movements could not be read.")
    } finally {
      setLoadingMore(false)
    }
  }

  async function classify(item: TransactionFeedItem, category: CategoryOption) {
    const priorCategoryId = item.category.id
    const following = followingId(item.id)
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
        reviewCommandId: commandId(),
        transactionId: item.id,
      })
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict ? "This movement changed. Showing the current decision." : null,
          item: result.item,
          pending: false,
          undo:
            priorCategoryId !== category.id
              ? {
                  categoryId: priorCategoryId,
                  expectedConfirmedClassificationId: result.item.revision.confirmedClassificationId,
                }
              : null,
        },
      }))
      setDetails((current) => {
        const next = { ...current }
        delete next[item.id]
        return next
      })
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
    setOverlays((current) => ({
      ...current,
      [item.id]: { ...current[item.id], error: null, pending: true, undo: null },
    }))
    try {
      const result = await undoTransactionCategory({
        categoryId: offer.categoryId,
        expectedConfirmedClassificationId: offer.expectedConfirmedClassificationId,
        reviewCommandId: commandId(),
        transactionId: item.id,
      })
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict ? "This movement changed. Showing the current decision." : null,
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
          undo: null,
        },
      }))
    }
  }

  function clearFilters() {
    setReview("all")
    setAccountId("all")
    setCategoryId("all")
    setSearch("")
    setFromDate("")
    setToDate("")
    setDirection("all")
  }

  const inspector = selected ? (
    <Inspector
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
        description="Newest movements first. Change a category in place. Open a row only when the source needs checking."
        title="Transactions"
      />
      {activity?.lastFinwiseSyncAt ? (
        <p className="type-caption -mt-4">FinWise synced {shortDate(activity.lastFinwiseSyncAt)}</p>
      ) : null}
      {signInHint ? (
        <Alert>
          <AlertTitle>Sign in to keep this decision</AlertTitle>
          <AlertDescription>
            <Button onClick={signIn} size="sm" variant="outline">
              Sign in with Google
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="ledger-search">Search</Label>
          <Input
            id="ledger-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Merchant or description"
            value={search}
          />
        </div>
        <div className="grid gap-1.5">
          <Label>Account</Label>
          <Select onValueChange={setAccountId} value={accountId}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {accounts.map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <ToggleGroup
          onValueChange={(value) => {
            if (value === "all" || value === "needs_review") setReview(value)
          }}
          size="sm"
          spacing={0}
          type="single"
          value={review === "needs_review" ? "needs_review" : "all"}
          variant="outline"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="needs_review">Review</ToggleGroupItem>
        </ToggleGroup>
        <Button onClick={() => setShowMore((current) => !current)} size="sm" variant="ghost">
          {showMore ? "Fewer filters" : "More filters"}
        </Button>
      </div>
      {showMore ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select onValueChange={setCategoryId} value={categoryId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any category</SelectItem>
                {activeCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DateField id="from-date" label="From" onChange={setFromDate} value={fromDate} />
          <DateField id="to-date" label="To" onChange={setToDate} value={toDate} />
          <div className="grid gap-1.5">
            <Label>Direction</Label>
            <Select
              onValueChange={(value) => {
                if (value === "all" || value === "debit" || value === "credit") setDirection(value)
              }}
              value={direction}
            >
              <SelectTrigger className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Either</SelectItem>
                <SelectItem value="debit">Money out</SelectItem>
                <SelectItem value="credit">Money in</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      <div className={selected && !narrow ? "grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}>
        <div aria-busy={feedState === "loading"} className="min-w-0">
          {feedState === "loading" ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : null}
          {feedState === "error" ? (
            <Alert variant="destructive">
              <AlertTitle>The ledger could not be read</AlertTitle>
              <AlertDescription>
                {feedError}
                <Button className="mt-2" onClick={() => setReloadKey((key) => key + 1)} size="sm" variant="outline">
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {feedState === "ready" && visibleItems.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Nothing matches</EmptyTitle>
                <EmptyDescription>Clear the filters to see the newest movements.</EmptyDescription>
              </EmptyHeader>
              <Button onClick={clearFilters} size="sm" variant="outline">
                Clear filters
              </Button>
            </Empty>
          ) : null}
          {feedState === "ready" ? (
            <ul className="divide-y border-y">
              {visibleItems.map((item) => (
                <MovementRow
                  categories={activeCategories}
                  item={item}
                  key={item.id}
                  note={decisionNote(item)}
                  onAccept={() => {
                    const category = categories.find((entry) => entry.id === item.category.id)
                    if (category) void classify(item, category)
                  }}
                  onClassify={(category) => void classify(item, category)}
                  onOpen={() => setSelectedId((current) => (current === item.id ? null : item.id))}
                  onUndo={(offer) => void undo(item, offer)}
                  open={selectedId === item.id}
                  overlay={overlays[item.id]}
                />
              ))}
            </ul>
          ) : null}
          {feedState === "ready" && nextCursor ? (
            <Button
              className="mt-4"
              disabled={loadingMore}
              onClick={() => void loadOlder()}
              size="sm"
              variant="ghost"
            >
              {loadingMore ? "Reading older movements…" : "Older movements"}
            </Button>
          ) : null}
        </div>
        {selected && !narrow ? (
          <aside aria-label="Inspection" className="border-l pl-6">
            {inspector}
            <Button className="mt-4" onClick={() => setSelectedId(null)} size="sm" variant="ghost">
              Close
            </Button>
          </aside>
        ) : null}
      </div>
      <Sheet onOpenChange={(open) => { if (!open) setSelectedId(null) }} open={Boolean(selected && narrow)}>
        <SheetContent className="overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Inspection</SheetTitle>
            <SheetDescription>Source, treatment, and classifier. Category stays on the row.</SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">{inspector}</div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function MovementRow({
  categories,
  item,
  note,
  onAccept,
  onClassify,
  onOpen,
  onUndo,
  open,
  overlay,
}: {
  categories: CategoryOption[]
  item: TransactionFeedItem
  note: DecisionNote
  onAccept: () => void
  onClassify: (category: CategoryOption) => void
  onOpen: () => void
  onUndo: (offer: UndoOffer) => void
  open: boolean
  overlay: RowOverlay | undefined
}) {
  const direction = moneyDirection(item.amount)
  const categoryName = item.category.name ?? "Uncategorised"

  return (
    <li
      aria-busy={overlay?.pending || undefined}
      className="grid min-h-14 gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"
    >
      <button
        aria-expanded={open}
        className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-baseline gap-3 text-left"
        onClick={onOpen}
        type="button"
      >
        <time className="type-numeric type-caption" dateTime={item.occurredOn}>
          {shortDate(item.occurredOn)}
        </time>
        <span className="min-w-0">
          <span className="block truncate font-medium">{subject(item)}</span>
          <span className="type-caption block truncate">{accountLine(item)}</span>
        </span>
        <span className="type-numeric">
          <span className="sr-only">{direction === "out" ? "Money out" : "Money in"}</span>
          {formatAmount(item.amount, item.currencyCode)}
        </span>
      </button>
      <div className="grid gap-1" data-category-for={item.id}>
        <Combobox
          items={categories.map((category) => category.name)}
          onValueChange={(value) => {
            const category = categories.find((entry) => entry.name === value)
            if (category) onClassify(category)
          }}
          value={item.category.name}
        >
          <ComboboxInput
            aria-label={
              note.text ? `${categoryName}, ${note.text}. Change category` : `${categoryName}. Change category`
            }
            disabled={overlay?.pending}
            placeholder="Uncategorised"
            showClear={false}
          />
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
        <div className="flex min-h-5 items-center gap-2">
          {note.text ? <span className={`type-caption ${noteClass(note.tone)}`}>{note.text}</span> : null}
          {overlay?.pending ? <span className="type-caption">Saving</span> : null}
          {note.accept ? (
            <Button onClick={onAccept} size="sm" variant="ghost">
              Accept
            </Button>
          ) : null}
          {overlay?.undo ? (
            <Button onClick={() => onUndo(overlay.undo as UndoOffer)} size="sm" variant="ghost">
              Undo
            </Button>
          ) : null}
        </div>
        {overlay?.error ? (
          <p className="type-caption text-destructive" role="status">
            {overlay.error}
          </p>
        ) : null}
      </div>
    </li>
  )
}
