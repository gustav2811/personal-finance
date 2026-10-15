"use client"

import { useMemo, useState } from "react"
import { FactGrid } from "@/components/patterns/fact-grid"
import { Section } from "@/components/patterns/section"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { DeviceLineChart } from "@/domain/consumption/device-line-chart"
import { DeviceShareChart } from "@/domain/consumption/device-share-chart"
import {
  buildDays,
  buildDeviceDaily,
  buildDeviceOptions,
  buildDeviceShare,
  buildMonths,
  buildMtd,
  buildRateSteps,
  buildWalletFees,
  buildWeekdays,
  earliestMonth,
  HOME_TARGET,
  historyMonths,
  monthKey,
  type MtdPoint,
} from "@/domain/consumption/energy-model"
import { MonthBars } from "@/domain/consumption/month-bars"
import { MtdChart, type MtdMetric } from "@/domain/consumption/mtd-chart"
import { WalletFeesChart } from "@/domain/consumption/wallet-fees-chart"
import { WeekdayChart } from "@/domain/consumption/weekday-chart"
import type { EnergyData } from "@/features/utilities/queries"
import { localDateKey, shortDate } from "@/lib/format/date"
import type { HistoryWindow } from "@/lib/range"
import { formatMoney, formatNumber } from "@/lib/format/money"

type Layer = "last" | "payments" | "fees" | "rates"

const LAYERS: Array<{ dot: string; label: string; value: Layer }> = [
  { dot: "bg-muted-foreground", label: "Last month", value: "last" },
  { dot: "bg-success", label: "Payments", value: "payments" },
  { dot: "bg-warning", label: "Wallet fees", value: "fees" },
  { dot: "bg-info", label: "Rate changes", value: "rates" },
]

const TOUCH_ITEM = "pointer-coarse:h-9 pointer-coarse:px-3"

function isLayer(value: string): value is Layer {
  return LAYERS.some((layer) => layer.value === value)
}

export function EnergyPanel({
  data,
  window,
  period,
}: {
  data: EnergyData
  window: HistoryWindow
  period?: { from: string; to: string }
}) {
  const currentMonth = monthKey(localDateKey(data.fetchedAt))
  const [metric, setMetric] = useState<MtdMetric>("kwh")
  const [layers, setLayers] = useState<Layer[]>(["last", "rates"])
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [target, setTarget] = useState(HOME_TARGET)

  const days = useMemo(
    () => buildDays(data.readings, data.ledgerEntries),
    [data.readings, data.ledgerEntries],
  )
  const mtd = useMemo(
    () => buildMtd(days, data.ledgerEntries, currentMonth),
    [days, data.ledgerEntries, currentMonth],
  )
  const months = useMemo(
    () => historyMonths(earliestMonth(days), currentMonth, window),
    [days, currentMonth, window],
  )
  const monthly = useMemo(() => buildMonths(days, months), [days, months])
  const rateSteps = useMemo(
    () => buildRateSteps(data.ledgerEntries, months),
    [data.ledgerEntries, months],
  )
  const share = useMemo(
    () => buildDeviceShare(data.readings, data.devices, months),
    [data.readings, data.devices, months],
  )
  const deviceOptions = useMemo(
    () => buildDeviceOptions(data.readings, data.devices),
    [data.readings, data.devices],
  )
  const deviceDaily = useMemo(
    () => buildDeviceDaily(data.readings, target, currentMonth),
    [data.readings, target, currentMonth],
  )
  const walletFees = useMemo(
    () => buildWalletFees(data.ledgerEntries, currentMonth),
    [data.ledgerEntries, currentMonth],
  )
  const weekdays = useMemo(
    () => buildWeekdays(days, currentMonth),
    [days, currentMonth],
  )
  const periodData = useMemo(
    () =>
      period
        ? buildPeriod(
            days,
            period.from,
            period.to,
            localDateKey(data.fetchedAt),
          )
        : null,
    [data.fetchedAt, days, period],
  )

  const summary = mtd.summary
  const markers = layers.includes("rates")
    ? rateSteps.map((step) => ({
        label: step.label,
        text: `R${formatNumber(step.rate, 2)}/kWh`,
      }))
    : []

  return (
    <div className="space-y-10">
      {periodData ? (
        <PeriodSection period={periodData} />
      ) : (
        <section aria-label="This month" className="space-y-4">
          <div className="space-y-1">
            <p className="type-label text-muted-foreground">This month</p>
            {summary ? (
              <>
                <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                  <p className="type-numeric flex items-center gap-3 text-4xl font-semibold tracking-tight @md/utilities:text-5xl">
                    <span
                      aria-hidden
                      className="size-3 rounded-full bg-chart-1"
                    />
                    {formatNumber(summary.kwh)}
                    <span className="ml-1 text-xl font-medium text-muted-foreground @md/utilities:text-2xl">
                      kWh
                    </span>
                  </p>
                  <p className="type-numeric flex items-center gap-3 text-2xl font-semibold tracking-tight @md/utilities:text-3xl">
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full bg-chart-2"
                    />
                    {formatMoney(summary.rand)}
                  </p>
                </div>
                <p className="type-caption">
                  To {shortDate(`${summary.lastClosedKey}T12:00:00+02:00`)}
                  {summary.rate !== null
                    ? ` · R${formatNumber(summary.rate, 2)} per kWh`
                    : ""}
                  {summary.paceDelta !== null
                    ? ` · ${summary.paceDelta >= 0 ? "+" : ""}${formatNumber(summary.paceDelta * 100)}% vs last month`
                    : ""}
                </p>
              </>
            ) : (
              <p className="type-body text-muted-foreground">
                No closed days yet.
              </p>
            )}
          </div>

          {summary ? (
            <FactGrid compact items={[
              { label: "Projected month end", value: `${formatNumber(summary.projectedKwh, 0)} kWh`, detail: summary.projectedRand === null ? undefined : formatMoney(summary.projectedRand) },
              { label: "Highest day", value: `${formatNumber(summary.highestDay.kwh)} kWh`, detail: shortDate(`${summary.highestDay.key}T12:00:00+02:00`) },
              { label: "Daily average", value: `${formatNumber(summary.kwh / summary.lastClosedDay)} kWh` },
            ]} />
          ) : null}
        </section>
      )}

      {periodData ? (
        <Section title="Budget period to date">
          <MtdChart
            metric="rand"
            points={periodData.points}
            showDeposits={false}
            showFees={false}
            showLast={false}
          />
        </Section>
      ) : (
        <Section
          actions={
            <>
              <ToggleGroup
                aria-label="Chart layers"
                className="flex-wrap"
                onValueChange={(next) => setLayers(next.filter(isLayer))}
                size="sm"
                spacing={1}
                type="multiple"
                value={layers}
                variant="outline"
              >
                {LAYERS.map((layer) => (
                  <ToggleGroupItem
                    className={TOUCH_ITEM}
                    key={layer.value}
                    value={layer.value}
                  >
                    <span
                      aria-hidden
                      className={`size-2 rounded-full ${layer.dot}`}
                    />
                    {layer.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <ToggleGroup
                aria-label="Month to date measure"
                onValueChange={(next) => {
                  if (next === "kwh" || next === "rand") setMetric(next)
                }}
                size="sm"
                spacing={0}
                type="single"
                value={metric}
                variant="outline"
              >
                <ToggleGroupItem className={TOUCH_ITEM} value="kwh">
                  kWh
                </ToggleGroupItem>
                <ToggleGroupItem className={TOUCH_ITEM} value="rand">
                  Rand
                </ToggleGroupItem>
              </ToggleGroup>
            </>
          }
          title="Month to date"
        >
          <MtdChart
            metric={metric}
            points={mtd.points}
            showDeposits={layers.includes("payments")}
            showFees={layers.includes("fees")}
            showLast={layers.includes("last")}
          />
        </Section>
      )}

      <div className="grid gap-x-8 gap-y-10 @3xl/utilities:grid-cols-2 [&>section]:min-w-0">
        <Section title="Usage">
          <MonthBars
            bars={monthly.map((point) => ({
              label: point.label,
              month: point.month,
              value: point.kwh,
            }))}
            color="var(--chart-1)"
            emptyLabel="No electricity readings"
            format={(value) => `${formatNumber(value, 0)} kWh`}
            markers={markers}
            onSelect={setSelectedMonth}
            selected={selectedMonth}
          />
        </Section>

        <Section title="Cost">
          <MonthBars
            bars={monthly.map((point) => ({
              label: point.label,
              month: point.month,
              value: point.cost,
            }))}
            color="var(--chart-2)"
            emptyLabel="No electricity charges"
            format={(value) => formatMoney(value)}
            markers={markers}
            onSelect={setSelectedMonth}
            selected={selectedMonth}
          />
        </Section>

        <Section title="Devices">
          <DeviceShareChart share={share} />
          {share.gaps.slice(-2).map((gap) => (
            <p className="type-caption" key={`${gap.name}-${gap.label}`}>
              {gap.name}: {gap.days} of {gap.of} days in {gap.label}
            </p>
          ))}
        </Section>

        <Section
          actions={
            <Select onValueChange={setTarget} value={target}>
              <SelectTrigger
                aria-label="Device"
                className="w-48 pointer-coarse:h-9"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {deviceOptions.map((option) => (
                  <SelectItem key={option.target} value={option.target}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
          title="By device"
        >
          <DeviceLineChart points={deviceDaily} />
        </Section>

        <Section title="Wallet fees">
          <WalletFeesChart fees={walletFees} />
        </Section>

        <Section title="Weekdays">
          <WeekdayChart points={weekdays} />
        </Section>
      </div>
    </div>
  )
}

type PeriodData = {
  points: MtdPoint[]
  kwh: number
  rand: number
  from: string
  to: string
  lastClosedKey: string | null
}

function dayKeys(from: string, to: string) {
  const keys: string[] = []
  for (
    let cursor = new Date(`${from}T00:00:00Z`),
      end = new Date(`${to}T00:00:00Z`);
    cursor <= end;
    cursor = new Date(cursor.getTime() + 86400000)
  ) {
    keys.push(cursor.toISOString().slice(0, 10))
  }
  return keys
}

function buildPeriod(
  days: Map<
    string,
    {
      kwh: number
      rand: number
      quantity: number
      deposits: number
      fees: number
    }
  >,
  from: string,
  to: string,
  today: string,
): PeriodData {
  const keys = dayKeys(from, to).filter((key) => key < today)
  let kwh = 0
  let rand = 0
  let lastClosedKey: string | null = null
  const points: MtdPoint[] = []
  keys.forEach((key, index) => {
    const totals = days.get(key)
    kwh += totals?.kwh ?? 0
    rand += totals?.rand ?? 0
    const hasCharge = (totals?.rand ?? 0) > 0
    if (hasCharge) lastClosedKey = key
    points.push({
      day: index + 1,
      kwh: hasCharge ? kwh : null,
      rand: hasCharge ? rand : null,
      lastKwh: null,
      lastRand: null,
      deposits: null,
      fees: null,
    })
  })
  return { from, kwh, lastClosedKey, points, rand, to }
}

function PeriodSection({ period }: { period: PeriodData }) {
  return (
    <section aria-label="Budget period" className="space-y-4">
      <div className="space-y-1">
        <p className="type-label text-muted-foreground">Budget period</p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="type-numeric flex items-center gap-3 text-4xl font-semibold tracking-tight @md/utilities:text-5xl">
            <span aria-hidden className="size-3 rounded-full bg-chart-2" />
            {period.rand > 0 ? formatMoney(period.rand) : "—"}
          </p>
          <p className="type-numeric flex items-center gap-3 text-2xl font-semibold tracking-tight @md/utilities:text-3xl">
            <span aria-hidden className="size-2.5 rounded-full bg-chart-1" />
            {period.kwh > 0 ? `${formatNumber(period.kwh)} kWh` : "—"}
          </p>
        </div>
        <p className="type-caption">
          {shortDate(`${period.from}T12:00:00+02:00`)} –{" "}
          {shortDate(`${period.to}T12:00:00+02:00`)}
          {period.lastClosedKey
            ? ` · Usage charges incurred through ${shortDate(`${period.lastClosedKey}T12:00:00+02:00`)}`
            : " · No incurred usage charges in this period."}
        </p>
      </div>
    </section>
  )
}
