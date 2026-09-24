export interface ScoredRow {
  actual: string;
  predicted: string | null;
  accept: boolean;
  confidence: number;
  margin: number;
  topProbability: number;
}

export interface ClassScore {
  category: string;
  support: number;
  precision: number;
  recall: number;
  f1: number;
}

export function accuracy(rows: readonly ScoredRow[]): number {
  const labelled = rows.filter((row) => row.predicted);
  if (labelled.length === 0) return 0;
  const hits = labelled.filter((row) => row.predicted === row.actual).length;
  return hits / labelled.length;
}

export function classScores(rows: readonly ScoredRow[]): ClassScore[] {
  const labels = new Set<string>();
  for (const row of rows) {
    labels.add(row.actual);
    if (row.predicted) labels.add(row.predicted);
  }
  return [...labels].sort().map((category) => {
    const tp = rows.filter((row) => row.predicted === category && row.actual === category).length;
    const fp = rows.filter((row) => row.predicted === category && row.actual !== category).length;
    const fn = rows.filter((row) => row.actual === category && row.predicted !== category).length;
    const support = rows.filter((row) => row.actual === category).length;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { category, support, precision, recall, f1 };
  });
}

export function macroF1(rows: readonly ScoredRow[]): number {
  const scores = classScores(rows).filter((score) => score.support > 0);
  if (scores.length === 0) return 0;
  return scores.reduce((sum, score) => sum + score.f1, 0) / scores.length;
}

export function weightedF1(rows: readonly ScoredRow[]): number {
  const scores = classScores(rows).filter((score) => score.support > 0);
  const total = scores.reduce((sum, score) => sum + score.support, 0);
  if (total === 0) return 0;
  return scores.reduce((sum, score) => sum + score.f1 * score.support, 0) / total;
}

export function selective(rows: readonly ScoredRow[]): {
  coverage: number;
  precision: number;
  accepted: number;
} {
  if (rows.length === 0) return { coverage: 0, precision: 0, accepted: 0 };
  const accepted = rows.filter((row) => row.accept && row.predicted);
  const hits = accepted.filter((row) => row.predicted === row.actual).length;
  return {
    coverage: accepted.length / rows.length,
    precision: accepted.length === 0 ? 0 : hits / accepted.length,
    accepted: accepted.length,
  };
}

export interface ThresholdPoint {
  confidence: number;
  probability: number;
  margin: number;
  coverage: number;
  precision: number;
  accepted: number;
}

export function coverageCurve(
  rows: readonly ScoredRow[],
  grid: { confidence: number; probability: number; margin: number }[],
): ThresholdPoint[] {
  return grid.map((point) => {
    const judged = rows.map((row) => ({
      ...row,
      accept:
        row.predicted !== null &&
        row.confidence >= point.confidence &&
        row.topProbability >= point.probability &&
        row.margin >= point.margin,
    }));
    const stats = selective(judged);
    return { ...point, ...stats };
  });
}

export function bestThreshold(
  points: readonly ThresholdPoint[],
  minPrecision: number,
): ThresholdPoint | null {
  const ok = points.filter((point) => point.accepted > 0 && point.precision >= minPrecision);
  ok.sort((a, b) => b.coverage - a.coverage || b.precision - a.precision);
  return ok[0] ?? null;
}

export function confusionPairs(
  rows: readonly ScoredRow[],
  limit = 15,
): { actual: string; predicted: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.predicted || row.predicted === row.actual) continue;
    const key = `${row.actual}\t${row.predicted}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => {
      const [actual, predicted] = key.split("\t");
      return { actual, predicted, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
