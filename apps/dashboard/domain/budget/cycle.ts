import { HOUSEHOLD_TIMEZONE, localDateKey } from "../../lib/format/date"

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function assertIsoDate(value: string): string {
  const match = ISO_DATE.exec(value)
  if (!match) throw new Error("budget_invalid: date")
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("budget_invalid: date")
  }
  return value
}

export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = assertIsoDate(isoDate).split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1 + months, day))
  const text = date.toISOString().slice(0, 10)
  return assertIsoDate(text)
}

export function dayBefore(isoDate: string): string {
  const [year, month, day] = assertIsoDate(isoDate).split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day - 1))
  return date.toISOString().slice(0, 10)
}

export function cycleContaining(localDate: string): { start: string; endExclusive: string } {
  const [year, month, day] = assertIsoDate(localDate).split("-").map(Number) as [number, number, number]
  let startYear = year
  let startMonth = month
  if (day < 23) {
    startMonth -= 1
    if (startMonth === 0) {
      startMonth = 12
      startYear -= 1
    }
  }
  const start = assertIsoDate(
    `${String(startYear).padStart(4, "0")}-${String(startMonth).padStart(2, "0")}-23`,
  )
  return { start, endExclusive: addMonths(start, 1) }
}

export function currentCycle(now = new Date()): { start: string; endExclusive: string } {
  return cycleContaining(localDateKey(now.toISOString()))
}

export function formatDayMonth(isoDate: string): string {
  const [year, month, day] = assertIsoDate(isoDate).split("-").map(Number) as [number, number, number]
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function cycleLabel(start: string, endExclusive: string): string {
  return `${formatDayMonth(start)} – ${formatDayMonth(dayBefore(endExclusive))}`
}

export function calendarMonthKey(cycleStart: string): string {
  const lastDay = dayBefore(addMonths(cycleStart, 1))
  return lastDay.slice(0, 7)
}

export function calendarMonthLabel(cycleStart: string): string {
  const lastDay = dayBefore(addMonths(cycleStart, 1))
  const [year, month, day] = lastDay.split("-").map(Number) as [number, number, number]
  return new Intl.DateTimeFormat("en-ZA", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function formatAsOf(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return "unknown"
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(date)
}
