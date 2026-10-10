import { currentCycle } from "@/domain/budget/cycle"
import type { MemberRef } from "@/domain/budget/members"
import { getBrowserClient } from "@/lib/supabase/browser"
import { readActuals, readLiquidity, readOverview } from "./rpc"

export type BudgetSource = {
  overview: unknown
  actuals: unknown
  liquidity: unknown
  members: MemberRef[]
}

async function readMembers(): Promise<MemberRef[]> {
  const { data, error } = await getBrowserClient()
    .schema("finance")
    .from("household_members")
    .select("id, email")
  if (error || !data) return []
  return data.flatMap((row) => (row.id ? [{ id: row.id, email: row.email }] : []))
}

export async function getBudgetSource(): Promise<BudgetSource> {
  const cycle = currentCycle()
  const [overview, actuals, liquidity, members] = await Promise.all([
    readOverview(cycle.start),
    readActuals({ from: cycle.start, to: cycle.endExclusive }),
    readLiquidity(),
    readMembers(),
  ])
  return { overview, actuals, liquidity, members }
}
