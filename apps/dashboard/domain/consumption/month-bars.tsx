"use client"

import { useId } from "react"
import { Bar, BarChart, ReferenceArea, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export type MonthBar = { label: string; month: string; value: number }
export type BarMarker = { label: string; text: string }

const barConfig = {
  value: { color: "var(--chart-1)", label: "Value" },
} satisfies ChartConfig

type TickProps = { payload?: { value: string }; x?: number; y?: number }

function MonthTick({ payload, selectedLabel, x, y }: TickProps & { selectedLabel: string }) {
  const selected = payload?.value === selectedLabel
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

// Thin pill bars on a track, after Smart Charts 13. The selected month sits in a soft column.
// A tariff step gets a tinted column, after Smart Charts 8.
export function MonthBars({
  bars,
  emptyLabel,
  format,
  markers,
  onSelect,
  selected,
}: {
  bars: MonthBar[]
  emptyLabel: string
  format: (value: number) => string
  markers: BarMarker[]
  onSelect: (month: string) => void
  selected: string
}) {
  const id = useId().replace(/:/g, "")
  const fillId = `pill-${id}`
  const rateId = `rate-${id}`

  if (bars.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>{emptyLabel}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  const active = bars.find((bar) => bar.month === selected) ?? bars[bars.length - 1]

  return (
    <div className="space-y-2">
      <p className="type-numeric text-sm">
        <span className="text-muted-foreground">{active.label}</span>{" "}
        <span className="font-medium">{format(active.value)}</span>
      </p>
      <ChartContainer className="aspect-auto h-56 w-full" config={barConfig}>
        <BarChart data={bars} margin={{ left: 8, right: 8, top: 24 }}>
          <defs>
            <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--color-value)" }} />
              <stop offset="100%" style={{ stopColor: "var(--color-value)", stopOpacity: 0.55 }} />
            </linearGradient>
            <linearGradient id={rateId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--color-value)", stopOpacity: 0.25 }} />
              <stop offset="100%" style={{ stopColor: "var(--color-value)", stopOpacity: 0 }} />
            </linearGradient>
          </defs>
          <XAxis
            axisLine={false}
            dataKey="label"
            interval={0}
            tick={<MonthTick selectedLabel={active.label} />}
            tickLine={false}
          />
          <YAxis domain={[0, "dataMax"]} hide />
          <ReferenceArea
            fill="var(--muted)"
            fillOpacity={0.6}
            ifOverflow="visible"
            radius={14}
            x1={active.label}
            x2={active.label}
          />
          {markers.map((marker) => (
            <ReferenceArea
              fill={`url(#${rateId})`}
              ifOverflow="visible"
              key={marker.label}
              label={{
                fill: "var(--muted-foreground)",
                fontSize: 11,
                position: "top",
                value: marker.text,
              }}
              radius={14}
              x1={marker.label}
              x2={marker.label}
            />
          ))}
          <ChartTooltip
            content={({ active: hovering, payload }) => {
              const item = payload?.[0]?.payload as MonthBar | undefined
              return hovering && item ? (
                <div className="type-numeric rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                  <span className="text-muted-foreground">{item.label}</span>{" "}
                  <span className="font-medium">{format(item.value)}</span>
                </div>
              ) : null
            }}
            cursor={false}
          />
          <Bar
            background={{ fill: "var(--muted)", radius: 6 }}
            barSize={12}
            dataKey="value"
            fill={`url(#${fillId})`}
            onClick={(item) => onSelect((item as unknown as MonthBar).month)}
            radius={6}
          />
        </BarChart>
      </ChartContainer>
    </div>
  )
}
