import { toKwh } from "@/domain/consumption/model"
import { HOUSEHOLD_TIMEZONE, localDateKey } from "@/lib/format/date"
import type { HistoryWindow } from "@/lib/range"
import type { DeviceRead, LedgerRead, ReadingRead } from "@/lib/supabase/rows"

export const HOME_TARGET = "whole_home"

// Below this relative jump a rate change is rounding noise, not a tariff step.
const RATE_STEP_TOLERANCE = 1.005

export function incurredKey(entry: LedgerRead): string | null {
  const timestamp = entry.occurred_at ?? entry.posted_at
  return timestamp ? localDateKey(timestamp) : null
}

export function monthKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

export function shiftMonth(key: string, delta: number): string {
  const [year, month] = key.split("-").map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`
}

export function daysInMonth(key: string): number {
  const [year, month] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function monthLabel(key: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
    year: "2-digit",
  }).format(new Date(`${key}-01T12:00:00Z`))
}

export function historyMonths(
  earliest: string | null,
  current: string,
  window: HistoryWindow,
): string[] {
  if (!earliest) return []
  const wanted = window === "all" ? earliest : shiftMonth(current, -(window - 1))
  const start = wanted > earliest ? wanted : earliest
  const months: string[] = []
  for (let key = start; key <= current; key = shiftMonth(key, 1)) months.push(key)
  return months
}

export type DayTotals = {
  kwh: number
  rand: number
  quantity: number
  deposits: number
  fees: number
}

function emptyDay(): DayTotals {
  return { kwh: 0, rand: 0, quantity: 0, deposits: 0, fees: 0 }
}

function isElectricityUsage(entry: LedgerRead): boolean {
  return (
    entry.utility_type === "electricity" &&
    entry.entry_type === "usage_charge" &&
    entry.direction === "debit"
  )
}

export function buildDays(
  readings: ReadingRead[],
  ledgerEntries: LedgerRead[],
): Map<string, DayTotals> {
  const days = new Map<string, DayTotals>()
  const day = (key: string) => {
    const existing = days.get(key)
    if (existing) return existing
    const created = emptyDay()
    days.set(key, created)
    return created
  }

  for (const reading of readings) {
    if (reading.measurement_target !== HOME_TARGET) continue
    const kwh = toKwh(reading)
    if (kwh === null) continue
    day(localDateKey(reading.period_start)).kwh += kwh
  }

  for (const entry of ledgerEntries) {
    const key = incurredKey(entry)
    if (!key) continue
    if (isElectricityUsage(entry)) {
      const totals = day(key)
      totals.rand += entry.amount
      totals.quantity += entry.quantity ?? 0
    } else if (
      entry.utility_type === "wallet" &&
      entry.entry_type === "deposit" &&
      entry.direction === "credit"
    ) {
      day(key).deposits += entry.amount
    } else if (
      entry.utility_type === "wallet" &&
      entry.entry_type === "fee" &&
      entry.direction === "debit"
    ) {
      day(key).fees += entry.amount
    }
  }

  return days
}

export type MtdPoint = {
  day: number
  kwh: number | null
  rand: number | null
  lastKwh: number | null
  lastRand: number | null
  deposits: number | null
  fees: number | null
}

export type MtdSummary = {
  kwh: number
  rand: number
  rate: number | null
  lastClosedKey: string
  lastClosedDay: number
  lastMonthSameKwh: number
  paceDelta: number | null
  projectedKwh: number
  projectedRand: number | null
  highestDay: { key: string; kwh: number }
}

export type Mtd = { points: MtdPoint[]; summary: MtdSummary | null }

function positive(value: number): number | null {
  return value > 0 ? value : null
}

function latestElectricityRate(ledgerEntries: LedgerRead[]): number | null {
  let latest: { key: string; rate: number } | null = null
  for (const entry of ledgerEntries) {
    const key = incurredKey(entry)
    if (!key || !isElectricityUsage(entry) || entry.rate === null) continue
    if (!latest || key >= latest.key) latest = { key, rate: entry.rate }
  }
  return latest?.rate ?? null
}

export function buildMtd(
  days: Map<string, DayTotals>,
  ledgerEntries: LedgerRead[],
  currentMonth: string,
): Mtd {
  const previousMonth = shiftMonth(currentMonth, -1)
  const span = Math.max(daysInMonth(currentMonth), daysInMonth(previousMonth))
  const dayKey = (month: string, day: number) => `${month}-${String(day).padStart(2, "0")}`

  let lastClosedDay = 0
  for (let day = 1; day <= daysInMonth(currentMonth); day += 1) {
    if ((days.get(dayKey(currentMonth, day))?.kwh ?? 0) > 0) lastClosedDay = day
  }

  const points: MtdPoint[] = []
  for (let day = 1; day <= span; day += 1) {
    const current = day <= daysInMonth(currentMonth) ? days.get(dayKey(currentMonth, day)) : undefined
    const previous = day <= daysInMonth(previousMonth) ? days.get(dayKey(previousMonth, day)) : undefined
    const closed = day <= lastClosedDay
    points.push({
      day,
      deposits: current ? positive(current.deposits) : null,
      fees: current ? positive(current.fees) : null,
      kwh: closed && current ? current.kwh : null,
      lastKwh: previous ? previous.kwh : null,
      lastRand: previous ? previous.rand : null,
      rand: closed && current ? current.rand : null,
    })
  }

  if (lastClosedDay === 0) return { points, summary: null }

  let kwh = 0
  let rand = 0
  let quantity = 0
  let lastMonthSameKwh = 0
  let highestDay = { key: "", kwh: 0 }
  for (let day = 1; day <= lastClosedDay; day += 1) {
    const key = dayKey(currentMonth, day)
    const totals = days.get(key)
    if (totals) {
      kwh += totals.kwh
      rand += totals.rand
      quantity += totals.quantity
      if (totals.kwh > highestDay.kwh) highestDay = { key, kwh: totals.kwh }
    }
    lastMonthSameKwh += days.get(dayKey(previousMonth, day))?.kwh ?? 0
  }

  const projectedKwh = (kwh / lastClosedDay) * daysInMonth(currentMonth)
  const latestRate = latestElectricityRate(ledgerEntries)

  return {
    points,
    summary: {
      highestDay,
      kwh,
      lastClosedDay,
      lastClosedKey: dayKey(currentMonth, lastClosedDay),
      lastMonthSameKwh,
      paceDelta: lastMonthSameKwh > 0 ? (kwh - lastMonthSameKwh) / lastMonthSameKwh : null,
      projectedKwh,
      projectedRand: latestRate === null ? null : projectedKwh * latestRate,
      rand,
      rate: quantity > 0 ? rand / quantity : null,
    },
  }
}

export type MonthPoint = {
  month: string
  label: string
  kwh: number
  cost: number
}

export function buildMonths(days: Map<string, DayTotals>, months: string[]): MonthPoint[] {
  const totals = new Map<string, { kwh: number; cost: number }>()
  for (const [key, day] of days) {
    const month = monthKey(key)
    const entry = totals.get(month) ?? { kwh: 0, cost: 0 }
    entry.kwh += day.kwh
    entry.cost += day.rand
    totals.set(month, entry)
  }
  return months.map((month) => ({
    cost: totals.get(month)?.cost ?? 0,
    kwh: totals.get(month)?.kwh ?? 0,
    label: monthLabel(month),
    month,
  }))
}

export function earliestMonth(days: Map<string, DayTotals>): string | null {
  let earliest: string | null = null
  for (const [key, day] of days) {
    if (day.kwh <= 0 && day.rand <= 0) continue
    const month = monthKey(key)
    if (!earliest || month < earliest) earliest = month
  }
  return earliest
}

export type RateStep = { month: string; label: string; rate: number }

// A month's base rate is its lowest charged rate, so a mid-month climb into a higher
// consumption block is not mistaken for a tariff increase.
export function buildRateSteps(ledgerEntries: LedgerRead[], months: string[]): RateStep[] {
  const baseRates = new Map<string, number>()
  for (const entry of ledgerEntries) {
    const key = incurredKey(entry)
    if (!key || !isElectricityUsage(entry) || entry.rate === null || entry.rate <= 0) continue
    const month = monthKey(key)
    const existing = baseRates.get(month)
    if (existing === undefined || entry.rate < existing) baseRates.set(month, entry.rate)
  }

  const steps: RateStep[] = []
  let previous: number | null = null
  for (const month of [...baseRates.keys()].sort()) {
    const rate = baseRates.get(month) as number
    if (previous !== null && rate > previous * RATE_STEP_TOLERANCE) {
      steps.push({ label: monthLabel(month), month, rate })
    }
    previous = rate
  }
  return steps.filter((step) => months.includes(step.month))
}

export type DeviceSeries = { key: string; name: string; target: string }

export type DeviceSharePoint = { label: string; month: string } & Record<string, number | string>

export const REST_KEY = "rest"

export type DeviceGap = { name: string; label: string; days: number; of: number }

export type DeviceShare = {
  series: DeviceSeries[]
  points: DeviceSharePoint[]
  gaps: DeviceGap[]
}

export function buildDeviceShare(
  readings: ReadingRead[],
  devices: DeviceRead[],
  months: string[],
): DeviceShare {
  const deviceNames = new Map(devices.map((device) => [device.id, device.name]))
  const targetNames = new Map<string, string>()
  const perMonth = new Map<string, Map<string, number>>()
  const homePerMonth = new Map<string, number>()
  const homeDays = new Map<string, Set<string>>()
  const deviceDays = new Map<string, Set<string>>()
  const addDay = (index: Map<string, Set<string>>, key: string, day: string) => {
    const days = index.get(key) ?? new Set<string>()
    days.add(day)
    index.set(key, days)
  }

  for (const reading of readings) {
    const kwh = toKwh(reading)
    if (kwh === null) continue
    const dateKey = localDateKey(reading.period_start)
    const month = monthKey(dateKey)
    if (reading.measurement_target === HOME_TARGET) {
      homePerMonth.set(month, (homePerMonth.get(month) ?? 0) + kwh)
      addDay(homeDays, month, dateKey)
      continue
    }
    addDay(deviceDays, `${reading.measurement_target}|${month}`, dateKey)
    const name = reading.device_id ? deviceNames.get(reading.device_id) : undefined
    targetNames.set(reading.measurement_target, name ?? reading.measurement_target)
    const byTarget = perMonth.get(month) ?? new Map<string, number>()
    byTarget.set(
      reading.measurement_target,
      (byTarget.get(reading.measurement_target) ?? 0) + kwh,
    )
    perMonth.set(month, byTarget)
  }

  const series: DeviceSeries[] = [...targetNames.entries()]
    .sort(([, first], [, second]) => first.localeCompare(second))
    .map(([target, name], index) => ({ key: `device${index}`, name, target }))

  const points = months.map((month) => {
    const byTarget = perMonth.get(month)
    const deviceKwh = series.map((entry) => byTarget?.get(entry.target) ?? 0)
    const home = homePerMonth.get(month) ?? 0
    const rest = Math.max(home - deviceKwh.reduce((total, value) => total + value, 0), 0)
    const total = deviceKwh.reduce((sum, value) => sum + value, rest)
    const point: DeviceSharePoint = { label: monthLabel(month), month, [REST_KEY]: 0 }
    series.forEach((entry, index) => {
      point[entry.key] = total > 0 ? (deviceKwh[index] / total) * 100 : 0
    })
    point[REST_KEY] = total > 0 ? (rest / total) * 100 : 0
    return point
  })

  // A device that reported on fewer days than the meter understates its share that month.
  const gaps: DeviceGap[] = []
  for (const month of months) {
    for (const entry of series) {
      const days = deviceDays.get(`${entry.target}|${month}`)?.size ?? 0
      const of = homeDays.get(month)?.size ?? 0
      if (days > 0 && days < of) gaps.push({ days, label: monthLabel(month), name: entry.name, of })
    }
  }

  return { gaps, points, series }
}

export type WeekdayPoint = { label: string; kwh: number | null; weekend: boolean }

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

export function buildWeekdays(days: Map<string, DayTotals>, month: string): WeekdayPoint[] {
  const sums = WEEKDAYS.map(() => ({ count: 0, kwh: 0 }))
  for (const [key, day] of days) {
    if (monthKey(key) !== month || day.kwh <= 0) continue
    // The key is already a Johannesburg calendar date, so read its weekday in UTC.
    const index = (new Date(`${key}T00:00:00Z`).getUTCDay() + 6) % 7
    sums[index].count += 1
    sums[index].kwh += day.kwh
  }
  return WEEKDAYS.map((label, index) => ({
    kwh: sums[index].count > 0 ? sums[index].kwh / sums[index].count : null,
    label,
    weekend: index >= 5,
  }))
}
