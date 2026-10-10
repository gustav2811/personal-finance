const CENTS = /^-?(?:0|[1-9]\d*)$/

export function isCents(value: string): boolean {
  return CENTS.test(value)
}

export function parseCents(value: unknown): string | null {
  if (typeof value !== "string" || !isCents(value)) return null
  return value
}

export function compareCents(left: string, right: string): number {
  const a = BigInt(left)
  const b = BigInt(right)
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

export function isNegativeCents(cents: string): boolean {
  return cents.startsWith("-") && cents !== "-0"
}

export function isPositiveCents(cents: string): boolean {
  return isCents(cents) && !cents.startsWith("-") && cents !== "0"
}

function grouped(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
}

export function centsToRandsInput(cents: string): string {
  if (!isCents(cents)) return cents
  const negative = isNegativeCents(cents)
  const digits = negative ? cents.slice(1) : cents
  const padded = digits.padStart(3, "0")
  const whole = padded.slice(0, -2).replace(/^0+(?=\d)/, "") || "0"
  const frac = padded.slice(-2)
  return negative ? `-${whole}.${frac}` : `${whole}.${frac}`
}

export function formatCents(cents: string | null): string {
  if (cents === null || !isCents(cents)) return "—"
  const negative = isNegativeCents(cents)
  const digits = negative ? cents.slice(1) : cents
  const padded = digits.padStart(3, "0")
  const whole = grouped(padded.slice(0, -2).replace(/^0+(?=\d)/, ""))
  const frac = padded.slice(-2)
  const body = frac === "00" ? `${whole}` : `${whole},${frac}`
  return negative ? `-R${body}` : `R${body}`
}
