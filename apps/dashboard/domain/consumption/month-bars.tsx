"use client"

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"

export type MonthBar = { label: string; month: string; value: number }
export type BarMarker = { label: string; text: string }

const barConfig = {
  value: { color: "var(--chart-1)", label: "Value" },
} satisfies ChartConfig

// One bar per month. The selected month keeps full colour, the rest recede.
// Markers draw a dashed guide on a month, used for tariff steps.
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
  if (bars.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>{emptyLabel}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={barConfig}>
      <BarChart data={bars} margin={{ left: 8, right: 8, top: 20 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="label" interval="preserveStartEnd" tickLine={false} />
        <YAxis
          axisLine={false}
          tickFormatter={(value: number) => format(value)}
          tickLine={false}
          width={56}
        />
        <ChartTooltip
          content={({ active, payload }) => {
            const item = payload?.[0]?.payload as MonthBar | undefined
            return active && item ? (
              <div className="type-numeric rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <span className="text-muted-foreground">{item.label}</span>{" "}
                <span className="font-medium">{format(item.value)}</span>
              </div>
            ) : null
          }}
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
        />
        {markers.map((marker) => (
          <ReferenceLine
            key={marker.label}
            label={{ fill: "var(--muted-foreground)", fontSize: 11, position: "top", value: marker.text }}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            x={marker.label}
          />
        ))}
        <Bar
          dataKey="value"
          onClick={(item) => onSelect((item as unknown as MonthBar).month)}
          radius={[6, 6, 0, 0]}
        >
          {bars.map((bar) => (
            <Cell
              cursor="pointer"
              fill="var(--color-value)"
              fillOpacity={bar.month === selected ? 1 : 0.45}
              key={bar.month}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
