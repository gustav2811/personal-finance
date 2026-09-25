"use client"

import { useMemo, useState } from "react"
import { PageHeader } from "@/components/app/page-header"
import { RangeControl } from "@/components/app/range-control"
import { DataGate } from "@/components/household/data-gate"
import { EnergyChart, MoneyChart } from "@/components/household/charts"
import { Section } from "@/components/app/section"
import { SourceList } from "@/components/sources/source-list"
import { formatMoney, formatNumber, shortDate, sum } from "@/lib/format"
import {
  buildEnergySeries,
  buildMoneySeries,
  isWithinRange,
  type RangeDays,
} from "@/lib/household"
import type { ConsumptionLedgerEntry, DashboardData } from "@/lib/data"

function rangeLabel(days: RangeDays): string {
  if (days === 365) return "Last year"
  return `Last ${days} days`
}

function OverviewBody({ data, days }: { data: DashboardData; days: RangeDays }) {
  const series = useMemo(
    () => buildEnergySeries(data.readings, days),
    [data.readings, days],
  )
  const moneySeries = useMemo(
    () => buildMoneySeries(data.ledgerEntries, days),
    [data.ledgerEntries, days],
  )
  const homeTotal = sum(series.map((point) => point.homeKwh))
  const espressoTotal = sum(series.map((point) => point.espressoKwh))
  const electricityEntries = data.ledgerEntries.filter(
    (entry) =>
      entry.utility_type === "electricity" &&
      entry.direction === "debit" &&
      isWithinRange(entry.occurred_at ?? entry.posted_at, days),
  )
  const electricityCost = sum(electricityEntries.map((entry) => entry.amount))
  const knownQuantity = sum(
    electricityEntries.map((entry) => entry.quantity ?? 0).filter((quantity) => quantity > 0),
  )
  const weightedRate = knownQuantity > 0 ? electricityCost / knownQuantity : null
  const latestSnapshot = [...data.financialSnapshots].sort((first, second) =>
    second.date.localeCompare(first.date),
  )[0]
  const largestDay = series.reduce<(typeof series)[number] | null>(
    (largest, point) => (!largest || point.homeKwh > largest.homeKwh ? point : largest),
    null,
  )
  const walletTotal = sum(
    data.ledgerEntries
      .filter(
        (entry) =>
          entry.utility_type === "wallet" &&
          entry.direction === "debit" &&
          isWithinRange(entry.occurred_at ?? entry.posted_at, days),
      )
      .map((entry) => entry.amount),
  )
  const waterEntry = latestWater(data.ledgerEntries, days)

  return (
    <div className="space-y-6">
      <dl className="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          detail={`${series.length} days with whole-home readings`}
          label="Whole-home energy"
          value={`${formatNumber(homeTotal)} kWh`}
        />
        <Metric
          detail={`${formatNumber(espressoTotal)} kWh in range`}
          label="Espresso share"
          value={`${homeTotal > 0 ? formatNumber((espressoTotal / homeTotal) * 100) : "0.0"}%`}
        />
        <Metric
          detail={weightedRate ? "Weighted from electricity charges" : "Rate not available"}
          label="Effective rate"
          value={weightedRate ? `R${formatNumber(weightedRate, 2)}` : "—"}
        />
        <Metric
          detail={
            latestSnapshot ? `As at ${shortDate(latestSnapshot.date)}` : "From wallet ledger"
          }
          label="Energy cost"
          value={electricityCost ? formatMoney(electricityCost) : "—"}
        />
      </dl>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,0.8fr)]">
        <Section
          description={`Native readings, aligned by local household date. ${rangeLabel(days)}.`}
          title="Energy"
        >
          <EnergyChart series={series} />
        </Section>
        <Section description="Facts worth following in this window." title="What moved">
          <div className="space-y-4">
            <Fact
              label="Highest home day"
              value={largestDay ? `${formatNumber(largestDay.homeKwh)} kWh` : "—"}
              detail={largestDay ? largestDay.label : "Waiting for a whole-home series."}
            />
            <Fact
              label="Espresso share"
              value={`${formatNumber(homeTotal > 0 ? (espressoTotal / homeTotal) * 100 : 0)}%`}
              detail="Bianca's share of measured whole-home energy."
            />
            <Fact
              label="Wallet charges"
              value={formatMoney(walletTotal)}
              detail="Fees and wallet-level movement."
            />
            <Fact
              label="Water invoice"
              value={waterEntry ? formatMoney(waterEntry.amount) : "—"}
              detail={
                waterEntry
                  ? shortDate(waterEntry.occurred_at)
                  : "Water is a monthly charge, not a meter reading."
              }
            />
          </div>
        </Section>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          description="Debit and credit movement from the utility wallet."
          title="Money in motion"
        >
          <MoneyChart series={moneySeries} />
        </Section>
        <Section description={`${data.devices.length} connected`} title="Sources">
          <SourceList devices={data.devices} readings={data.readings} />
        </Section>
      </div>
    </div>
  )
}

function latestWater(entries: ConsumptionLedgerEntry[], days: RangeDays) {
  return entries
    .filter(
      (entry) =>
        entry.utility_type === "water" &&
        entry.direction === "debit" &&
        isWithinRange(entry.occurred_at ?? entry.posted_at, days),
    )
    .sort((first, second) =>
      (second.occurred_at ?? "").localeCompare(first.occurred_at ?? ""),
    )[0]
}

function Metric({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: string
}) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="type-numeric mt-1 text-2xl font-semibold tracking-tight">{value}</dd>
      <p className="type-caption mt-1">{detail}</p>
    </div>
  )
}

function Fact({
  detail,
  label,
  value,
}: {
  detail: string
  label: string
  value: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
      <div>
        <p className="type-label">{label}</p>
        <p className="type-caption">{detail}</p>
      </div>
      <p className="type-numeric text-sm font-medium">{value}</p>
    </div>
  )
}

export function OverviewView() {
  const [days, setDays] = useState<RangeDays>(90)

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<RangeControl onChange={setDays} value={days} />}
        description="Energy, money, and the signals that explain how the household moved."
        title="Overview"
      />
      <DataGate>{(data) => <OverviewBody data={data} days={days} />}</DataGate>
    </div>
  )
}
