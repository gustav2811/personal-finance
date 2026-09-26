import { localDateKey, shortDate } from "@/lib/format/date"
import type { TransactionFeedItem } from "@/lib/transactions"

export function relativeDay(occurredOn: string): string {
  const key = occurredOn.slice(0, 10)
  const today = localDateKey(new Date().toISOString())
  const yesterday = localDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  if (key === today) return "Today"
  if (key === yesterday) return "Yesterday"
  return shortDate(occurredOn.includes("T") ? occurredOn : `${key}T12:00:00`)
}

export function subject(item: TransactionFeedItem): string {
  return item.merchant.name || item.description
}

export function formatAmount(amount: string, currency: string): string {
  const value = Number(amount)
  if (!Number.isFinite(value)) return amount
  return new Intl.NumberFormat("en-ZA", {
    currency,
    style: "currency",
  }).format(value)
}

export function moneyDirection(amount: string): "in" | "out" {
  return Number(amount) < 0 ? "out" : "in"
}

export function needsReview(item: TransactionFeedItem): boolean {
  return (
    (item.category.state === "proposed" && item.category.id != null) ||
    item.reviewState === "classifier_failed" ||
    item.classifier.state === "failed"
  )
}

export function commandId(): string {
  return crypto.randomUUID()
}
