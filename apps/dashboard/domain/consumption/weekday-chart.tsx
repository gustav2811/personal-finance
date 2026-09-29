"use client"

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import type { WeekdayPoint } from "@/domain/consumption/energy-model"
import { formatNumber } from "@/lib/format/money"

const weekdayConfig = {
  kwh: { color: "var(--chart-1)", label: "Mean kWh" },
  weekend: { color: "var(--chart-2)", label: "Weekend" },
} satisfies ChartConfig

export function WeekdayChart({ points }: { points: WeekdayPoint[] }) {
  return (
    <ChartContainer className="aspect-auto h-48 w-full" config={weekdayConfig}>
      <BarChart data={points} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="label" tickLine={false} />
        <YAxis
          axisLine={false}
          tickFormatter={(value: number) => formatNumber(value, 0)}
          tickLine={false}
          width={32}
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
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
        />
        <Bar dataKey="kwh" radius={[6, 6, 0, 0]}>
          {points.map((point) => (
            <Cell
              fill={point.weekend ? "var(--color-weekend)" : "var(--color-kwh)"}
              key={point.label}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}
