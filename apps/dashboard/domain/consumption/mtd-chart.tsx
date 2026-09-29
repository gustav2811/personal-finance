"use client"

import { useMemo } from "react"
import { Area, Bar, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import type { MtdPoint } from "@/domain/consumption/energy-model"
import { formatMoney, formatNumber } from "@/lib/format/money"

export type MtdMetric = "kwh" | "rand"

// Usage in kWh is pink and money in rand is violet, matching the bars. Payments in are
// success and wallet fees are warning.
function mtdConfig(metric: MtdMetric) {
  return {
    current: { color: metric === "kwh" ? "var(--chart-1)" : "var(--chart-2)", label: "This month" },
    previous: { color: "var(--muted-foreground)", label: "Last month" },
    deposits: { color: "var(--success)", label: "Payments in" },
    fees: { color: "var(--warning)", label: "Wallet fees" },
  } satisfies ChartConfig
}

type Row = {
  day: number
  current: number | null
  previous: number | null
  deposits: number | null
  fees: number | null
  source: MtdPoint
}

function TooltipBody({ row }: { row: Row }) {
  const { source } = row
  return (
    <div className="grid min-w-40 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">Day {row.day}</p>
      {source.kwh !== null ? (
        <p className="type-numeric flex justify-between gap-4">
          <span className="text-muted-foreground">This month</span>
          <span>
            {formatNumber(source.kwh)} kWh · {formatMoney(source.rand ?? 0)}
          </span>
        </p>
      ) : null}
      {source.lastKwh !== null ? (
        <p className="type-numeric flex justify-between gap-4">
          <span className="text-muted-foreground">Last month</span>
          <span>
            {formatNumber(source.lastKwh)} kWh · {formatMoney(source.lastRand ?? 0)}
          </span>
        </p>
      ) : null}
      {source.deposits !== null ? (
        <p className="type-numeric flex justify-between gap-4">
          <span className="text-muted-foreground">Payment in</span>
          <span>{formatMoney(source.deposits)}</span>
        </p>
      ) : null}
      {source.fees !== null ? (
        <p className="type-numeric flex justify-between gap-4">
          <span className="text-muted-foreground">Wallet fee</span>
          <span>{formatMoney(source.fees, 2)}</span>
        </p>
      ) : null}
    </div>
  )
}

export function MtdChart({
  metric,
  points,
  showDeposits,
  showFees,
  showLast,
}: {
  metric: MtdMetric
  points: MtdPoint[]
  showDeposits: boolean
  showFees: boolean
  showLast: boolean
}) {
  const rows = useMemo<Row[]>(
    () =>
      points.map((point) => ({
        current: metric === "kwh" ? point.kwh : point.rand,
        day: point.day,
        deposits: point.deposits,
        fees: point.fees,
        previous: metric === "kwh" ? point.lastKwh : point.lastRand,
        source: point,
      })),
    [metric, points],
  )
  const showMoneyAxis = showDeposits
  const format = (value: number) => (metric === "kwh" ? formatNumber(value, 0) : formatMoney(value))

  return (
    <ChartContainer className="aspect-auto h-72 w-full" config={mtdConfig(metric)}>
      <ComposedChart data={rows} margin={{ left: 8, right: 16, top: 8 }}>
        <defs>
          <linearGradient id="mtd-cursor" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-current)", stopOpacity: 0.22 }} />
            <stop offset="100%" style={{ stopColor: "var(--color-current)", stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id="mtd-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-current)", stopOpacity: 0.35 }} />
            <stop offset="100%" style={{ stopColor: "var(--color-current)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="day" interval={2} tickLine={false} />
        <YAxis
          axisLine={false}
          tickFormatter={format}
          tickLine={false}
          width={metric === "kwh" ? 36 : 56}
          yAxisId="usage"
        />
        {showMoneyAxis ? (
          <YAxis
            axisLine={false}
            orientation="right"
            tickFormatter={(value: number) => formatMoney(value)}
            tickLine={false}
            width={56}
            yAxisId="money"
          />
        ) : null}
        <ChartTooltip
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as Row | undefined
            return active && row ? <TooltipBody row={row} /> : null
          }}
          cursor={{ fill: "url(#mtd-cursor)", radius: 10 }}
        />
        {showLast ? (
          <Line
            connectNulls
            dataKey="previous"
            dot={false}
            stroke="var(--color-previous)"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            type="monotone"
            yAxisId="usage"
          />
        ) : null}
        <Area
          activeDot={{ fill: "var(--background)", r: 5, stroke: "var(--color-current)", strokeWidth: 3 }}
          dataKey="current"
          dot={false}
          fill="url(#mtd-fill)"
          stroke="var(--color-current)"
          strokeWidth={3}
          type="monotone"
          yAxisId="usage"
        />
        {showDeposits ? (
          <Bar
            barSize={3}
            dataKey="deposits"
            fill="var(--color-deposits)"
            radius={2}
            yAxisId="money"
          />
        ) : null}
        {showFees ? (
          <>
            {/* Fees are cents next to payments, so they get their own hidden scale. */}
            <YAxis domain={[0, "dataMax"]} hide yAxisId="fees" />
            <Bar barSize={3} dataKey="fees" fill="var(--color-fees)" radius={2} yAxisId="fees" />
          </>
        ) : null}
      </ComposedChart>
    </ChartContainer>
  )
}
