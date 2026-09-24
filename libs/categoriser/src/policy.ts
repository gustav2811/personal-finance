import type { AcceptancePolicy, MerchantStat } from "./types.js";

export const CONSERVATIVE_POLICY: AcceptancePolicy = {
  historyMinSupport: 5,
  historyMinPurity: 1,
  jevMinConfidence: 0.97,
  jevMinProbability: 0.9,
  jevMinMargin: 0.5,
};

export function historyAccepts(
  stat: MerchantStat | undefined,
  policy: AcceptancePolicy,
): boolean {
  if (!stat || !stat.majority) return false;
  return stat.total >= policy.historyMinSupport && stat.purity >= policy.historyMinPurity;
}

export function jevAccepts(
  confidence: number,
  topProbability: number,
  margin: number,
  policy: AcceptancePolicy,
): boolean {
  return (
    confidence >= policy.jevMinConfidence &&
    topProbability >= policy.jevMinProbability &&
    margin >= policy.jevMinMargin
  );
}

export function probabilityMargin(probabilities: Record<string, number>): {
  top: number;
  margin: number;
  winner: string | null;
} {
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const winner = ranked[0]?.[0] ?? null;
  const top = ranked[0]?.[1] ?? 0;
  const second = ranked[1]?.[1] ?? 0;
  return { top, margin: top - second, winner };
}
