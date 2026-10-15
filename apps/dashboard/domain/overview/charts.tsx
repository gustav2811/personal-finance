"use client"

import { useState, type CSSProperties } from "react"
import Link from "next/link"
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Pie,
  PieChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cycleLabel, formatDayMonth } from "@/domain/budget/cycle"
import type { OverviewData, OverviewId, OverviewItem } from "./model"
import { formatMoney } from "@/lib/format/money"
import { localDateKey } from "@/lib/format/date"
import styles from "./charts.module.css"

// Retain the chart hues while giving saturated blue enough contrast in both themes.
export const OVERVIEW_COLOURS = [1, 2, 3, 4, 5].map(
  (index) =>
    `color-mix(in oklab, var(--chart-${index}) ${index === 3 ? 76 : 88}%, var(--foreground))`,
)
const COLOURS = OVERVIEW_COLOURS

export function OrbitChart({
  data,
  selected,
  onSelect,
}: {
  data: OverviewData
  selected: OverviewId
  onSelect: (id: OverviewId) => void
}) {
  const today = localDateKey(data.fetchedAt)
  const remainingDays = Math.max(
    0,
    Math.ceil((Date.parse(data.endExclusive) - Date.parse(today)) / 86400000),
  )
  const future = today < data.cycleStart
  const closed = today >= data.endExclusive
  return (
    <div className={styles.orbit}>
      <ChartContainer
        className="aspect-square w-full"
        config={Object.fromEntries(
          data.items.map((item, index) => [
            item.id,
            { label: item.label, color: COLOURS[index] },
          ]),
        )}
      >
        <PieChart
          accessibilityLayer
          margin={{ top: 6, right: 6, bottom: 6, left: 6 }}
        >
          {data.items.map((item, index) => {
            const share =
              item.spent !== null && item.budget !== null && item.budget > 0
                ? Math.min(1, Math.max(0, item.spent / item.budget))
                : null
            const outer = 96 - index * 12
            return (
              <Pie
                key={item.id}
                data={[
                  { name: item.label, value: share ?? 0 },
                  { name: "Remaining", value: 1 - (share ?? 0) },
                ]}
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                innerRadius={`${outer - 7}%`}
                outerRadius={`${outer}%`}
                cornerRadius={12}
                stroke="none"
                isAnimationActive={false}
                className={styles.arc}
              >
                <Cell
                  fill={COLOURS[index]}
                  opacity={selected === item.id ? 1 : 0.85}
                  role="button"
                  tabIndex={share !== null && share > 0 ? 0 : -1}
                  aria-label={`${item.label}: ${share === null ? "budget unavailable" : `${Math.round(((item.spent ?? 0) / (item.budget ?? 1)) * 100)}% of budget used`}. Show spending timeline`}
                  aria-pressed={selected === item.id}
                  onClick={() => onSelect(item.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      onSelect(item.id)
                    }
                  }}
                />
                <Cell fill="var(--muted)" opacity={share === null ? 0.4 : 1} />
              </Pie>
            )
          })}
        </PieChart>
      </ChartContainer>
      <div className={styles.orbitCentre} aria-hidden="true">
        <span className={styles.centreDate}>
          {cycleLabel(data.cycleStart, data.endExclusive)}
        </span>
        {closed ? (
          <strong className={styles.closedLabel}>Complete</strong>
        ) : future ? (
          <strong className={styles.closedLabel}>Upcoming</strong>
        ) : (
          <>
            <strong className={styles.days}>{remainingDays}</strong>
            <span className={styles.centreCaption}>
              {remainingDays === 1 ? "day left" : "days left"}
            </span>
          </>
        )}
      </div>
      <span className="sr-only">
        {cycleLabel(data.cycleStart, data.endExclusive)}.{" "}
        {closed
          ? "Completed budget period"
          : future
            ? "Upcoming budget period"
            : `${remainingDays} days left`}
        . Each ring shows the proportion used of its own category budget.
      </span>
    </div>
  )
}

export function SpendingTimeline({
  item,
  index,
}: {
  item: OverviewItem
  index: number
}) {
  const [measure, setMeasure] = useState<"cumulative" | "daily">(() =>
    item.points.some((point) => point.cumulative !== null)
      ? "cumulative"
      : "daily",
  )
  const lastAvailable = item.points.findLastIndex(
    (point) => point.daily !== null,
  )
  const [dayIndex, setDayIndex] = useState(Math.max(0, lastAvailable))
  const point = item.points[dayIndex]
  const value = point ? point[measure] : null
  const query = new URLSearchParams({
    from: item.points[0]?.date ?? "",
    to: item.points.at(-1)?.date ?? "",
  })
  for (const categoryId of item.categoryIds)
    query.append("category", categoryId)
  const href = `${item.id === "electricity" ? "/utilities" : "/analysis"}?${query}`
  return (
    <section
      id="overview-timeline"
      className={styles.timeline}
      aria-label={`${item.label} spending timeline`}
      style={{ "--series-color": COLOURS[index] } as CSSProperties}
    >
      <div className={styles.timelineHeader}>
        <div>
          <h2 className="type-section-title">{item.label}</h2>
          <p className="type-caption">
            {item.id === "electricity" ? "Usage cost" : "Spending"} · this
            budget period
          </p>
        </div>
        <div className={styles.timelineActions}>
          <ToggleGroup
            aria-label="Spending measure"
            type="single"
            value={measure}
            onValueChange={(next) => {
              if (next === "daily" || next === "cumulative") setMeasure(next)
            }}
            variant="outline"
            size="sm"
            spacing={0}
          >
            <ToggleGroupItem value="cumulative">Cumulative</ToggleGroupItem>
            <ToggleGroupItem value="daily">Daily</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="ghost" size="sm" asChild>
            <Link href={href}>
              Explore {item.id === "electricity" ? "utilities" : "analysis"}
              <ArrowUpRight />
            </Link>
          </Button>
        </div>
      </div>
      {lastAvailable < 0 ? (
        <div className={styles.empty}>
          No{" "}
          {item.id === "electricity"
            ? "closed-day usage charges"
            : "spending data"}{" "}
          in this budget period.
        </div>
      ) : (
        <>
          <div
            className={styles.dateReadout}
            aria-live="polite"
            aria-atomic="true"
          >
            <span>{point ? formatDayMonth(point.date) : ""}</span>
            <strong>
              {value === null ? "No reading" : formatMoney(value ?? 0, 2)}
            </strong>
            <span>
              {measure === "daily" ? "on this day" : "through this day"}
            </span>
          </div>
          <ChartContainer
            className="aspect-auto h-56 w-full sm:h-64"
            config={{
              cumulative: { label: "Cumulative spend", color: COLOURS[index] },
              daily: { label: "Daily spend", color: COLOURS[index] },
            }}
          >
            <ComposedChart
              data={item.points}
              margin={{ top: 12, right: 8, left: 0, bottom: 0 }}
              accessibilityLayer
              onClick={(state) => {
                const date = state?.activeLabel
                const next = item.points.findIndex(
                  (entry) => entry.date === date,
                )
                if (next >= 0) setDayIndex(next)
              }}
            >
              <CartesianGrid vertical={false} strokeDasharray="3 6" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDayMonth}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
                tickMargin={12}
                interval="preserveStartEnd"
              />
              <YAxis
                width={54}
                axisLine={false}
                tickLine={false}
                tickFormatter={(amount) => formatMoney(amount)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(date) => formatDayMonth(String(date))}
                    formatter={(amount) => formatMoney(Number(amount), 2)}
                  />
                }
                cursor={{
                  stroke: "var(--muted-foreground)",
                  strokeDasharray: "3 4",
                }}
              />
              {measure === "cumulative" ? (
                <Area
                  type="stepAfter"
                  dataKey="cumulative"
                  stroke="var(--series-color)"
                  strokeWidth={2.5}
                  fill="var(--series-color)"
                  fillOpacity={0.09}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Bar
                  dataKey="daily"
                  fill="var(--series-color)"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={20}
                  isAnimationActive={false}
                />
              )}
              {point ? (
                <ReferenceLine
                  x={point.date}
                  stroke="var(--series-color)"
                  strokeOpacity={0.5}
                  strokeDasharray="3 5"
                />
              ) : null}
            </ComposedChart>
          </ChartContainer>
          <div className={styles.timelineFooter}>
            <p className="type-caption">
              {item.coverageThrough
                ? `${item.id === "electricity" ? "Usage" : "Spending"} through ${formatDayMonth(item.coverageThrough)}`
                : "No complete data yet"}
            </p>
            <div
              className="flex items-center gap-2"
              role="group"
              aria-label="Inspect timeline dates"
            >
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous day"
                disabled={dayIndex <= 0}
                onClick={() => setDayIndex((day) => day - 1)}
              >
                <ChevronLeft />
              </Button>
              <span className="type-caption">Inspect a day</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next day"
                disabled={dayIndex >= item.points.length - 1}
                onClick={() => setDayIndex((day) => day + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
