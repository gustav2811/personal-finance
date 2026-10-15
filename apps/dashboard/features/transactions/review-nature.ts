import type { TransactionFeedItem } from "./model"

/** An inferred treatment label must not survive a correction to its inputs. */
export function reviewNature(
  item: Pick<TransactionFeedItem, "category" | "treatment" | "event">,
  draft: { categoryId: string | null; isTransfer: boolean | null; excludeFromSpend: boolean | null },
): string | null {
  const nature = item.treatment.nature
  if (item.event) return nature
  if (draft.isTransfer !== item.treatment.isTransfer || draft.excludeFromSpend !== item.treatment.excludeFromSpend) return null
  if (draft.categoryId !== item.category.id && item.treatment.provenance !== "user") return null
  // Earlier reviews could confirm the classifier's stale label alongside ordinary spending.
  if (nature === "investment_contribution" && draft.isTransfer === false && draft.excludeFromSpend === false) return null
  return nature
}
