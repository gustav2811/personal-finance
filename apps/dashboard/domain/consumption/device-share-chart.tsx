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
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { REST_KEY, type DeviceShare } from "@/domain/consumption/energy-model"
import { formatNumber } from "@/lib/format/money"

// Device colours walk the palette from chart-2 so new devices need no code change.
const PALETTE = ["--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-1"] as const

export function DeviceShareChart({ share }: { share: DeviceShare }) {
  if (share.series.length === 0 || share.points.length === 0) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No device readings</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  const config: ChartConfig = {
    [REST_KEY]: { color: "var(--muted)", label: "Rest of house" },
  }
  share.series.forEach((entry, index) => {
    config[entry.key] = { color: `var(${PALETTE[index % PALETTE.length]})`, label: entry.name }
  })

  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={config}>
      <BarChart data={share.points} margin={{ left: 8, right: 8, top: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis axisLine={false} dataKey="label" interval="preserveStartEnd" tickLine={false} />
        <YAxis
          axisLine={false}
          domain={[0, 100]}
          tickFormatter={(value: number) => `${value}%`}
          tickLine={false}
          width={40}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <span className="type-numeric">
                  {config[String(name)]?.label}: {formatNumber(Number(value))}%
                </span>
              )}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey={REST_KEY} fill={`var(--color-${REST_KEY})`} stackId="share" />
        {share.series.map((entry) => (
          <Bar
            dataKey={entry.key}
            fill={`var(--color-${entry.key})`}
            key={entry.key}
            radius={[0, 0, 0, 0]}
            stackId="share"
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
