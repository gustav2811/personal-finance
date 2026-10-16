import { addMonths, dayBefore } from "@/domain/budget/cycle"
import { localDateKey } from "@/lib/format/date"
import type {
  OverviewData,
  OverviewId,
  OverviewPoint,
} from "@/domain/overview/model"

const figures: Record<OverviewId, [number, number]> = {
  electricity: [1240, 2000],
  groceries: [4850, 7000],
  "eating-out": [1680, 2500],
  fuel: [1950, 3000],
  coffee: [420, 600],
}
const labels = {
  electricity: "Electricity",
  groceries: "Groceries",
  "eating-out": "Eating out",
  fuel: "Fuel",
  coffee: "Coffee",
}

/** Synthetic data only; the loader calls this exclusively in fail-closed dev mode. */
export function mockOverviewData(cycleStart: string): OverviewData {
  const now = new Date()
  const today = localDateKey(now.toISOString())
  const endExclusive = addMonths(cycleStart, 1)
  const dates: string[] = []
  for (let date = cycleStart; date < endExclusive;) {
    dates.push(date)
    const next = new Date(`${date}T12:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    date = next.toISOString().slice(0, 10)
  }
  const items = (Object.keys(figures) as OverviewId[]).map((id) => {
    const through = id === "electricity" ? dayBefore(today) : today
    const knownDates = dates.filter((date) => date <= through)
    const [target, budget] = figures[id]
    const weights = knownDates.map((_, index) => {
      if (id === "electricity") return 8 + ((index * 7) % 11)
      if (id === "groceries")
        return index % 6 === 0 ? 16 : index % 4 === 0 ? 5 : 0
      if (id === "eating-out")
        return index % 7 === 3 || index % 7 === 5 ? 10 : 0
      if (id === "fuel") return index === 4 || index === 15 ? 15 : 0
      return index % 3 === 1 ? 0 : 1 + (index % 2)
    })
    const weightTotal = weights.reduce((sum, value) => sum + value, 0)
    let cumulativeCents = 0
    let consumedWeight = 0
    const points: OverviewPoint[] = dates.map((date, index) => {
      if (date > through) return { date, daily: null, cumulative: null }
      consumedWeight += weights[index]
      const nextCents = weightTotal
        ? Math.round((target * 100 * consumedWeight) / weightTotal)
        : 0
      const daily = (nextCents - cumulativeCents) / 100
      cumulativeCents = nextCents
      return { date, daily, cumulative: cumulativeCents / 100 }
    })
    const spent = cumulativeCents / 100
    return {
      id,
      label: labels[id],
      spent,
      reserved: 0,
      budget,
      remaining: budget - spent,
      categoryIds: id === "electricity" ? [] : [`demo-${id}`],
      points,
      coverageThrough: knownDates.at(-1) ?? null,
      budgetNote: null,
    }
  })
  return {
    cycleStart,
    endExclusive,
    fetchedAt: now.toISOString(),
    demo: true,
    warnings: [],
    items,
  }
}
