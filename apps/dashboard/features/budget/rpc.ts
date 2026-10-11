import { copy } from "@/domain/budget/copy"
import { getBrowserClient } from "@/lib/supabase/browser"

type RpcResult = {
  data: unknown
  error: { message: string } | null
}

async function clientRpc(name: string, args: Record<string, unknown>): Promise<RpcResult> {
  const client = getBrowserClient()
  return await client.rpc(name as never, args as never)
}

export function friendlyBudgetError(message: string): Error {
  if (message.startsWith("budget_forbidden:")) return new Error(copy.notAMember)
  if (message.startsWith("budget_stale:") || message.includes("budget_stale")) return new Error(copy.numbersChanged)
  if (message.includes("reviewer identity is not available") || message.includes("JWT")) {
    return new Error(copy.signIn)
  }
  if (message.startsWith("budget_invalid:") || message.startsWith("budget_not_found:") || message.startsWith("budget_incomplete:")) {
    return new Error(copy.couldNotSave)
  }
  return new Error(message || copy.couldNotRead)
}

export async function readBudgetRpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await clientRpc(name, args)
  if (error) throw friendlyBudgetError(error.message)
  return data
}

export function readOverview(cycleStart: string): Promise<unknown> {
  return readBudgetRpc("budget_get_overview_v1", { p_cycle_start: cycleStart })
}

export function readActuals(filters: { from: string; to: string }): Promise<unknown> {
  return readBudgetRpc("budget_get_actuals_v1", { p_filters: filters, p_limit: 200 })
}

export function readLiquidity(): Promise<unknown> {
  return readBudgetRpc("budget_get_liquidity_v1", { p_horizon_days: 45 })
}

export function readFund(fundId: string, from: string, to: string, cursor: string | null): Promise<unknown> {
  return readBudgetRpc("budget_get_fund_v1", {
    p_fund_id: fundId,
    p_from: from,
    p_to: to,
    p_cursor: cursor,
    p_limit: 50,
  })
}

export function readVersions(cursor: string | null): Promise<unknown> {
  return readBudgetRpc("budget_list_versions_v1", { p_cursor: cursor, p_limit: 50 })
}

export function readVersion(versionId: string): Promise<unknown> {
  return readBudgetRpc("budget_get_version_v1", { p_version_id: versionId })
}

export function readReviewQueue(cursor: string | null): Promise<unknown> {
  return readBudgetRpc("budget_get_review_queue_v1", { p_cursor: cursor, p_limit: 50 })
}

export function readCutover(): Promise<unknown> {
  return readBudgetRpc("budget_get_cutover_v1", {})
}

export class BudgetRpcError extends Error {
  readonly raw: string

  constructor(raw: string) {
    super(friendlyBudgetError(raw).message)
    this.name = "BudgetRpcError"
    this.raw = raw
  }
}

export async function writeBudgetRpc(name: string, commandId: string, payload: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await clientRpc(name, { p_command_id: commandId, p_payload: payload })
  if (error) throw new BudgetRpcError(error.message)
  return data
}
