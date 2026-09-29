"use client"

import { useMemo, useState } from "react"
import { Section } from "@/components/patterns/section"
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { historyMonths } from "@/domain/consumption/energy-model"
import { MonthBars } from "@/domain/consumption/month-bars"
import { buildWaterMonths } from "@/domain/consumption/water-model"
import type { EnergyData } from "@/features/utilities/queries"
import type { HistoryWindow } from "@/lib/range"
import { formatMoney, formatNumber } from "@/lib/format/money"

export function WaterPanel({ data, window }: { data: EnergyData; window: HistoryWindow }) {
  const all = useMemo(() => buildWaterMonths(data.ledgerEntries), [data.ledgerEntries])
  const latest = all.at(-1)
  const [selectedMonth, setSelectedMonth] = useState(latest?.month ?? "")

  const visible = useMemo(() => {
    if (all.length === 0) return []
    const months = historyMonths(all[0].month, all[all.length - 1].month, window)
    return all.filter((point) => months.includes(point.month))
  }, [all, window])

  if (!latest) {
    return (
      <Empty className="min-h-48 border">
        <EmptyHeader>
          <EmptyTitle>No water invoices</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="space-y-10">
      <section aria-label="Latest invoice" className="space-y-1">
        <p className="type-label text-muted-foreground">{latest.label}</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="type-numeric flex items-center gap-3 text-4xl font-semibold tracking-tight @md/utilities:text-5xl">
            <span aria-hidden className="size-3 rounded-full bg-chart-4" />
            {formatNumber(latest.kl)}
            <span className="ml-1 text-xl font-medium text-muted-foreground @md/utilities:text-2xl">
              kl
            </span>
          </p>
          <p className="type-numeric flex items-center gap-3 text-2xl font-semibold tracking-tight @md/utilities:text-3xl">
            <span aria-hidden className="size-2.5 rounded-full bg-chart-2" />
            {formatMoney(latest.cost)}
          </p>
        </div>
        {latest.kl > 0 ? (
          <p className="type-caption">R{formatNumber(latest.cost / latest.kl, 2)} per kl</p>
        ) : null}
      </section>

      <div className="grid gap-x-8 gap-y-10 @3xl/utilities:grid-cols-2 [&>section]:min-w-0">
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
