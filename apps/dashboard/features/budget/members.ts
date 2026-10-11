import type { MemberRef } from "@/domain/budget/members"
import { readMemberList } from "@/domain/budget/cutover"
import { readBudgetRpc } from "./rpc"

export async function readMemberDirectory(): Promise<MemberRef[]> {
  const payload = await readBudgetRpc("budget_list_members_v1", {})
  return readMemberList(payload)
}
