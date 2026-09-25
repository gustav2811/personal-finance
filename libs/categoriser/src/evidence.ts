import type { EvidenceIndex, MerchantStat, TxFeatures } from "./types.js";

export function fingerprint(tx: Pick<TxFeatures, "merchantKey" | "direction" | "notesNorm" | "descriptionNorm">): string {
  const memo = tx.notesNorm || tx.descriptionNorm;
  return `${tx.merchantKey}|${tx.direction}|${memo}`;
}

export function buildEvidence(
  rows: readonly TxFeatures[],
  excludeIds: ReadonlySet<string> = new Set(),
): EvidenceIndex {
  const buckets = new Map<string, { counts: Map<string, number>; lastDate: string }>();
  for (const row of rows) {
    if (excludeIds.has(row.id)) continue;
    if (!row.categoryName) continue;
    const bucket = buckets.get(row.merchantKey) ?? {
      counts: new Map<string, number>(),
      lastDate: row.date,
    };
    bucket.counts.set(row.categoryName, (bucket.counts.get(row.categoryName) ?? 0) + 1);
    if (row.date > bucket.lastDate) bucket.lastDate = row.date;
    buckets.set(row.merchantKey, bucket);
  }

  const byMerchant = new Map<string, MerchantStat>();
  const exemplarCounts = new Map<string, Map<string, number>>();
  for (const [merchantKey, bucket] of buckets) {
    let total = 0;
    let majority: string | null = null;
    let majorityCount = 0;
    const counts: Record<string, number> = {};
    for (const [name, count] of bucket.counts) {
      counts[name] = count;
      total += count;
      if (count > majorityCount) {
        majority = name;
        majorityCount = count;
      }
      const perCategory = exemplarCounts.get(name) ?? new Map<string, number>();
      perCategory.set(merchantKey, (perCategory.get(merchantKey) ?? 0) + count);
      exemplarCounts.set(name, perCategory);
    }
    byMerchant.set(merchantKey, {
      merchantKey,
      total,
      counts,
      majority,
      majorityCount,
      purity: total === 0 ? 0 : majorityCount / total,
      lastDate: bucket.lastDate,
    });
  }

  const exemplarsByCategory = new Map<string, string[]>();
  for (const [category, merchants] of exemplarCounts) {
    const top = [...merchants.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([key]) => key);
    exemplarsByCategory.set(category, top);
  }

  return { byMerchant, exemplarsByCategory };
}

export function suspiciousMerchants(
  index: EvidenceIndex,
  minSupport = 5,
): MerchantStat[] {
  return [...index.byMerchant.values()].filter(
    (stat) => stat.total >= minSupport && stat.purity < 0.8,
  );
}
