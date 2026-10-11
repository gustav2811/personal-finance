import { addMonths, currentCycle } from "@/domain/budget/cycle"
import type { MemberRef } from "@/domain/budget/members"
import { readMemberDirectory } from "./members"
import { readActuals, readLiquidity, readOverview } from "./rpc"

export type BudgetSource = {
  overview: unknown
  actuals: unknown
  liquidity: unknown
  members: MemberRef[]
}

export async function getBudgetSource(cycleStart = currentCycle().start): Promise<BudgetSource> {
  const endExclusive = addMonths(cycleStart, 1)
  const [overview, actuals, liquidity, members] = await Promise.all([
    readOverview(cycleStart),
    readActuals({ from: cycleStart, to: endExclusive }),
    readLiquidity(),
    readMemberDirectory(),
  ])
  return { overview, actuals, liquidity, members }
}
