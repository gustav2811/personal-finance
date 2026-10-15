"use client"

import { useCallback, useMemo, useState } from "react"
import { addMonths, endOfMonth, format, startOfMonth } from "date-fns"
import {
  CalendarDays,
  ChevronDown,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
} from "lucide-react"
import { PageHeader } from "@/components/patterns/page-header"
import { DateField } from "@/components/patterns/date-field"
import { DataGate } from "@/components/patterns/data-gate"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  ANALYSIS_COLORS,
  AnalysisRing,
  AnalysisBars,
  CashFlowChart,
} from "@/domain/analysis/charts"
import { TransactionReviewDialog } from "@/features/transactions/review-dialog"
import type { TransactionFeedItem } from "@/lib/finance/transaction-model"
import { demoEnabled } from "@/lib/demo/transactions"
import {
  aggregateBreakdown,
  aggregateTable,
  aggregateTrend,
  dimensionOf,
  enrichTransactions,
  filterTransactions,
  periodKey,
  summaryOf,
  type AnalysisData,
  type AnalysisDimension,
  type AnalysisFilter,
  type AnalysisGranularity,
  type AnalysisMetric,
  type AnalysisTransaction,
} from "./model"
import { loadAnalysisData } from "./queries"
import { groupContributors } from "./presentation"

type View = "breakdown" | "trends" | "flow" | "table"
const VIEWS: { key: View; label: string }[] = [
  { key: "breakdown", label: "Breakdown" },
  { key: "trends", label: "Trends" },
  { key: "flow", label: "Cash flow" },
  { key: "table", label: "Table" },
]
const iso = (date: Date) => format(date, "yyyy-MM-dd")
function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-auto min-w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([key, text]) => (
          <SelectItem key={key} value={key}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
function MultiFilter({
  label,
  values,
  options,
  onChange,
}: {
  label: string
  values: string[]
  options: [string, string][]
  onChange: (values: string[]) => void
}) {
  const [search, setSearch] = useState("")
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          {values.length
            ? `${values.length} ${label.toLowerCase()}`
            : `All ${label.toLowerCase()}`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 space-y-3">
        <Input
          aria-label={`Search ${label.toLowerCase()}`}
          placeholder={`Search ${label.toLowerCase()}…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex justify-between">
          <span className="type-label">{label}</span>
          <Button variant="ghost" size="sm" onClick={() => onChange([])}>
            Clear
          </Button>
        </div>
        <div className="max-h-64 overflow-auto space-y-1">
          {options
            .filter(([, name]) =>
              name.toLowerCase().includes(search.toLowerCase()),
            )
            .map(([key, name]) => (
              <label
                key={key}
                className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-muted"
              >
                <Checkbox
                  checked={values.includes(key)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...values, key]
                        : values.filter((v) => v !== key),
                    )
                  }
                />
                <span className="type-body-small">{name}</span>
              </label>
            ))}
          {!options.length && (
            <p className="type-caption">
              No {label.toLowerCase()} in this period.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
function csvCell(value: unknown) {
  const text = String(value ?? "")
  // Spreadsheet programs interpret these prefixes as formulas, even inside quotes.
  return `"${(typeof value !== "number" && /^[=+@\-\t\r]/.test(text) ? "'" : "") + text.replaceAll('"', '""')}"`
}
function exportRows(rows: unknown[][], name: string) {
  const blob = new Blob(
    ["\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  )
  const url = URL.createObjectURL(blob),
    link = document.createElement("a")
  link.href = url
  link.download = `${name}.csv`
  link.click()
  URL.revokeObjectURL(url)
}
function useAnalysisSettings() {
  const [view, setView] = useState<View>("breakdown")
  const [dimension, setDimension] = useState<AnalysisDimension>("category")
  const [metric, setMetric] = useState<AnalysisMetric>("expensesNet")
  const [trendPeriod, setTrendPeriod] = useState<AnalysisGranularity>("day")
  const [tablePeriod, setTablePeriod] = useState<AnalysisGranularity>("month")
  const granularity = view === "table" ? tablePeriod : trendPeriod
  const setGranularity = view === "table" ? setTablePeriod : setTrendPeriod
  const [filters, setFilters] = useState<AnalysisFilter>({})
  const [currency, setCurrency] = useState("")
  return {
    view,
    setView,
    dimension,
    setDimension,
    metric,
    setMetric,
    granularity,
    setGranularity,
    filters,
    setFilters,
    currency,
    setCurrency,
  }
}

export function AnalysisView() {
  const settings = useAnalysisSettings()
  const today = new Date(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Johannesburg",
    }).format(new Date()) + "T12:00:00",
  )
  const [from, setFrom] = useState(() => iso(startOfMonth(today)))
  const [to, setTo] = useState(() => iso(endOfMonth(today)))
  const load = useCallback(() => loadAnalysisData(from, to), [from, to])
  const rangeStart = new Date(`${from}T12:00:00`)
  const wholeMonth =
    from === iso(startOfMonth(rangeStart)) && to === iso(endOfMonth(rangeStart))
  const rangeLabel = wholeMonth
    ? format(rangeStart, "MMMM yyyy")
    : `${format(rangeStart, "d MMM")} – ${format(new Date(`${to}T12:00:00`), "d MMM yyyy")}`
  function shift(delta: number) {
    const base = addMonths(new Date(`${from}T12:00:00`), delta)
    setFrom(iso(startOfMonth(base)))
    setTo(iso(endOfMonth(base)))
  }
  return (
    <div className="space-y-6 min-w-0">
      <PageHeader
        title="Analysis"
        actions={
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                aria-label="Choose analysis dates"
                aria-describedby="analysis-current-dates"
              >
                <CalendarDays />
                <span id="analysis-current-dates">{rangeLabel}</span>
                <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-[min(24rem,calc(100vw-2rem))] space-y-4"
            >
              <div className="flex items-center justify-between">
                <Button
                  aria-label="Previous month"
                  variant="ghost"
                  size="icon"
                  onClick={() => shift(-1)}
                >
                  <ChevronLeft />
                </Button>
                <span className="type-label">Date range</span>
                <Button
                  aria-label="Next month"
                  variant="ghost"
                  size="icon"
                  onClick={() => shift(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {[
                  ["This month", 1],
                  ["3 months", 3],
                  ["6 months", 6],
                ].map(([label, months]) => (
                  <Button
                    key={label}
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setFrom(
                        iso(startOfMonth(addMonths(today, 1 - Number(months)))),
                      )
                      setTo(iso(endOfMonth(today)))
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 [&_button[id]]:w-32">
                <DateField
                  id="analysis-from"
                  label="From"
                  value={from}
                  onChange={(v) => {
                    if (v) setFrom(v)
                  }}
                />
                <DateField
                  id="analysis-to"
                  label="To"
                  value={to}
                  onChange={(v) => {
                    if (v) setTo(v)
                  }}
                />
              </div>
            </PopoverContent>
          </Popover>
        }
      />
      {from > to ? (
        <p role="alert" className="text-destructive">
          Choose an end date on or after the start date.
        </p>
      ) : (
        <DataGate load={load}>
          {(data) => (
            <AnalysisWorkspace
              settings={settings}
              data={data}
              from={from}
              to={to}
            />
          )}
        </DataGate>
      )}
    </div>
  )
}
function AnalysisWorkspace({
  settings,
  data,
  from,
  to,
}: {
  settings: ReturnType<typeof useAnalysisSettings>
  data: AnalysisData
  from: string
  to: string
}) {
  const {
    view,
    setView,
    dimension,
    setDimension,
    metric,
    setMetric,
    granularity,
    setGranularity,
    filters,
    setFilters,
    setCurrency,
  } = settings
  const currency =
    settings.currency ||
    (data.transactions.some((t) => t.currencyCode === "ZAR")
      ? "ZAR"
      : (data.transactions[0]?.currencyCode ?? "ZAR"))
  const [drill, setDrill] = useState<{
    title: string
    items: AnalysisTransaction[]
  } | null>(null)
  const [edits, setEdits] = useState<Record<string, TransactionFeedItem>>({})
  const [reviewItem, setReviewItem] = useState<TransactionFeedItem | null>(null)
  const [search, setSearch] = useState("")
  const [refineOpen, setRefineOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const activeFilters = Object.values(filters).reduce<number>(
    (n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0),
    0,
  )
  const metricLabel =
    metric === "income"
      ? "Money in"
      : metric === "all"
        ? "All movements"
        : metric === "expensesGross"
          ? "Spending"
          : "Net outflow"
  const enriched = useMemo(() => enrichTransactions({ ...data, transactions: data.transactions.map((item) => edits[item.id] ?? item) }), [data, edits])
  const transactions = useMemo(
    () => filterTransactions(enriched, { ...filters, currencyCode: currency }),
    [enriched, filters, currency],
  )
  const summary = summaryOf(transactions)
  const rows = aggregateBreakdown(transactions, dimension)
  const money = (n: number) =>
    new Intl.NumberFormat("en-ZA", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  const exact = (n: number) =>
    new Intl.NumberFormat("en-ZA", { style: "currency", currency }).format(n)
  const value = (r: (typeof rows)[number]) =>
    metric === "all"
      ? r.income + r.expensesGross + r.refunds
      : metric === "income"
        ? r.income
        : metric === "expensesGross"
          ? r.expensesGross
          : r.expensesNet
  const ranked = rows
    .filter((r) => value(r) !== 0)
    .sort((a, b) => Math.abs(value(b)) - Math.abs(value(a)))
  const total = ranked.reduce((n, r) => n + value(r), 0),
    magnitude = ranked.reduce((n, r) => n + Math.abs(value(r)), 0)
  const contributors = groupContributors(
    ranked,
    value,
    showAll ? ranked.length : 7,
  )
  const incomingParts = groupContributors(
    [...rows]
      .filter((r) => r.income + r.refunds > 0)
      .sort((a, b) => b.income + b.refunds - a.income - a.refunds),
    (r) => r.income + r.refunds,
  )
  const outgoingParts = groupContributors(
    [...rows]
      .filter((r) => r.expensesGross > 0)
      .sort((a, b) => b.expensesGross - a.expensesGross),
    (r) => r.expensesGross,
  )
  const metricTransactions = (items: AnalysisTransaction[]) =>
    metric === "income"
      ? items.filter((t) => t.isIncome && !t.isRefund)
      : metric === "expensesGross"
        ? items.filter((t) => t.isExpense)
        : metric === "expensesNet"
          ? items.filter((t) => t.isExpense || t.isRefund)
          : items
  const trendItems =
    view === "trends" ? metricTransactions(transactions) : transactions
  const trend = aggregateTrend(trendItems, from, to, granularity)
  const table = aggregateTable(transactions, from, to, dimension, granularity)
  function open(title: string, items: AnalysisTransaction[]) {
    setSearch("")
    setDrill({
      title,
      items: [...items].sort((a, b) =>
        b.occurredAt.localeCompare(a.occurredAt),
      ),
    })
  }
  function select(key: string) {
    const row = contributors.find((r) => r.key === key)
    open(
      row?.label ?? key,
      metricTransactions(
        transactions.filter((t) =>
          row?.memberKeys.includes(dimensionOf(t, dimension).key),
        ),
      ),
    )
  }
  const options = (pairs: [string, string][]) =>
    [...new Map(pairs)].sort((a, b) => a[1].localeCompare(b[1]))
  const currencies = [
    ...new Set([currency, ...data.transactions.map((t) => t.currencyCode)]),
  ]
  const shown =
    drill?.items.map((item) => enriched.find((current) => current.id === item.id) ?? item).filter((t) =>
      `${t.description} ${t.merchant.name ?? ""} ${t.account.name} ${t.category.name ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? []
  const patch = (key: keyof AnalysisFilter, values: string[]) =>
    setFilters((f) => ({ ...f, [key]: values }))
  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          aria-label="Analysis view"
          type="single"
          value={view}
          onValueChange={(v) => {
            if (v) setView(v as View)
          }}
          variant="outline"
          spacing={0}
        >
          {VIEWS.map((v) => (
            <ToggleGroupItem key={v.key} value={v.key}>
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={refineOpen}
          aria-controls="analysis-refinements"
          onClick={() => setRefineOpen((v) => !v)}
        >
          <SlidersHorizontal />
          Refine{activeFilters ? ` · ${activeFilters}` : ""}
        </Button>
      </div>
      {refineOpen && (
        <section
          id="analysis-refinements"
          aria-label="Refine analysis"
          className="space-y-4 rounded-lg border p-4"
        >
          <div className="flex flex-wrap gap-2">
            <MultiFilter
              label="Categories"
              values={filters.categoryIds ?? []}
              options={options([
                ...data.categories.map(
                  (c) => [c.id, c.name] as [string, string],
                ),
                ["uncategorised", "Uncategorised"],
              ])}
              onChange={(v) => patch("categoryIds", v)}
            />
            <MultiFilter
              label="Groups"
              values={filters.groupNames ?? []}
              options={options(
                data.categories.map((c) => [
                  c.group ?? "uncategorised",
                  c.group ?? "Uncategorised",
                ]),
              )}
              onChange={(v) => patch("groupNames", v)}
            />
            <MultiFilter
              label="Merchants"
              values={filters.merchantIds ?? []}
              options={options(
                enriched.map((t) => [
                  t.merchant.id ?? t.merchant.name ?? "unknown",
                  t.merchant.name ?? "Unknown merchant",
                ]),
              )}
              onChange={(v) => patch("merchantIds", v)}
            />
            <MultiFilter
              label="Accounts"
              values={filters.accountIds ?? []}
              options={data.accounts.map((a) => [a.id, a.name])}
              onChange={(v) => patch("accountIds", v)}
            />
            {Object.values(filters).some((v) =>
              Array.isArray(v) ? v.length : v,
            ) && (
              <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
                Reset filters
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <Choice
              label="Currency"
              value={currency}
              options={(currencies.length ? currencies : [currency]).map(
                (c) => [c, c],
              )}
              onChange={setCurrency}
            />
            <label className="flex items-center gap-2 type-caption">
              <Checkbox
                checked={filters.includeTransfers ?? false}
                onCheckedChange={(v) =>
                  setFilters((f) => ({ ...f, includeTransfers: v === true }))
                }
              />
              Include transfers
            </label>
            <label className="flex items-center gap-2 type-caption">
              <Checkbox
                checked={filters.includeExcluded ?? false}
                onCheckedChange={(v) =>
                  setFilters((f) => ({ ...f, includeExcluded: v === true }))
                }
              />
              Include excluded spend
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            {view !== "flow" && view !== "table" && (
              <Choice
                label="Measure"
                value={metric}
                onChange={(v) => setMetric(v as AnalysisMetric)}
                options={[
                  ["expensesNet", "Outflow less marked refunds"],
                  ["expensesGross", "Expenses (gross)"],
                  ["income", "Money in"],
                  ["all", "All movements"],
                ]}
              />
            )}
            {view !== "trends" && (
              <Choice
                label="Group by"
                value={dimension}
                onChange={(v) => setDimension(v as AnalysisDimension)}
                options={[
                  ["category", "By category"],
                  ["group", "By group"],
                  ["merchant", "By merchant"],
                  ["account", "By account"],
                ]}
              />
            )}
            {(view === "trends" || view === "table") && (
              <Choice
                label="Period"
                value={granularity}
                onChange={(v) => setGranularity(v as AnalysisGranularity)}
                options={[
                  ["day", "By day"],
                  ["week", "By week"],
                  ["month", "By month"],
                ]}
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="type-caption">
              Posted transactions only. Transfers and excluded spend stay out
              unless selected.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                exportRows(
                  [
                    [
                      "Date",
                      "Merchant / description",
                      "Account",
                      "Category",
                      "Amount",
                      "Currency",
                    ],
                    ...transactions.map((t) => [
                      t.occurredOn,
                      t.merchant.name ?? t.description,
                      t.account.name,
                      t.category.name ?? "Uncategorised",
                      t.amountMajor,
                      t.currencyCode,
                    ]),
                  ],
                  `analysis-${from}-${to}`,
                )
              }
            >
              <Download />
              Export transactions
            </Button>
          </div>
        </section>
      )}
      <div
        className={`grid gap-3 py-2 ${view === "breakdown" && (metric === "expensesNet" || metric === "income") ? "grid-cols-2" : "grid-cols-3"}`}
      >
        {!(view === "breakdown" && metric === "income") && (
          <Summary label="Money in" value={money(summary.income)} />
        )}
        {!(view === "breakdown" && metric === "expensesNet") && (
          <Summary label="Net outflow" value={money(summary.expensesNet)} />
        )}
        <Summary
          label={summary.net >= 0 ? "Surplus" : "Deficit"}
          value={money(summary.net)}
        />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="type-section-title">
          {view === "breakdown"
            ? showAll
              ? "All contributors"
              : "Top contributors"
            : view === "trends"
              ? "Over time"
              : view === "flow"
                ? "Money flow"
                : "By period"}
        </h2>
        <p className="type-caption">
          {transactions.length} transactions{activeFilters ? " · Filtered" : ""}
          {dimension !== "category" && view !== "trends"
            ? ` · By ${dimension}`
            : ""}
          {view === "trends" || view === "table"
            ? ` · ${granularity === "day" ? "Daily" : granularity === "week" ? "Weekly" : "Monthly"}`
            : ""}
        </p>
      </div>
      {!transactions.length || (view === "breakdown" && !ranked.length) ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
          <Search className="text-muted-foreground" />
          <h3 className="type-section-title">
            {transactions.length
              ? "No movements for this measure"
              : "No transactions in this view"}
          </h3>
          <p className="type-caption">
            Try another period or clear the filters.
          </p>
          <Button variant="outline" onClick={() => setFilters({})}>
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {view === "breakdown" && (
            <div className="grid items-start gap-8 lg:grid-cols-[1fr_1fr]">
              <div className="lg:sticky lg:top-6">
                <AnalysisRing
                  parts={contributors.map((r) => ({
                    key: r.key,
                    name: r.label,
                    value: r.weight,
                  }))}
                  total={total}
                  label={metricLabel}
                  format={money}
                  onSelect={select}
                />
                {ranked.some((r) => value(r) < 0) && (
                  <p className="type-caption text-center">
                    Ring sizes show absolute contributions; negative amounts are
                    net refunds.
                  </p>
                )}
              </div>
              <div className="divide-y">
                {contributors.map((r, i) => (
                  <Button
                    key={r.key}
                    variant="ghost"
                    className="h-auto w-full rounded-none px-1 py-2.5 text-left"
                    onClick={() => select(r.key)}
                  >
                    <div className="w-full space-y-2">
                      <div className="flex items-baseline justify-between gap-4">
                        <span className="type-body-small truncate">
                          {r.label}
                        </span>
                        <span className="type-numeric shrink-0">
                          {money(r.value)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="h-1.5 flex-1 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(r.weight / magnitude) * 100}%`,
                              background: ANALYSIS_COLORS[i % 5],
                            }}
                          />
                        </div>
                        <span className="type-caption min-w-10 text-right">
                          {((r.weight / magnitude) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </Button>
                ))}
                {ranked.length > 7 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 text-muted-foreground"
                    aria-expanded={showAll}
                    onClick={() => setShowAll((v) => !v)}
                  >
                    {showAll
                      ? "Show top contributors"
                      : `Show all ${ranked.length} contributors`}
                  </Button>
                )}
              </div>
            </div>
          )}
          {view === "trends" && (
            <>
              <AnalysisBars
                points={trend.map((p) => ({ ...p, expenses: p.out }))}
                format={money}
                onSelect={(key) =>
                  open(
                    trend.find((p) => p.key === key)?.label ?? key,
                    trendItems.filter(
                      (t) => periodKey(t.occurredOn, granularity) === key,
                    ),
                  )
                }
              />
              <div className="flex gap-5 type-caption">
                <span>Money in</span>
                <span>
                  Money out
                  {metric === "expensesNet" ? " · after marked refunds" : ""}
                </span>
              </div>
              <details className="type-caption">
                <summary className="cursor-pointer">Explore periods</summary>
                <div className="mt-2 flex flex-wrap gap-2">
                  {trend
                    .filter((p) => p.count > 0)
                    .map((p) => (
                      <Button
                        key={p.key}
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          open(
                            p.label,
                            trendItems.filter(
                              (t) =>
                                periodKey(t.occurredOn, granularity) === p.key,
                            ),
                          )
                        }
                      >
                        {p.label} · {money(p.net)}
                      </Button>
                    ))}
                </div>
              </details>
            </>
          )}
          {view === "flow" && (
            <>
              <CashFlowChart
                incoming={incomingParts.map((r) => ({
                  key: `in:${r.key}`,
                  name: r.label,
                  value: r.value,
                }))}
                outgoing={outgoingParts.map((r) => ({
                  key: `out:${r.key}`,
                  name: r.label,
                  value: r.value,
                }))}
                format={money}
                onSelect={(key) => {
                  const [side, ...rest] = key.split(":")
                  const k = rest.join(":")
                  const contributor = (
                    side === "in" ? incomingParts : outgoingParts
                  ).find((r) => r.key === k)
                  open(
                    contributor?.label ?? k,
                    transactions.filter(
                      (t) =>
                        contributor?.memberKeys.includes(
                          dimensionOf(t, dimension).key,
                        ) && (side === "in" ? t.isIncome : t.isExpense),
                    ),
                  )
                }}
              />
              <p className="type-caption">
                Cash flow shows gross inflows (including refunds) and gross
                outflows. Surplus or deficit balances the flow. Scroll
                horizontally on smaller screens.
              </p>
            </>
          )}
          {view === "table" && (
            <div className="min-w-0 w-full overflow-auto rounded-lg border [contain:inline-size]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 z-10 min-w-48 bg-background">
                      {dimension[0].toUpperCase() + dimension.slice(1)}
                    </TableHead>
                    {trend.map((p) => (
                      <TableHead
                        key={p.key}
                        className="text-right whitespace-nowrap"
                      >
                        {p.label}
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Average net</TableHead>
                    <TableHead className="text-right">Total net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {table.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell className="sticky left-0 bg-background">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            open(
                              r.label,
                              transactions.filter(
                                (t) => dimensionOf(t, dimension).key === r.key,
                              ),
                            )
                          }
                        >
                          {r.label}
                        </Button>
                      </TableCell>
                      {trend.map((p) => {
                        const cell = r.periods[p.key]
                        return (
                          <TableCell key={p.key} className="text-right">
                            <Button
                              variant="ghost"
                              className="h-auto flex-col items-end gap-1 py-2 type-numeric"
                              aria-label={`${r.label}, ${p.label}, show transactions`}
                              onClick={() =>
                                open(
                                  `${r.label} · ${p.label}`,
                                  transactions.filter(
                                    (t) =>
                                      dimensionOf(t, dimension).key === r.key &&
                                      periodKey(t.occurredOn, granularity) ===
                                        p.key,
                                  ),
                                )
                              }
                            >
                              {cell?.income ? (
                                <span className="text-foreground">
                                  +{money(cell.income)}
                                </span>
                              ) : null}
                              {cell?.out ? (
                                <span className="text-foreground">
                                  {money(-cell.out)}
                                </span>
                              ) : null}
                              {!cell?.income && !cell?.out && (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </Button>
                          </TableCell>
                        )
                      })}
                      <TableCell className="text-right type-numeric">
                        {money(r.net / (trend.length || 1))}
                      </TableCell>
                      <TableCell className="text-right type-numeric font-medium">
                        {money(r.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
      <details className="type-caption border-t pt-4">
        <summary className="w-fit cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
          About this data
        </summary>
        <div className="mt-3 max-w-prose space-y-2">
          <p>
            Net outflow deducts only credits explicitly marked as refunds. Other
            credits count as money in. Categories follow the ledger’s current
            classification.
          </p>
          <p>
            {data.sample
              ? `Local Supabase snapshot captured ${new Date(data.sample.fetchedAt).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" })}.`
              : demoEnabled()
                ? "Local demo data."
                : "Household ledger."}{" "}
            Tags are not available yet.
          </p>
        </div>
      </details>
      <Dialog
        open={!!drill}
        onOpenChange={(v) => {
          if (!v) setDrill(null)
        }}
      >
        <DialogContent className="sm:max-w-5xl max-h-[85dvh] overflow-hidden flex flex-col">
          <DialogTitle>{drill?.title}</DialogTitle>
          <DialogDescription>
            {shown.length} transactions · Net movement{" "}
            {money(shown.reduce((n, t) => n + t.amountMajor, 0))}
          </DialogDescription>
          <Input
            aria-label="Search transactions"
            placeholder="Search merchant, description, account…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="min-h-0 overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Merchant / description</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setReviewItem(t)}>
                    <TableCell className="whitespace-nowrap">
                      {t.occurredOn}
                    </TableCell>
                    <TableCell className="max-w-80">
                      <button type="button" className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Review ${t.merchant.name ?? t.description}`} onClick={(event) => { event.stopPropagation(); setReviewItem(t) }}>
                        {t.merchant.name ?? t.description}
                      </button>
                      {t.merchant.name && (
                        <p className="type-caption">{t.description}</p>
                      )}
                    </TableCell>
                    <TableCell>{t.account.name}</TableCell>
                    <TableCell>{t.category.name ?? "Uncategorised"}</TableCell>
                    <TableCell
                      className={`text-right whitespace-nowrap type-numeric ${t.amountMajor > 0 ? "text-foreground" : ""}`}
                    >
                      {exact(t.amountMajor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!shown.length && (
              <p className="p-8 text-center type-caption">
                No matching transactions.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {reviewItem && <TransactionReviewDialog key={reviewItem.id} item={reviewItem} categories={data.categories} readOnly={Boolean(data.sample)} onClose={() => setReviewItem(null)} onSaved={(item) => setEdits((current) => ({ ...current, [item.id]: item }))} />}
    </div>
  )
}
function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="type-caption">{label}</p>
      <p className="type-numeric mt-2 text-base sm:text-2xl font-semibold break-words text-foreground">
        {value}
      </p>
    </div>
  )
}
