import type { TxFeatures } from "./types.js";

export type PlannedFrequency = "weekly" | "monthly" | "quarterly" | "yearly";

export interface PlannedTemplate {
  id: string;
  accountId: string | null;
  merchantId: string | null;
  categoryName: string | null;
  description: string;
  frequency: PlannedFrequency;
  amount: number | null;
  amountMin: number | null;
  amountMax: number | null;
  startDate: string;
  endDate: string | null;
}

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(iso.slice(0, 10)) / 86_400_000);
}

function monthsBetween(start: string, date: string): number {
  const from = start.slice(0, 10);
  const to = date.slice(0, 10);
  const startYear = Number(from.slice(0, 4));
  const startMonth = Number(from.slice(5, 7));
  const year = Number(to.slice(0, 4));
  const month = Number(to.slice(5, 7));
  return (year - startYear) * 12 + (month - startMonth);
}

function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

function onCadence(tx: TxFeatures, plan: PlannedTemplate): boolean {
  const date = tx.date.slice(0, 10);
  const start = plan.startDate.slice(0, 10);
  if (date < start) return false;
  if (plan.endDate && date > plan.endDate.slice(0, 10)) return false;
  const dayGap = Math.abs(dayOfMonth(date) - dayOfMonth(start));
  const nearDay = dayGap <= 3 || dayGap >= 28;
  if (plan.frequency === "weekly") {
    const days = dayNumber(date) - dayNumber(start);
    const mod = ((days % 7) + 7) % 7;
    return mod <= 2 || mod >= 5;
  }
  if (plan.frequency === "yearly") {
    return date.slice(5, 7) === start.slice(5, 7) && (dayGap <= 7 || dayGap >= 24);
  }
  const months = monthsBetween(start, date);
  if (months < 0 || !nearDay) return false;
  if (plan.frequency === "quarterly") return months % 3 === 0;
  return true;
}

function amountFits(tx: TxFeatures, plan: PlannedTemplate): boolean {
  const amount = tx.amountAbs;
  if (plan.amountMin != null && plan.amountMax != null) {
    return amount >= plan.amountMin && amount <= plan.amountMax;
  }
  if (plan.amount == null) return false;
  const slack = Math.max(1, plan.amount * 0.05);
  return Math.abs(amount - plan.amount) <= slack;
}

function score(tx: TxFeatures, plan: PlannedTemplate): number | null {
  if (plan.accountId && plan.accountId !== tx.accountId) return null;
  const merchant = Boolean(plan.merchantId && tx.merchantId && plan.merchantId === tx.merchantId);
  if (plan.merchantId && tx.merchantId && plan.merchantId !== tx.merchantId) return null;
  if (!onCadence(tx, plan)) return null;
  const amount = amountFits(tx, plan);
  if (!amount && !merchant) return null;
  if (plan.amount == null && plan.amountMin == null && !merchant) return null;
  return (merchant ? 4 : 0) + (amount ? 2 : 0) + (plan.accountId ? 1 : 0);
}

export function matchPlannedTransaction(
  tx: TxFeatures,
  plans: readonly PlannedTemplate[],
): PlannedTemplate | null {
  let best: PlannedTemplate | null = null;
  let bestScore = -1;
  for (const plan of plans) {
    const value = score(tx, plan);
    if (value == null || value < bestScore) continue;
    if (value === bestScore && best && best.id < plan.id) continue;
    best = plan;
    bestScore = value;
  }
  return best;
}
