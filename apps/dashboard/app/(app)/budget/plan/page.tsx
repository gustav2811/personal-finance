import { AgreementView } from "@/features/budget/agreement-view"

export default async function BudgetPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string | string[] }>
}) {
  const params = await searchParams
  const cycle = Array.isArray(params.cycle) ? params.cycle[0] : params.cycle
  return <AgreementView initialCycle={cycle === "next" ? "next" : "this"} />
}
