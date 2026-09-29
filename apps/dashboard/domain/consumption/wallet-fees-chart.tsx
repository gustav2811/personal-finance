"use client"

import { Pie, PieChart } from "recharts"
import { ChartContainer, type ChartConfig } from "@/components/ui/chart"
import type { WalletFees } from "@/domain/consumption/energy-model"
import { formatMoney } from "@/lib/format/money"

const feesConfig = {
  daily: { color: "var(--chart-1)", label: "Daily fees" },
  eft: { color: "var(--chart-3)", label: "EFT fees" },
  track: { color: "var(--muted)", label: "Track" },
} satisfies ChartConfig

// Half-ring gauge with separated segments and the total in the centre, after Smart Charts 10.
export function WalletFeesChart({ fees }: { fees: WalletFees }) {
  const segments = [
    { fill: "var(--color-daily)", key: "daily", value: fees.daily },
    { fill: "var(--color-eft)", key: "eft", value: fees.eft },
  ].filter((segment) => segment.value > 0)

  return (
    <div className="space-y-3">
      <div className="relative">
        <ChartContainer className="aspect-auto h-44 w-full" config={feesConfig}>
          <PieChart margin={{ bottom: 0, top: 0 }}>
            <Pie
              cornerRadius={10}
              cx="50%"
              cy="92%"
              data={[{ key: "track", value: 1 }]}
              dataKey="value"
              endAngle={0}
              fill="var(--color-track)"
              innerRadius="78%"
              isAnimationActive={false}
              outerRadius="100%"
              startAngle={180}
              stroke="none"
            />
            <Pie
              cornerRadius={10}
              cx="50%"
              cy="92%"
              data={segments}
              dataKey="value"
              endAngle={0}
              innerRadius="78%"
              nameKey="key"
              outerRadius="100%"
              paddingAngle={segments.length > 1 ? 4 : 0}
              startAngle={180}
              stroke="none"
            />
          </PieChart>
        </ChartContainer>
        <p className="type-numeric pointer-events-none absolute inset-x-0 bottom-1 text-center text-3xl font-semibold tracking-tight">
          {formatMoney(fees.total, 2)}
        </p>
      </div>
      <dl className="flex justify-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: "var(--chart-1)" }} />
          <dt className="text-muted-foreground">Daily</dt>
          <dd className="type-numeric font-medium">{formatMoney(fees.daily, 2)}</dd>
        </div>
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full" style={{ background: "var(--chart-3)" }} />
          <dt className="text-muted-foreground">EFT</dt>
          <dd className="type-numeric font-medium">{formatMoney(fees.eft, 2)}</dd>
        </div>
      </dl>
    </div>
  )
}
