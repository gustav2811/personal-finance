import { addMonths, currentCycle } from "@/domain/budget/cycle"
import type { MemberRef } from "@/domain/budget/members"
import { readMemberDirectory } from "./members"
import { readActuals, readLiquidity, readOverview, readReviewQueue } from "./rpc"

export type BudgetSource = {
  overview: unknown
  actuals: unknown
  liquidity: unknown
  review: unknown | null
  members: MemberRef[]
}

export async function getBudgetSource(cycleStart = currentCycle().start): Promise<BudgetSource> {
  const endExclusive = addMonths(cycleStart, 1)
  const [overview, actuals, liquidity, members, review] = await Promise.all([
    readOverview(cycleStart),
    readActuals({ from: cycleStart, to: endExclusive }),
    readLiquidity(),
    readMemberDirectory(),
    readReviewQueue(null).catch(() => null),
  ])
  return { overview, actuals, liquidity, members, review }
}
