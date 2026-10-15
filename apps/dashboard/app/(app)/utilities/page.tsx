import { UtilitiesView } from "@/features/utilities/utilities-view"

export default async function UtilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[]
    from?: string | string[]
    to?: string | string[]
  }>
}) {
  const params = await searchParams
  const tab = typeof params.tab === "string" ? params.tab : undefined
  const initialTab = tab === "wallet" || tab === "water" ? tab : "electricity"
  const from = validDate(single(params.from))
  const to = validDate(single(params.to))
  const initialRange =
    from && to && from <= to && dateSpan(from, to) <= 366
      ? { from, to }
      : undefined
  return <UtilitiesView initialTab={initialTab} initialRange={initialRange} />
}

const isoDate = /^\d{4}-\d{2}-\d{2}$/

function single(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined
}

function validDate(value: string | undefined) {
  if (!value || !isoDate.test(value)) return undefined
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? undefined
    : value
}

function dateSpan(from: string, to: string) {
  return (
    Math.floor(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400000,
    ) + 1
  )
}
