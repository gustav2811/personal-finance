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

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
