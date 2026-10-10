"use client"

import { CartesianGrid, Line, LineChart, XAxis } from "recharts"
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart"
import type { FundPoint } from "@/domain/budget/fund"

const config = {
  balance: { color: "var(--chart-1)", label: "Balance" },
} satisfies ChartConfig

function Tip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: FundPoint }> }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null
  return (
    <div className="type-numeric rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p>{point.when}</p>
      <p>{point.balanceText}</p>
    </div>
  )
}

export function FundLine({ points }: { points: FundPoint[] }) {
  if (points.length < 2) return null
  return (
    <ChartContainer className="aspect-auto h-48 w-full" config={config}>
      <LineChart data={points} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="when" minTickGap={16} tickLine={false} />
        <ChartTooltip content={<Tip />} cursor={false} />
        <Line dataKey="balance" dot={false} stroke="var(--chart-1)" strokeWidth={2} type="monotone" />
      </LineChart>
    </ChartContainer>
  )
}
