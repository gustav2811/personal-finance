export const HOUSEHOLD_TIMEZONE = "Africa/Johannesburg"

export function localDateKey(timestamp: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: HOUSEHOLD_TIMEZONE,
    year: "numeric",
  }).formatToParts(new Date(timestamp))
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function shortDate(timestamp: string | null): string {
  if (!timestamp) return "—"
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(timestamp))
}

export function formatNumber(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-ZA", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value)
}

export function formatMoney(value: number, digits = 0): string {
  return new Intl.NumberFormat("en-ZA", {
    currency: "ZAR",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    style: "currency",
  }).format(value)
}

export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return amount
  return new Intl.NumberFormat("en-ZA", {
    currency,
    currencyDisplay: "narrowSymbol",
    style: "currency",
  }).format(value)
}

export function parseIsoDate(value: string): Date | undefined {
  if (!value) return undefined
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
