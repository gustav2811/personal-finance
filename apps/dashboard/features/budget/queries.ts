import { currentCycle } from "@/domain/budget/cycle"
import type { MemberRef } from "@/domain/budget/members"
import { readMemberDirectory } from "./members"
import { readActuals, readLiquidity, readOverview } from "./rpc"

export type BudgetSource = {
  overview: unknown
  actuals: unknown
  liquidity: unknown
  members: MemberRef[]
}

export async function getBudgetSource(): Promise<BudgetSource> {
  const cycle = currentCycle()
  const [overview, actuals, liquidity, members] = await Promise.all([
    readOverview(cycle.start),
    readActuals({ from: cycle.start, to: cycle.endExclusive }),
    readLiquidity(),
    readMemberDirectory(),
  ])
  return { overview, actuals, liquidity, members }
}
