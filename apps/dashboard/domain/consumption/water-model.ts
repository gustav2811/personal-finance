import { incurredKey, monthKey, monthLabel } from "@/domain/consumption/energy-model"
import type { LedgerRead } from "@/lib/supabase/rows"

export type WaterMonth = {
  month: string
  label: string
  kl: number
  cost: number
}

// ISMRT can post an invoice as two debits and one matching credit. Cost is debits minus
// credits so it nets to one invoice. Only one debit carries the quantity, so kl is not doubled.
export function buildWaterMonths(ledgerEntries: LedgerRead[]): WaterMonth[] {
  const totals = new Map<string, { kl: number; cost: number }>()
  for (const entry of ledgerEntries) {
    if (entry.utility_type !== "water") continue
    const key = incurredKey(entry)
    if (!key) continue
    const month = monthKey(key)
    const total = totals.get(month) ?? { kl: 0, cost: 0 }
    total.kl += entry.quantity ?? 0
    total.cost += entry.direction === "debit" ? entry.amount : -entry.amount
    totals.set(month, total)
  }
  return [...totals.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([month, total]) => ({ cost: total.cost, kl: total.kl, label: monthLabel(month), month }))
}
