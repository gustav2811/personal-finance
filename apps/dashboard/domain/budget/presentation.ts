import type { PlanLine } from "./plan"

export type PurposeGroup = "bills" | "everyday" | "saved"

export type GroupPlacement = {
  group: PurposeGroup | "ungrouped"
  ambiguous: boolean
  persisted: boolean
}

const SAVED = new Set<PlanLine["fundingBehaviour"]>(["accumulating", "target_by_date", "reserve_target"])

export function suggestGroup(line: PlanLine): { group: PurposeGroup; ambiguous: boolean } {
  if (SAVED.has(line.fundingBehaviour)) return { group: "saved", ambiguous: false }
  if (line.kind === "debt_commitment" || line.kind === "contribution") return { group: "bills", ambiguous: false }
  if (line.expectedPaymentOn || line.expectedPaymentAccountId) return { group: "bills", ambiguous: false }
  return { group: "everyday", ambiguous: true }
}

export function placeGroup(line: PlanLine, override: PurposeGroup | undefined): GroupPlacement {
  const suggested = suggestGroup(line)
  if (!suggested.ambiguous) return { group: suggested.group, ambiguous: false, persisted: true }
  if (override) return { group: override, ambiguous: true, persisted: false }
  return { group: "ungrouped", ambiguous: true, persisted: false }
}

export function groupTitle(group: PurposeGroup | "ungrouped"): string {
  switch (group) {
    case "bills":
      return "Bills and commitments"
    case "everyday":
      return "Everyday"
    case "saved":
      return "Saved for later"
    case "ungrouped":
      return "Choose a group"
    default: {
      const unreachable: never = group
      return unreachable
    }
  }
}
