import { AnalysisView } from "@/features/analysis/analysis-view"

const isoDate = /^\d{4}-\d{2}-\d{2}$/

function validDate(value: string | undefined) {
  if (!value || !isoDate.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? undefined
    : value
}

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined
}

export default async function AnalysisPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string | string[]
    to?: string | string[]
    category?: string | string[]
  }>
}) {
  const params = await searchParams
  const from = validDate(single(params.from))
  const to = validDate(single(params.to))
  const initialRange = from && to && from <= to ? { from, to } : undefined
  const categories = [
    ...new Set(
      (Array.isArray(params.category) ? params.category : [params.category])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]

  return (
    <AnalysisView initialRange={initialRange} initialCategoryIds={categories} />
  )
}
