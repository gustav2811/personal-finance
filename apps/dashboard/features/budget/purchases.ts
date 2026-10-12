import { addMonths, currentCycle } from "@/domain/budget/cycle"
import type { MemberRef } from "@/domain/budget/members"
import { refundablePurchases, type RefundablePurchase } from "@/domain/budget/review"
import { readArray, readRecord, readString } from "@/domain/budget/wire"
import { readActuals } from "./rpc"

const PURCHASE_FROM = "2020-01-01"
const PAGE_CAP = 5

export type PurchaseList = {
  purchases: RefundablePurchase[]
  partial: boolean
  unread: boolean
}

export async function loadRefundablePurchases(input: {
  funds: readonly { id: string; name: string }[]
  members: readonly MemberRef[]
}): Promise<PurchaseList> {
  const entries: unknown[] = []
  let cursor: string | null = null
  const seen = new Set<string>()
  let partial = false
  const to = addMonths(currentCycle().start, 1)
  for (let page = 0; page < PAGE_CAP; page += 1) {
    const data = await readActuals({ from: PURCHASE_FROM, to }, cursor)
    const record = readRecord(data)
    entries.push(...readArray(record?.entries))
    const next = record ? readString(record, "next_cursor") : null
    if (!next || seen.has(next)) {
      partial = next !== null
      break
    }
    seen.add(next)
    cursor = next
    if (page === PAGE_CAP - 1) partial = true
  }
  return {
    purchases: refundablePurchases({ entries, funds: input.funds, members: input.members }),
    partial,
    unread: false,
  }
}
