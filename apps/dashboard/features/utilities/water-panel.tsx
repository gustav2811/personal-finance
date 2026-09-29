"use client"

import { useMemo, useState } from "react"
import { Section } from "@/components/patterns/section"
import { historyMonths } from "@/domain/consumption/energy-model"
import { MonthBars } from "@/domain/consumption/month-bars"
import { buildWaterMonths } from "@/domain/consumption/water-model"
import type { EnergyData } from "@/features/utilities/queries"
import type { HistoryWindow } from "@/lib/range"
import { formatMoney, formatNumber } from "@/lib/format/money"

function WaterBody({ data, window }: { data: EnergyData; window: HistoryWindow }) {
  const all = useMemo(() => buildWaterMonths(data.ledgerEntries), [data.ledgerEntries])
  const latest = all[all.length - 1]
  const [selectedMonth, setSelectedMonth] = useState(latest?.month ?? "")

  const visible = useMemo(() => {
    if (all.length === 0) return []
    const months = historyMonths(all[0].month, all[all.length - 1].month, window)
    return all.filter((point) => months.includes(point.month))
  }, [all, window])

  if (!latest) {
    return <p className="type-body text-muted-foreground">No water invoices.</p>
  }

  return (
    <div className="space-y-8">
      <section aria-label="Latest month" className="space-y-1">
        <p className="type-label text-muted-foreground">{latest.label}</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="type-numeric flex items-center gap-3 text-5xl font-semibold tracking-tight">
            <span aria-hidden className="size-3 rounded-full bg-chart-4" />
            {formatNumber(latest.kl)}
            <span className="ml-2 text-2xl font-medium text-muted-foreground">kl</span>
          </p>
          <p className="type-numeric flex items-center gap-3 text-3xl font-semibold tracking-tight">
            <span aria-hidden className="size-2.5 rounded-full bg-chart-2" />
            {formatMoney(latest.cost)}
          </p>
        </div>
        <p className="type-caption">
          {latest.kl > 0 ? `R${formatNumber(latest.cost / latest.kl, 2)} per kl` : ""}
        </p>
      </section>

      <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2 [&>section]:min-w-0">
        <Section title="Usage">
          <MonthBars
            bars={visible.map((point) => ({ label: point.label, month: point.month, value: point.kl }))}
            color="var(--chart-4)"
            emptyLabel="No water invoices"
            format={(value) => `${formatNumber(value)} kl`}
            markers={[]}
            onSelect={setSelectedMonth}
            selected={selectedMonth}
          />
        </Section>

        <Section title="Cost">
          <MonthBars
            bars={visible.map((point) => ({ label: point.label, month: point.month, value: point.cost }))}
            color="var(--chart-2)"
            emptyLabel="No water invoices"
            format={(value) => formatMoney(value)}
            markers={[]}
            onSelect={setSelectedMonth}
            selected={selectedMonth}
          />
        </Section>
      </div>
    </div>
  )
}

export { WaterBody as WaterPanel }
