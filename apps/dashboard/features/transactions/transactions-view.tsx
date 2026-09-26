"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeftRight,
  Clock,
  CreditCard,
  Landmark,
  Search,
  SlidersHorizontal,
  Wallet,
} from "lucide-react"
import { PageHeader } from "@/components/patterns/page-header"
import { DateField } from "@/components/patterns/date-field"
import { useHousehold } from "@/components/shell/household-context"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
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
  type TransactionFeedItem,
  type TransactionFilters,
} from "@/lib/transactions"
import { Inspector } from "./inspector"
import {
  commandId,
  needsReview,
  formatAmount,
  moneyDirection,
  relativeDay,
  subject,
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
  const [reviewCount, setReviewCount] = useState<string | null>(null)
  const [accountId, setAccountId] = useState("all")
  const [categoryId, setCategoryId] = useState("all")
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [showMore, setShowMore] = useState(false)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [direction, setDirection] = useState<"all" | "debit" | "credit">("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [overlays, setOverlays] = useState<Record<string, RowOverlay>>({})
  const [signInHint, setSignInHint] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    void listTransactions({ filters: { reviewState: "needs_review" }, limit: 100 })
      .then((page) => {
        if (cancelled) return
        setReviewCount(page.nextCursor ? "100+" : String(page.items.length))
      })
      .catch(() => {
        if (!cancelled) setReviewCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

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

  const visibleItems = items.map((item) => overlays[item.id]?.item ?? item)
  const selected = visibleItems.find((item) => item.id === selectedId) ?? null
  const selectedOverlay = selectedId ? overlays[selectedId] : undefined
  const activeCategories = [...categories.filter((category) => category.lifecycleStatus === "active")].sort(
    (first, second) => recentRank(first.id) - recentRank(second.id),
  )

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
    rememberCategory(category.id)
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
      categories={activeCategories}
      categoryError={selectedOverlay?.error ?? null}
      item={selected}
      onClassify={(category) => void classify(selected, category)}
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
      }}
      onUndo={() => {
        if (selectedOverlay?.undo) void undo(selected, selectedOverlay.undo)
      }}
      pending={Boolean(selectedOverlay?.pending)}
      undo={Boolean(selectedOverlay?.undo)}
    />
  ) : null

  return (
    <div className="space-y-6">
      <PageHeader description="Newest first. Open a row to change it." title="Transactions" />
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
          <ToggleGroupItem
            className="data-[state=on]:bg-electric-blue-600 data-[state=on]:text-white"
            value="needs_review"
          >
            Review{reviewCount ? ` ${reviewCount}` : ""}
          </ToggleGroupItem>
        </ToggleGroup>
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
                <EmptyTitle>Nothing matches</EmptyTitle>
                <EmptyDescription>
                  {review === "needs_review"
                    ? "Nothing is waiting."
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
                    onOpen={() => setSelectedId(item.id)}
                    pending={Boolean(overlays[item.id]?.pending)}
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
      <Dialog onOpenChange={(open) => { if (!open) setSelectedId(null) }} open={Boolean(selected)}>
        <DialogContent className="sm:max-w-lg">
          <DialogTitle className="sr-only">{selected ? subject(selected) : "Movement"}</DialogTitle>
          <DialogDescription className="sr-only">Category and treatment for this movement.</DialogDescription>
          {inspector}
        </DialogContent>
      </Dialog>
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
}: {
  item: TransactionFeedItem
  onOpen: () => void
  pending: boolean
}) {
  const direction = moneyDirection(item.amount)
  const merchant = subject(item)
  const detail = item.description !== merchant ? item.description : null
  const waiting = needsReview(item)

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
          <span className="truncate font-medium">{merchant}</span>
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
          {waiting ? <span className="shrink-0 text-electric-blue-700">Review</span> : null}
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
