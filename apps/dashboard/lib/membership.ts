import { getPublicClient } from "./supabase-browser";

type Membership = {
  member?: boolean;
};

export async function callerIsHouseholdMember(): Promise<boolean> {
  const supabase = getPublicClient();
  const { data, error } = await supabase.rpc("finance_caller_membership_v1");
  if (error) {
    throw new Error("Household membership could not be checked.");
  }
  return Boolean((data as Membership | null)?.member);
}
