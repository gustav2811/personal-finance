"use client"

import { useCallback, useState, type CSSProperties } from "react"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Fuel,
  ShoppingBasket,
  Utensils,
  Zap,
} from "lucide-react"
import { PageHeader } from "@/components/patterns/page-header"
import { DataGate } from "@/components/patterns/data-gate"
import { Button } from "@/components/ui/button"
import { addMonths, currentCycle, cycleLabel } from "@/domain/budget/cycle"
import type { OverviewData, OverviewId } from "@/domain/overview/model"
import {
  OrbitChart,
  SpendingTimeline,
  OVERVIEW_COLOURS,
} from "@/domain/overview/charts"
import { formatMoney } from "@/lib/format/money"
import { getOverviewData } from "./queries"
import styles from "./overview.module.css"

const ICONS = {
  electricity: Zap,
  groceries: ShoppingBasket,
  "eating-out": Utensils,
  fuel: Fuel,
  coffee: Coffee,
}

export function OverviewBody({
  data,
  onRefresh,
}: {
  data: OverviewData
  onRefresh?: () => void
}) {
  const [selected, setSelected] = useState<OverviewId>("electricity")
  const active =
    data.items.find((item) => item.id === selected) ?? data.items[0]
  return (
    <div className={styles.body}>
      {data.demo ? (
        <p className="type-caption text-muted-foreground">
          Orbit preview · illustrative amounts and budgets
        </p>
      ) : null}
      <section
        className={styles.orbitLayout}
        aria-label="Spending and remaining budgets"
      >
        <div className={styles.instrument}>
          <OrbitChart data={data} selected={selected} onSelect={setSelected} />
          <p className={`type-caption ${styles.ringCaption}`}>
            Each orbit is one category’s budget. Select one to explore.
          </p>
        </div>
        <div className={styles.categories} aria-label="Headline categories">
          {data.items.map((item, index) => {
            const Icon = ICONS[item.id]
            const percentage =
              item.budget !== null && item.budget > 0 && item.spent !== null
                ? Math.max(0, (item.spent / item.budget) * 100)
                : null
            return (
              <Button
                key={item.id}
                variant="ghost"
                aria-pressed={selected === item.id}
                aria-controls="overview-timeline"
                onClick={() => setSelected(item.id)}
                className={styles.category}
                style={
                  {
                    "--category-color": OVERVIEW_COLOURS[index],
                  } as CSSProperties
                }
              >
                <span className={styles.categoryIcon}>
                  <Icon aria-hidden="true" />
                </span>
                <span className={styles.categoryContent}>
                  <span className={styles.categoryName}>{item.label}</span>
                  <span className={styles.amount}>
                    {item.spent === null ? "—" : formatMoney(item.spent)}
                  </span>
                  {item.dataNote ? (
                    <span className="type-caption text-warning">
                      {item.dataNote}
                    </span>
                  ) : null}
                </span>
                <span className={styles.budgetContent}>
                  <span
                    className={`${styles.remaining} ${item.remaining !== null && item.remaining < 0 ? "text-warning" : ""}`}
                  >
                    {item.remaining === null
                      ? "—"
                      : `${formatMoney(Math.abs(item.remaining))} ${item.remaining < 0 ? "over" : "left"}`}
                  </span>
                  <span className={styles.budgetLabel}>
                    {item.budget === null
                      ? (item.budgetNote ?? "No budget linked")
                      : `of ${formatMoney(item.budget)}`}
                  </span>
                </span>
                <span className={`type-caption type-numeric ${styles.percentage}`}>
                  {percentage === null ? "—" : `${Math.round(percentage)}%`}
                </span>
              </Button>
            )
          })}
        </div>
      </section>
      {active ? (
        <SpendingTimeline
          key={`${data.cycleStart}-${active.id}`}
          item={active}
          index={data.items.indexOf(active)}
        />
      ) : null}
      <details className={`type-caption ${styles.provenance}`}>
        <summary>
          About this budget period
          {data.warnings.length ? " · some data needs attention" : ""}
        </summary>
        <div className="mt-3 max-w-prose space-y-2">
          <p>
            All five categories use{" "}
            {cycleLabel(data.cycleStart, data.endExclusive)} in Johannesburg
            time. Electricity is incurred usage cost; wallet top-ups and fees
            are excluded. Financial spending deducts explicitly marked refunds.
          </p>
          <p>
            Remaining amounts come from linked budget funds. Shared or
            incomplete budgets are left unfilled rather than estimated. These
            five categories are not your total household spending.
          </p>
          {data.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
          <p>
            Read{" "}
            {new Intl.DateTimeFormat("en-ZA", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Africa/Johannesburg",
            }).format(new Date(data.fetchedAt))}
            .
          </p>
          {onRefresh ? (
            <Button variant="outline" size="sm" onClick={onRefresh}>
              Refresh data
            </Button>
          ) : null}
        </div>
      </details>
    </div>
  )
}

export function OverviewView() {
  const [cycleStart, setCycleStart] = useState(() => currentCycle().start)
  const [refreshKey, setRefreshKey] = useState(0)
  const endExclusive = addMonths(cycleStart, 1)
  const load = useCallback(() => getOverviewData(cycleStart), [cycleStart])
  return (
    <div className={styles.page}>
      <PageHeader
        title="Overview"
        actions={
          <nav aria-label="Budget period" className={styles.periodControl}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous budget period"
              onClick={() => setCycleStart(addMonths(cycleStart, -1))}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              className="type-numeric"
              aria-label={`Return to current budget period. Viewing ${cycleLabel(cycleStart, endExclusive)}`}
              onClick={() => setCycleStart(currentCycle().start)}
            >
              <CalendarDays />
              {cycleLabel(cycleStart, endExclusive)}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next budget period"
              onClick={() => setCycleStart(addMonths(cycleStart, 1))}
            >
              <ChevronRight />
            </Button>
          </nav>
        }
      />
      <DataGate key={`${cycleStart}-${refreshKey}`} load={load}>
        {(data) => (
          <OverviewBody
            data={data}
            onRefresh={() => setRefreshKey((key) => key + 1)}
          />
        )}
      </DataGate>
    </div>
  )
}
