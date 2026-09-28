import type { ReactNode } from "react"
import { redirect } from "next/navigation"
import { LoginScreen } from "@/components/shell/login-screen"
import { AppShell } from "@/components/shell/app-shell"
import { createClient } from "@/lib/supabase/server"

export default async function HouseholdLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const email = typeof data?.claims.email === "string" ? data.claims.email : ""
  if (!data?.claims) {
    redirect("/login")
  }

  const { data: membership, error } = await supabase.rpc("finance_caller_membership_v1" as never)
  if (error) {
    return <LoginScreen error="Household membership could not be checked." />
  }

  const member = Boolean((membership as { member?: boolean } | null)?.member)
  if (!member) {
    return <LoginScreen denied error={null} />
  }

  return <AppShell email={email}>{children}</AppShell>
}
