"use client"

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import type { MoneyPoint } from "@/domain/consumption/model"
import { formatMoney } from "@/lib/format/money"

const moneyConfig = {
  debits: { color: "var(--chart-1)", label: "Debits" },
  credits: { color: "var(--chart-2)", label: "Credits" },
} satisfies ChartConfig

export function MoneyChart({ series }: { series: MoneyPoint[] }) {
  if (series.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No wallet movement</EmptyTitle>
          <EmptyDescription>No wallet movement in this range.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={moneyConfig}>
      <BarChart data={series} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="label" minTickGap={20} tickLine={false} />
        <YAxis
          axisLine={false}
          tickFormatter={(value: number) => formatMoney(value)}
          tickLine={false}
          width={56}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value) => (
                <span className="type-numeric">{formatMoney(Number(value))}</span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="debits" fill="var(--color-debits)" radius={4} />
        <Bar dataKey="credits" fill="var(--color-credits)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
