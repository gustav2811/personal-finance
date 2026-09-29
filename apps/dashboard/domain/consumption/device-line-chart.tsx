"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { DeviceDayPoint } from "@/domain/consumption/energy-model"
import { formatNumber } from "@/lib/format/money"

const lineConfig = {
  current: { color: "var(--chart-1)", label: "This month" },
  previous: { color: "var(--muted-foreground)", label: "Last month" },
} satisfies ChartConfig

// Two overlapping series with a vertical guide and ring marker, after Smart Charts 9.
export function DeviceLineChart({ points }: { points: DeviceDayPoint[] }) {
  if (points.every((point) => point.current === null && point.previous === null)) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No readings for this device in the last two months</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={lineConfig}>
      <LineChart data={points} margin={{ left: 8, right: 16, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="day" interval={2} tickLine={false} />
        <YAxis
          axisLine={false}
          tickFormatter={(value: number) => formatNumber(value, 0)}
          tickLine={false}
          width={32}
        />
        <ChartTooltip
          content={({ active, payload }) => {
            const row = payload?.[0]?.payload as DeviceDayPoint | undefined
            return active && row ? (
              <div className="type-numeric grid min-w-36 gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <p className="font-medium">Day {row.day}</p>
                {row.current !== null ? (
                  <p className="flex justify-between gap-4">
                    <span className="text-muted-foreground">This month</span>
                    <span>{formatNumber(row.current)} kWh</span>
                  </p>
                ) : null}
                {row.previous !== null ? (
                  <p className="flex justify-between gap-4">
                    <span className="text-muted-foreground">Last month</span>
                    <span>{formatNumber(row.previous)} kWh</span>
                  </p>
                ) : null}
              </div>
            ) : null
          }}
          cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
        />
        <Line
          activeDot={{ fill: "var(--background)", r: 5, stroke: "var(--color-previous)", strokeWidth: 3 }}
          dataKey="previous"
          dot={false}
          stroke="var(--color-previous)"
          strokeWidth={2}
          type="monotone"
        />
        <Line
          activeDot={{ fill: "var(--background)", r: 5, stroke: "var(--color-current)", strokeWidth: 3 }}
          dataKey="current"
          dot={false}
          stroke="var(--color-current)"
          strokeWidth={3}
          type="monotone"
        />
      </LineChart>
    </ChartContainer>
  )
}
