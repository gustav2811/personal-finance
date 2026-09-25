import { getBrowserClient } from "./browser"

export async function callerIsHouseholdMember(): Promise<boolean> {
  const supabase = getBrowserClient()
  const { data, error } = await supabase.rpc("finance_caller_membership_v1")
  if (error) {
    throw new Error("Household membership could not be checked.")
  }
  return Boolean(data?.member)
}
