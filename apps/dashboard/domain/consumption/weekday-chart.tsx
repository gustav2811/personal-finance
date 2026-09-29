"use client"

import { useId } from "react"
import { Bar, BarChart, ReferenceArea, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { WeekdayPoint } from "@/domain/consumption/energy-model"
import { formatNumber } from "@/lib/format/money"

const weekdayConfig = {
  kwh: { color: "var(--chart-1)", label: "Mean kWh" },
} satisfies ChartConfig

type TickProps = { payload?: { value: string }; x?: number; y?: number }

function DayTick({ payload, peak, x, y }: TickProps & { peak: string }) {
  const selected = payload?.value === peak
  return (
    <text
      className={selected ? "fill-foreground" : "fill-muted-foreground"}
      fontSize={12}
      fontWeight={selected ? 600 : 400}
      textAnchor="middle"
      x={x}
      y={(y ?? 0) + 12}
    >
      {payload?.value}
    </text>
  )
}

// Thin pill bars on a track, after Smart Charts 13. The busiest weekday sits in a soft column.
export function WeekdayChart({ points }: { points: WeekdayPoint[] }) {
  const id = `day-${useId().replace(/:/g, "")}`
  const peak = points.reduce<WeekdayPoint | null>(
    (best, point) => (point.kwh !== null && (!best || point.kwh > (best.kwh ?? 0)) ? point : best),
    null,
  )

  if (!peak || peak.kwh === null) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No closed days this month</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-2">
      <p className="type-numeric text-sm">
        <span className="text-muted-foreground">{peak.label}</span>{" "}
        <span className="font-medium">{formatNumber(peak.kwh)} kWh</span>
      </p>
      <ChartContainer className="aspect-auto h-48 w-full" config={weekdayConfig}>
        <BarChart data={points} margin={{ left: 8, right: 8, top: 8 }}>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--color-kwh)" }} />
              <stop offset="100%" style={{ stopColor: "var(--color-kwh)", stopOpacity: 0.55 }} />
            </linearGradient>
          </defs>
          <XAxis
            axisLine={false}
            dataKey="label"
            interval={0}
            tick={<DayTick peak={peak.label} />}
            tickLine={false}
          />
          <YAxis domain={[0, "dataMax"]} hide />
          <ReferenceArea
            fill="var(--muted)"
            fillOpacity={0.6}
            ifOverflow="visible"
            radius={14}
            x1={peak.label}
            x2={peak.label}
          />
          <ChartTooltip
            content={({ active, payload }) => {
              const item = payload?.[0]?.payload as WeekdayPoint | undefined
              return active && item && item.kwh !== null ? (
                <div className="type-numeric rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                  <span className="text-muted-foreground">{item.label}</span>{" "}
                  <span className="font-medium">{formatNumber(item.kwh)} kWh</span>
                </div>
              ) : null
            }}
            cursor={false}
          />
          <Bar
            background={{ fill: "var(--muted)", radius: 6 }}
            barSize={12}
            dataKey="kwh"
            fill={`url(#${id})`}
            radius={6}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}
