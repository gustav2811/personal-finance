import type { MemberRef } from "@/domain/budget/members"

// finance.household_members is not granted to the signed-in role. Names stay
// generic until a member RPC exists. Do not query the table from the browser.
export function readMemberDirectory(): Promise<MemberRef[]> {
  return Promise.resolve([])
}
