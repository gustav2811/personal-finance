"use client"

import type { ReactNode } from "react"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { HouseholdProvider } from "@/components/shell/household-context"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { signInWithGoogle, signOut } from "@/lib/supabase/auth"

export function AppShell({ children, email }: { children: ReactNode; email: string }) {
  return (
    <HouseholdProvider
      value={{
        email,
        signIn: () => void signInWithGoogle(),
      }}
    >
      <SidebarProvider>
        <AppSidebar email={email} onSignOut={() => void signOut()} />
        <SidebarInset>
          <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
            <SidebarTrigger />
            <Separator className="h-4" orientation="vertical" />
            <p className="type-caption">Household</p>
            <div className="ml-auto">
              <ThemeToggle />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </HouseholdProvider>
  )
}
