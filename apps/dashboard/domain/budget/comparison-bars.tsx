"use client"

import { ChartTooltipSurface } from "@/components/patterns/chart-tooltip-surface"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart"
import { copy } from "@/domain/budget/copy"
import type { ChartRow } from "@/domain/budget/history"

const comparisonConfig = {
  original: { color: "var(--chart-1)", label: copy.originalPlan },
  revised: { color: "var(--chart-2)", label: copy.revisedPlan },
  spent: { color: "var(--chart-3)", label: copy.spent },
} satisfies ChartConfig

function ComparisonTip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: ChartRow }>
}) {
  const row = payload?.[0]?.payload
  if (!active || !row) return null
  return (
    <ChartTooltipSurface className="grid gap-1">
      <p className="font-medium">{row.name}</p>
      <p>
        {copy.originalPlan}: {row.originalText}
      </p>
      <p>
        {copy.revisedPlan}: {row.revisedText}
      </p>
      <p>
        {copy.spent}: {row.spentText}
      </p>
    </ChartTooltipSurface>
  )
}

// Grouped bars after Smart Charts 5. The table still answers the comparison if this is omitted.
export function ComparisonBars({ rows }: { rows: ChartRow[] | null }) {
  if (!rows || rows.length === 0) return null

  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={comparisonConfig}>
      <BarChart data={rows} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="name" minTickGap={8} tickLine={false} />
        <ChartTooltip content={<ComparisonTip />} cursor={false} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar barSize={12} dataKey="original" fill="var(--chart-1)" radius={4} />
        <Bar barSize={12} dataKey="revised" fill="var(--chart-2)" radius={4} />
        <Bar barSize={12} dataKey="spent" fill="var(--chart-3)" radius={4} />
      </BarChart>
    </ChartContainer>
  )
}
