"use client"

import { useMemo, useState } from "react"
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

export function EnergyPanel({ data, window }: { data: EnergyData; window: HistoryWindow }) {
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
  const weekdays = useMemo(() => buildWeekdays(days, currentMonth), [days, currentMonth])

  const summary = mtd.summary
  const markers = layers.includes("rates")
    ? rateSteps.map((step) => ({
        label: step.label,
        text: `R${formatNumber(step.rate, 2)}/kWh`,
      }))
    : []

  return (
    <div className="space-y-10">
      <section aria-label="This month" className="space-y-4">
        <div className="space-y-1">
          <p className="type-label text-muted-foreground">This month</p>
          {summary ? (
            <>
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <p className="type-numeric flex items-center gap-3 text-4xl font-semibold tracking-tight @md/utilities:text-5xl">
                  <span aria-hidden className="size-3 rounded-full bg-chart-1" />
                  {formatNumber(summary.kwh)}
                  <span className="ml-1 text-xl font-medium text-muted-foreground @md/utilities:text-2xl">
                    kWh
                  </span>
                </p>
                <p className="type-numeric flex items-center gap-3 text-2xl font-semibold tracking-tight @md/utilities:text-3xl">
                  <span aria-hidden className="size-2.5 rounded-full bg-chart-2" />
                  {formatMoney(summary.rand)}
                </p>
              </div>
              <p className="type-caption">
                To {shortDate(`${summary.lastClosedKey}T12:00:00+02:00`)}
                {summary.rate !== null ? ` · R${formatNumber(summary.rate, 2)} per kWh` : ""}
                {summary.paceDelta !== null
                  ? ` · ${summary.paceDelta >= 0 ? "+" : ""}${formatNumber(summary.paceDelta * 100)}% vs last month`
                  : ""}
              </p>
            </>
          ) : (
            <p className="type-body text-muted-foreground">No closed days yet.</p>
          )}
        </div>

        {summary ? (
          <dl className="grid gap-px overflow-hidden rounded-lg border bg-border @xl/utilities:grid-cols-3">
            <Stat
              detail={summary.projectedRand === null ? undefined : formatMoney(summary.projectedRand)}
              label="Projected month end"
              value={`${formatNumber(summary.projectedKwh, 0)} kWh`}
            />
            <Stat
              detail={shortDate(`${summary.highestDay.key}T12:00:00+02:00`)}
              label="Highest day"
              value={`${formatNumber(summary.highestDay.kwh)} kWh`}
            />
            <Stat
              label="Daily average"
              value={`${formatNumber(summary.kwh / summary.lastClosedDay)} kWh`}
            />
          </dl>
        ) : null}
      </section>

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
                <ToggleGroupItem className={TOUCH_ITEM} key={layer.value} value={layer.value}>
                  <span aria-hidden className={`size-2 rounded-full ${layer.dot}`} />
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

      <div className="grid gap-x-8 gap-y-10 @3xl/utilities:grid-cols-2 [&>section]:min-w-0">
        <Section title="Usage">
          <MonthBars
            bars={monthly.map((point) => ({ label: point.label, month: point.month, value: point.kwh }))}
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
            bars={monthly.map((point) => ({ label: point.label, month: point.month, value: point.cost }))}
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
              <SelectTrigger aria-label="Device" className="w-48 pointer-coarse:h-9">
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

function Stat({ detail, label, value }: { detail?: string; label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 bg-card px-4 py-3 @xl/utilities:block">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="flex flex-col items-end text-right @xl/utilities:mt-1 @xl/utilities:items-start @xl/utilities:text-left">
        <span className="type-numeric text-lg font-semibold tracking-tight @xl/utilities:text-xl">
          {value}
        </span>
        {detail ? <span className="type-caption">{detail}</span> : null}
      </dd>
    </div>
  )
}
