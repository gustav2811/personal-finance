"use client"

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { ChartPoint } from "@/domain/consumption/model"
import { formatNumber } from "@/lib/format/money"

const energyConfig = {
  homeKwh: { color: "var(--chart-1)", label: "Whole home" },
  espressoKwh: { color: "var(--chart-2)", label: "Espresso" },
} satisfies ChartConfig

export function EnergyChart({ series }: { series: ChartPoint[] }) {
  if (series.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No energy readings</EmptyTitle>
          <EmptyDescription>No daily energy readings in this range.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ChartContainer className="aspect-auto h-72 w-full" config={energyConfig}>
      <LineChart data={series} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="label" minTickGap={28} tickLine={false} />
        <YAxis
          axisLine={false}
          tickFormatter={(value: number) => formatNumber(value, 0)}
          tickLine={false}
          width={36}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="type-numeric">
                  {formatNumber(Number(value))} kWh
                  <span className="sr-only">{String(name)}</span>
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Line
          dataKey="homeKwh"
          dot={false}
          stroke="var(--color-homeKwh)"
          strokeWidth={2}
          type="monotone"
        />
        <Line
          dataKey="espressoKwh"
          dot={false}
          stroke="var(--color-espressoKwh)"
          strokeWidth={2}
          type="monotone"
        />
      </LineChart>
    </ChartContainer>
  )
}
