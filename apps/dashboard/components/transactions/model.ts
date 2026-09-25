import type { CategoryOption, TransactionDetail, TransactionFeedItem } from "@/lib/transactions"
import { HOUSEHOLD_TIMEZONE } from "@/lib/format"

export const RECENT_KEY = "ledger-recent-categories"

export type ReviewFilter = "all" | "needs_review" | TransactionFeedItem["reviewState"]

export const ADVANCED_REVIEWS: Array<{
  value: TransactionFeedItem["reviewState"]
  label: string
}> = [
  { value: "jev_disagrees", label: "Differs" },
  { value: "jev_proposed", label: "Proposal" },
  { value: "unclassified", label: "Uncategorised" },
  { value: "classifier_abstained", label: "Abstained" },
  { value: "classifier_failed", label: "Failed" },
  { value: "awaiting_classifier", label: "Awaiting" },
  { value: "jev_agrees", label: "Agrees" },
  { value: "confirmed", label: "Confirmed" },
]

export type UndoOffer = {
  categoryId: string | null
  expectedConfirmedClassificationId: string | null
}

export type RowOverlay = {
  item: TransactionFeedItem
  pending: boolean
  error: string | null
  undo: UndoOffer | null
}

export type DecisionNote = {
  text: string | null
  tone: "yours" | "proposal" | "source" | "failed" | "quiet"
  accept: boolean
}

export type StoryBeat = {
  label: string
  title: string
  meta: string | null
}

const TONE_CLASS: Record<DecisionNote["tone"], string> = {
  failed: "text-state-failed",
  proposal: "text-state-proposed",
  quiet: "text-muted-foreground",
  source: "text-state-source",
  yours: "text-state-confirmed",
}

export function toneClass(tone: DecisionNote["tone"]): string {
  return TONE_CLASS[tone]
}

export function commandId(): string {
  return crypto.randomUUID()
}

export function formatDay(occurredOn: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(`${occurredOn}T12:00:00+02:00`))
}

export function gutterParts(occurredOn: string): { day: string; month: string } {
  const date = new Date(`${occurredOn}T12:00:00+02:00`)
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(date)
  const month = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  })
    .format(date)
    .replace(".", "")
  return { day, month }
}

export function formatWhen(value: string | null): string {
  if (!value) return "Not yet"
  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: HOUSEHOLD_TIMEZONE,
  }).format(new Date(value))
}

export function percent(value: number | null): string | null {
  if (value == null || !Number.isFinite(Number(value))) return null
  return `${Math.round(Number(value) * 100)}%`
}

export function subject(item: TransactionFeedItem): string {
  return item.merchant.name || item.description
}

export function words(value: string): string {
  return value.replaceAll("_", " ")
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
    return {
      accept: true,
      text: item.reviewState === "jev_disagrees" ? "Differs from FinWise" : "JEV proposal",
      tone: "proposal",
    }
  }
  if (item.reviewState === "classifier_failed" || item.classifier.state === "failed") {
    return { accept: false, text: "Classifier failed", tone: "failed" }
  }
  if (
    item.reviewState === "classifier_abstained" ||
    item.classifier.state === "abstained"
  ) {
    return { accept: false, text: "JEV abstained", tone: "failed" }
  }
  if (item.category.provenance === "source" && item.category.name) {
    return { accept: false, text: "FinWise", tone: "source" }
  }
  return { accept: false, text: null, tone: "quiet" }
}

export function applyCategory(
  item: TransactionFeedItem,
  category: CategoryOption,
): TransactionFeedItem {
  return {
    ...item,
    category: {
      confidence: null,
      id: category.id,
      name: category.name,
      proposalDiffersFromSource: false,
      provenance: "user",
      state: "confirmed",
    },
    reviewState: "confirmed",
  }
}

export function readRecent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : []
  } catch {
    return []
  }
}

export function rememberCategory(id: string) {
  const next = [id, ...readRecent().filter((entry) => entry !== id)].slice(0, 6)
  localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

export function focusCategory(id: string) {
  window.setTimeout(() => {
    document
      .querySelector<HTMLButtonElement>(`[data-category-for="${CSS.escape(id)}"]`)
      ?.focus()
  }, 0)
}

export function accountLine(item: TransactionFeedItem): string {
  const parts = [
    item.source.isPending ? "Pending" : null,
    item.account.name,
    item.treatment.isTransfer ? "Transfer" : null,
    item.treatment.excludeFromSpend ? "Excluded from spend" : null,
  ]
  return parts.filter(Boolean).join(" · ")
}

export function classifierSummary(item: TransactionFeedItem): string {
  if (item.classifier.state === "not_run") return "Not run"
  if (item.classifier.state === "failed") return "Failed"
  const confidence = percent(item.classifier.confidence)
  const margin = percent(item.classifier.margin)
  const parts = [
    item.classifier.state === "abstained" ? "Abstained" : "Ran",
    item.classifier.classifierVersion ? `v${item.classifier.classifierVersion}` : null,
    item.classifier.modelId,
    confidence ? `${confidence} confidence` : null,
    margin ? `${margin} margin` : null,
    item.classifier.accepted == null
      ? null
      : item.classifier.accepted
        ? "accepted its result"
        : "did not accept its result",
  ]
  return parts.filter(Boolean).join(" · ")
}

export function storyBeats(
  item: TransactionFeedItem,
  detail: TransactionDetail | undefined,
): StoryBeat[] {
  const beats: StoryBeat[] = [
    {
      label: "FinWise observed",
      meta: item.source.isTransfer ? "Marked as a transfer" : null,
      title: item.source.categoryName ?? "No category",
    },
  ]
  if (!detail) {
    if (item.category.state === "proposed" && item.category.name) {
      beats.push({
        label: "JEV proposed",
        meta:
          item.reviewState === "jev_agrees"
            ? "Agrees with FinWise"
            : percent(item.category.confidence),
        title: item.category.name,
      })
    } else if (item.category.state === "confirmed" && item.category.name) {
      beats.push({
        label: item.category.provenance === "user" ? "You classified" : "Confirmed",
        meta: null,
        title: item.category.name,
      })
    }
    return beats
  }

  for (const entry of [...detail.history.classifications].reverse()) {
    if (entry.decisionSource === "jev" || entry.decisionSource === "agent") {
      beats.push({
        label: entry.decisionSource === "agent" ? "Agent proposed" : "JEV proposed",
        meta:
          [entry.status === "proposed" ? null : words(entry.status), percent(entry.confidence)]
            .filter(Boolean)
            .join(" · ") || null,
        title: entry.categoryName,
      })
    } else if (entry.decisionSource === "user") {
      beats.push({
        label: "You classified",
        meta: entry.status === "superseded" ? "Superseded" : null,
        title: entry.categoryName,
      })
    } else if (
      entry.decisionSource === "policy" ||
      entry.decisionSource === "imported" ||
      entry.decisionSource === "rule"
    ) {
      beats.push({
        label: "Policy",
        meta: null,
        title: entry.categoryName,
      })
    }
  }
  return beats
}
