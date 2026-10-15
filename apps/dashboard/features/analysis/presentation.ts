import type { BreakdownRow } from "./model"

export type Contributor = {
  key: string
  label: string
  value: number
  weight: number
  count: number
  memberKeys: string[]
}

/** Collapse the long tail without dropping its value, magnitude, or drill-down. */
export function groupContributors(
  rows: BreakdownRow[],
  value: (row: BreakdownRow) => number,
  limit = 7,
): Contributor[] {
  const entries = rows.map((row) => ({
    key: row.key,
    label: row.label,
    value: value(row),
    weight: Math.abs(value(row)),
    count: row.count,
    memberKeys: [row.key],
  }))
  if (entries.length <= limit) return entries
  const leading = entries.slice(0, limit)
  const remaining = entries.slice(limit)
  let key = "analysis:remaining"
  while (entries.some((entry) => entry.key === key)) key += ":"
  return [
    ...leading,
    {
      key,
      label: `Other (${remaining.length})`,
      value: remaining.reduce((sum, row) => sum + row.value, 0),
      weight: remaining.reduce((sum, row) => sum + row.weight, 0),
      count: remaining.reduce((sum, row) => sum + row.count, 0),
      memberKeys: remaining.flatMap((row) => row.memberKeys),
    },
  ]
}
