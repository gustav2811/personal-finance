"use client"

import { demoEnabled } from "@/lib/demo/transactions"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Clock,
  CreditCard,
  Landmark,
  Search,
  SlidersHorizontal,
  X,
  Wallet,
} from "lucide-react"
import { PageHeader } from "@/components/patterns/page-header"
import { DateField } from "@/components/patterns/date-field"
import { useHousehold } from "@/components/shell/household-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
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
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { undoTransactionCategory } from "./mutations"
import { getTransactionFilters, listTransactions } from "./queries"
import { writeTransactionReview } from "./rpc"
import { SignInRequiredError } from "./rpc"
import type {
  AccountOption,
  CategoryOption,
  TransactionFeedItem,
  TransactionFilters,
} from "./model"
import { TransactionBudget } from "@/features/budget/transaction-budget"
import { TransactionReviewFrame } from "./review-dialog"
import { Inspector, type InspectorSave } from "./inspector"
import {
  commandId,
  formatAmount,
  moneyDirection,
  relativeDay,
  subject,
} from "./copy"

type ReviewFilter = "all" | "needs_review"

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

const RECENT_KEY = "ledger-recent-categories"

function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : []
  } catch {
    return []
  }
}

function recentRank(id: string): number {
  const index = readRecent().indexOf(id)
  return index === -1 ? 99 : index
}

function rememberCategory(id: string) {
  try {
    const next = [id, ...readRecent().filter((entry) => entry !== id)].slice(0, 6)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    return
  }
}

export function TransactionsView({ initialTransactionId = null }: { initialTransactionId?: string | null }) {
  const { signIn, email } = useHousehold()
  const seenKey = `ledger-seen:${demoEnabled() ? "demo" : email}`
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set())
  const requestRef = useRef(0)
  const [items, setItems] = useState<TransactionFeedItem[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [feedState, setFeedState] = useState<"loading" | "ready" | "error">("loading")
  const [feedError, setFeedError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [accounts, setAccounts] = useState<AccountOption[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [review, setReview] = useState<ReviewFilter>("all")
  const [accountId, setAccountId] = useState("all")
  const [categoryId, setCategoryId] = useState("all")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showMore, setShowMore] = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [direction, setDirection] = useState<"all" | "debit" | "credit">("all")
  const editorItemRef = useRef<TransactionFeedItem | null>(null)
  const inspectorSave = useRef<InspectorSave>(null)
  const navigating = useRef(false)
  const [editorKey, setEditorKey] = useState(0)
  const [editorDirty, setEditorDirty] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialTransactionId)
  const [overlays, setOverlays] = useState<Record<string, RowOverlay>>({})
  const [signInHint, setSignInHint] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(seenKey) ?? "[]")
      setSeenIds(new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []))
    } catch { setSeenIds(new Set()) }
  }, [seenKey])

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

  const visibleItems = items.map((item) => overlays[item.id]?.item ?? item)
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null
  const selectedOverlay = selectedId ? overlays[selectedId] : undefined
  if (selected && !selectedOverlay?.pending) editorItemRef.current = selected
  const editorItem = selectedOverlay?.pending && editorItemRef.current?.id === selectedId ? editorItemRef.current : selected
  useEffect(() => {
    if (!selected) return
    setSeenIds((current) => {
      if (current.has(selected.id)) return current
      const next = new Set(current).add(selected.id)
      try { localStorage.setItem(seenKey, JSON.stringify([...next].slice(-10000))) } catch { /* Keep the current session usable when storage is unavailable. */ }
      return next
    })
  }, [selected?.id, seenKey])
  const activeCategories = [...categories.filter((category) => category.lifecycleStatus === "active")].sort(
    (first, second) => recentRank(first.id) - recentRank(second.id),
  )

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

  async function confirmTreatment(
    item: TransactionFeedItem,
    input: { isTransfer: boolean | null; excludeFromSpend: boolean | null; nature: string | null; categoryId: string | null; description: string; notes: string | null },
    options?: { advance?: boolean },
  ): Promise<string | null> {
    let currentItem = item
    const priorCategoryId = item.category.id
    const update = (pending: boolean, error: string | null = null) => {
      setOverlays((current) => ({ ...current, [item.id]: { item: pending ? {
        ...currentItem, description: input.description, notes: input.notes,
        treatment: currentItem.event ? currentItem.treatment : { ...currentItem.treatment, isTransfer: input.isTransfer, excludeFromSpend: input.excludeFromSpend, nature: input.nature },
        category: input.categoryId ? { ...currentItem.category, id: input.categoryId, name: categories.find((entry) => entry.id === input.categoryId)?.name ?? currentItem.category.name } : currentItem.category,
      } : currentItem, pending, error, undo: null } }))
    }
    update(true)
    try {
      const result = await writeTransactionReview({
        p_transaction_id: item.id,
        p_category_id: input.categoryId,
        p_description: input.description,
        p_notes: input.notes,
        p_is_transfer: item.event ? null : input.isTransfer,
        p_exclude_from_spend: item.event ? null : input.excludeFromSpend,
        p_nature: input.nature,
        p_expected: { description: item.description, notes: item.notes ?? null, ...item.revision },
        p_review_command_id: commandId(),
      })
      currentItem = result.item
      if (result.conflict) throw new Error("This transaction changed elsewhere. Nothing from this save was applied. Your draft is still here. Check the latest details before retrying.")
      editorItemRef.current = currentItem
      if (input.categoryId) rememberCategory(input.categoryId)
      setOverlays((current) => ({ ...current, [item.id]: {
        item: currentItem, pending: false, error: null,
        undo: priorCategoryId !== currentItem.category.id ? {
          categoryId: priorCategoryId,
          expectedConfirmedClassificationId: currentItem.revision.confirmedClassificationId,
        } : null,
      } }))
      if (options?.advance && review === "needs_review" && currentItem.reviewState === "confirmed") {
        const index = visibleItems.findIndex((entry) => entry.id === item.id)
        setItems((current) => current.filter((entry) => entry.id !== item.id))
        setEditorDirty(false)
        setSelectedId(visibleItems[index + 1]?.id ?? visibleItems[index - 1]?.id ?? null)
      }
      return null
    } catch (error) {
      if (error instanceof SignInRequiredError) setSignInHint(true)
      const message = error instanceof Error ? error.message : "Changes could not be saved. Your draft is still here."
      update(false, message)
      return message
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
      if (!result.conflict) {
        setEditorDirty(false)
        setEditorKey((key) => key + 1)
      }
      setOverlays((current) => ({
        ...current,
        [item.id]: {
          error: result.conflict ? "This movement changed. Showing the current decision." : null,
          item: result.item,
          pending: false,
          undo: null,
        },
      }))
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

  async function selectTransaction(id: string | null) {
    if (navigating.current) return
    navigating.current = true
    try {
      if (inspectorSave.current && !await inspectorSave.current.flush()) return
      if (review === "needs_review" && editorItemRef.current?.reviewState === "confirmed" && id !== editorItemRef.current.id) {
        const reviewedId = editorItemRef.current.id
        setItems((current) => current.filter((entry) => entry.id !== reviewedId))
      }
      setEditorDirty(false)
      setSelectedId(id)
    } finally { navigating.current = false }
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

  const inspector = selected && editorItem ? (
    <Inspector
      key={`${selected.id}:${editorKey}`}
      categories={activeCategories}
      categoryError={selectedOverlay?.error ?? null}
      item={editorItem}
      onConfirm={(input, options) => confirmTreatment(editorItem, input, options)}
      saveRef={inspectorSave}
      onDirtyChange={setEditorDirty}
      onDiscard={() => { setEditorDirty(false); setSelectedId(null) }}
      onUndo={() => {
        if (selectedOverlay?.undo) void undo(selected, selectedOverlay.undo)
      }}
      pending={Boolean(selectedOverlay?.pending)}
      undo={Boolean(selectedOverlay?.undo)}
      budget={demoEnabled() ? undefined : <TransactionBudget transactionId={selected.id} />}
    />
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader description="Newest first. A dot marks transactions you haven’t opened." title="Transactions" />
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
      <div className="flex flex-wrap items-center gap-2">
        {review === "needs_review" ? (
          <Button onClick={() => setReview("all")} size="sm" variant="outline">Needs review · Clear</Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Search"
              className="h-8 w-44 pl-7"
              id="ledger-search"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              value={search}
            />
          </div>
          <Button
            aria-label="Filters"
            aria-pressed={showMore}
            onClick={() => setShowMore((current) => !current)}
            size="icon-sm"
            variant="ghost"
          >
            <SlidersHorizontal />
          </Button>
        </div>
      </div>
      {showMore ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-review">Show</Label>
            <Select value={review} onValueChange={(value) => { if (value === "all" || value === "needs_review") setReview(value) }}>
              <SelectTrigger className="w-44" id="filter-review"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All transactions</SelectItem>
                <SelectItem value="needs_review">Needs review</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-account">Account</Label>
            <Select onValueChange={setAccountId} value={accountId}>
              <SelectTrigger className="w-44" id="filter-account">
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
          <div className="grid gap-1.5">
            <Label htmlFor="filter-category">Category</Label>
            <Select onValueChange={setCategoryId} value={categoryId}>
              <SelectTrigger className="w-44" id="filter-category">
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
            <Label htmlFor="filter-direction">Direction</Label>
            <Select
              onValueChange={(value) => {
                if (value === "all" || value === "debit" || value === "credit") setDirection(value)
              }}
              value={direction}
            >
              <SelectTrigger className="w-36" id="filter-direction">
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

      <div>
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
                <EmptyTitle>{review === "needs_review" ? "All caught up" : "Nothing matches"}</EmptyTitle>
                <EmptyDescription>
                  {review === "needs_review"
                    ? "No transactions are waiting in this view."
                    : "Clear the filters to see the newest movements."}
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={clearFilters} size="sm" variant="outline">
                Clear filters
              </Button>
            </Empty>
          ) : null}
          {feedState === "ready" && visibleItems.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Date</TableHead>
                  <TableHead>Merchant</TableHead>
                  <TableHead className="hidden md:table-cell">Account</TableHead>
                  <TableHead className="hidden sm:table-cell">Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => (
                  <MovementRow
                    item={item}
                    key={item.id}
                    onOpen={() => selectTransaction(item.id)}
                    pending={Boolean(overlays[item.id]?.pending)}
                    unseen={!seenIds.has(item.id) && item.reviewState !== "confirmed"}
                  />
                ))}
              </TableBody>
            </Table>
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
      </div>
      <TransactionReviewFrame open={Boolean(selected)} title={selected ? subject(selected) : "Movement"} onClose={() => void selectTransaction(null)}>
          {selected ? (
            <div className="mb-2 flex shrink-0 items-center justify-end gap-1">
              <Button
                aria-label="Previous movement"
                disabled={!visibleItems.some((entry, index) => entry.id === selected.id && index > 0)}
                onClick={() => {
                  const index = visibleItems.findIndex((entry) => entry.id === selected.id)
                  const previous = visibleItems[index - 1]
                  if (previous) selectTransaction(previous.id)
                }}
                size="icon-sm"
                variant="ghost"
              >
                <ChevronLeft />
              </Button>
              <Button
                aria-label="Next movement"
                disabled={!visibleItems.some((entry, index) => entry.id === selected.id && index < visibleItems.length - 1)}
                onClick={() => {
                  const index = visibleItems.findIndex((entry) => entry.id === selected.id)
                  const following = visibleItems[index + 1]
                  if (following) selectTransaction(following.id)
                }}
                size="icon-sm"
                variant="ghost"
              >
                <ChevronRight />
              </Button>
              <Button aria-label="Close" onClick={() => void selectTransaction(null)} size="icon-sm" variant="ghost"><X /></Button>
            </div>
          ) : null}
          {inspector}
      </TransactionReviewFrame>
    </div>
  )
}

function AccountMark({ type }: { type: string | null }) {
  const credit = (type ?? "").toLowerCase().includes("credit")
  const Icon = credit ? CreditCard : type ? Landmark : Wallet
  return <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
}

function MovementRow({
  item,
  onOpen,
  pending,
  unseen,
}: {
  item: TransactionFeedItem
  onOpen: () => void
  pending: boolean
  unseen: boolean
}) {
  const direction = moneyDirection(item.amount)
  const merchant = subject(item)
  const detail = item.description !== merchant ? item.description : null

  return (
    <TableRow
      aria-busy={pending || undefined}
      aria-haspopup="dialog"
      className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      tabIndex={0}
    >
      <TableCell className="type-caption text-muted-foreground">
        <time dateTime={item.occurredOn}>{relativeDay(item.occurredOn)}</time>
      </TableCell>
      <TableCell className="max-w-56">
        <span className="flex min-w-0 items-center gap-1.5">
          {unseen ? <span className="size-1.5 shrink-0 rounded-full bg-info" role="img" aria-label="Unseen transaction" title="Unseen transaction" /> : null}
          <span className={unseen ? "truncate font-semibold" : "truncate font-medium"}>{merchant}</span>
          {item.source.isPending ? <Clock aria-label="Pending" className="size-3.5 text-muted-foreground" /> : null}
          {item.treatment.isTransfer ? (
            <ArrowLeftRight aria-label="Transfer" className="size-3.5 text-muted-foreground" />
          ) : null}
        </span>
        {detail ? <span className="type-caption block truncate text-muted-foreground">{detail}</span> : null}
      </TableCell>
      <TableCell className="hidden max-w-48 md:table-cell">
        <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <AccountMark type={item.account.type} />
          <span className="truncate">{item.account.name}</span>
        </span>
      </TableCell>
      <TableCell className="hidden max-w-40 text-muted-foreground sm:table-cell">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{item.category.name ?? "Uncategorised"}</span>

        </span>
      </TableCell>
      <TableCell
        className={`type-numeric text-right ${
          direction === "in" ? "text-electric-cyan-700" : "text-shocking-pink-700"
        }`}
      >
        <span className="sr-only">{direction === "out" ? "Money out" : "Money in"}</span>
        {formatAmount(item.amount, item.currencyCode)}
      </TableCell>
    </TableRow>
  )
}
