export type RangeDays = 30 | 90 | 365

export const RANGE_ITEMS: Array<{ days: RangeDays; label: string }> = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
]
