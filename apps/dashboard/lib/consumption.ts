import { localDateKey } from "./format/date"
import type { DeviceRow, LedgerRow, ReadingRow } from "./supabase/database.types"

export type RangeDays = 30 | 90 | 365

export const RANGE_ITEMS: Array<{ days: RangeDays; label: string }> = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
]

export type ChartPoint = {
  date: string
  label: string
  homeKwh: number
  espressoKwh: number
}

export type MoneyPoint = {
  month: string
  label: string
  debits: number
  credits: number
}

export function isWithinRange(timestamp: string | null, days: RangeDays): boolean {
  if (!timestamp) return false
  return new Date(timestamp).getTime() >= Date.now() - days * 24 * 60 * 60 * 1000
}

export function toKwh(reading: Pick<ReadingRow, "metric" | "unit" | "value">): number | null {
  if (reading.metric !== "energy") return null
  if (reading.unit.toLowerCase() === "wh") return reading.value / 1000
  if (reading.unit.toLowerCase() === "kwh") return reading.value
  return null
}

export function buildEnergySeries(readings: ReadingRow[], days: RangeDays): ChartPoint[] {
  const byDate = new Map<string, { homeKwh: number; espressoKwh: number }>()

  for (const reading of readings) {
    const value = toKwh(reading)
    if (value === null || !isWithinRange(reading.period_start, days)) continue
    const date = localDateKey(reading.period_start)
    const point = byDate.get(date) ?? { homeKwh: 0, espressoKwh: 0 }
    if (reading.measurement_target === "whole_home") point.homeKwh += value
    if (reading.measurement_target === "lelit-bianca") point.espressoKwh += value
    byDate.set(date, point)
  }

  return [...byDate.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([date, values]) => ({
      date,
      label: new Intl.DateTimeFormat("en-ZA", {
        day: "2-digit",
        month: "short",
        timeZone: "Africa/Johannesburg",
      }).format(new Date(`${date}T12:00:00+02:00`)),
      ...values,
    }))
}

export function buildMoneySeries(entries: LedgerRow[], days: RangeDays): MoneyPoint[] {
  const byMonth = new Map<string, { debits: number; credits: number }>()

  for (const entry of entries) {
    const timestamp = entry.occurred_at ?? entry.posted_at
    if (!isWithinRange(timestamp, days)) continue
    const month = localDateKey(timestamp as string).slice(0, 7)
    const point = byMonth.get(month) ?? { debits: 0, credits: 0 }
    if (entry.direction === "debit") point.debits += entry.amount
    if (entry.direction === "credit") point.credits += entry.amount
    byMonth.set(month, point)
  }

  return [...byMonth.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([month, values]) => ({
      month,
      label: new Intl.DateTimeFormat("en-ZA", {
        month: "short",
        year: "2-digit",
        timeZone: "Africa/Johannesburg",
      }).format(new Date(`${month}-01T00:00:00Z`)),
      ...values,
    }))
}

export function latestTimestampForDevice(
  device: DeviceRow,
  readings: ReadingRow[],
): string | null {
  return (
    readings
      .filter((reading) => reading.device_id === device.id)
      .map((reading) => reading.period_end)
      .sort((first, second) => second.localeCompare(first))[0] ?? null
  )
}

export function sourceKind(device: DeviceRow): string {
  if (device.utility_type === "wallet") return "Wallet"
  if (device.utility_type === "water") return "Invoice"
  if (device.kind === "smart_plug") return "Smart plug"
  return "Meter"
}
