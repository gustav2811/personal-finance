import { PlanEditor } from "@/features/budget/plan-editor"

export default async function BudgetPlanPage({
  searchParams,
}: {
  searchParams: Promise<{ cycle?: string | string[] }>
}) {
  const params = await searchParams
  const cycle = Array.isArray(params.cycle) ? params.cycle[0] : params.cycle
  return <PlanEditor initialChoice={cycle === "next" ? "next" : "this"} />
}
