import type { TransactionFeedItem } from "@/lib/transactions"

export type DecisionNote = {
  accept: boolean
  text: string | null
  tone: "quiet" | "yours" | "proposal" | "source" | "failed"
}

export function subject(item: TransactionFeedItem): string {
  return item.merchant.name || item.description
}

export function words(value: string): string {
  return value.replaceAll("_", " ")
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

export function decisionNote(item: TransactionFeedItem): DecisionNote {
  if (item.category.state === "confirmed" && item.category.provenance === "user") {
    return { accept: false, text: "Yours", tone: "yours" }
  }
  if (item.category.state === "confirmed" && item.category.provenance === "policy") {
    return { accept: false, text: "Policy", tone: "yours" }
  }
  if (item.category.state === "confirmed") {
    return { accept: false, text: "Confirmed", tone: "quiet" }
  }
  if (item.reviewState === "jev_agrees") {
    return { accept: false, text: null, tone: "quiet" }
  }
  if (item.category.state === "proposed" && item.category.id) {
    return { accept: true, text: "JEV proposal", tone: "proposal" }
  }
  if (item.reviewState === "classifier_failed" || item.classifier.state === "failed") {
    return { accept: false, text: "Classifier failed", tone: "failed" }
  }
  if (item.reviewState === "classifier_abstained" || item.classifier.state === "abstained") {
    return { accept: false, text: "JEV abstained", tone: "failed" }
  }
  if (item.category.provenance === "source" && item.category.name) {
    return { accept: false, text: "FinWise", tone: "source" }
  }
  return { accept: false, text: null, tone: "quiet" }
}

export function accountLine(item: TransactionFeedItem): string {
  return [
    item.source.isPending ? "Pending" : null,
    item.account.name,
    item.treatment.isTransfer ? "Transfer" : null,
    item.treatment.excludeFromSpend ? "Excluded from spend" : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function noteClass(tone: DecisionNote["tone"]): string {
  if (tone === "yours") return "text-success"
  if (tone === "proposal") return "text-warning"
  if (tone === "failed") return "text-destructive"
  if (tone === "source") return "text-info"
  return "text-muted-foreground"
}

export function commandId(): string {
  return crypto.randomUUID()
}
