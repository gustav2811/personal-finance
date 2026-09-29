"use client"

import { useId } from "react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
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

// Devices walk the cool end of the palette so pink stays whole-home usage and violet stays
// money. New devices need no code change.
const PALETTE = ["--chart-3", "--chart-5", "--chart-4", "--chart-2", "--chart-1"] as const

export function DeviceShareChart({ share }: { share: DeviceShare }) {
  const id = useId().replace(/:/g, "")
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
    [REST_KEY]: { color: "var(--muted-foreground)", label: "Rest of house" },
  }
  share.series.forEach((entry, index) => {
    config[entry.key] = { color: `var(${PALETTE[index % PALETTE.length]})`, label: entry.name }
  })

  return (
    <ChartContainer className="aspect-auto h-64 w-full" config={config}>
      <BarChart data={share.points} margin={{ left: 8, right: 8, top: 8 }}>
        <defs>
          {Object.keys(config).map((key) => (
            <linearGradient id={`${id}-${key}`} key={key} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: `var(--color-${key})` }} />
              <stop offset="100%" style={{ stopColor: `var(--color-${key})`, stopOpacity: 0.6 }} />
            </linearGradient>
          ))}
        </defs>
        <XAxis axisLine={false} dataKey="label" interval={0} tickLine={false} />
        <YAxis domain={[0, 100]} hide />
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
        {[REST_KEY, ...share.series.map((entry) => entry.key)].map((key) => (
          <Bar
            barSize={16}
            dataKey={key}
            fill={`url(#${id}-${key})`}
            key={key}
            radius={8}
            stackId="share"
            stroke="var(--background)"
            strokeWidth={2}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}
