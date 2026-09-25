"use client"

import { useEffect, useState, type ReactNode } from "react"
import { AuthScreen } from "@/components/shell/auth-screen"
import { AppSidebar } from "@/components/shell/app-sidebar"
import { HouseholdProvider } from "@/components/shell/household-context"
import { ThemeToggle } from "@/components/shell/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { callerIsHouseholdMember } from "@/lib/supabase/membership"
import { getBrowserClient } from "@/lib/supabase/browser"

const IS_LOCAL_PREVIEW = process.env.NODE_ENV !== "production"

type AuthState = "loading" | "signed_out" | "denied" | "ready" | "error"

export function AppShell({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>("loading")
  const [authError, setAuthError] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState("")
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    let mounted = true
    let unsubscribe: (() => void) | undefined

    async function initialize() {
      if (IS_LOCAL_PREVIEW) {
        if (mounted) {
          setUserEmail("local preview")
          setAuthState("ready")
        }
        return
      }

      try {
        const supabase = getBrowserClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!session) {
          if (mounted) setAuthState("signed_out")
          return
        }

        const {
          data: { user },
          error,
        } = await supabase.auth.getUser()
        if (error || !user?.email) {
          throw new Error("Your session could not be verified.")
        }

        const member = await callerIsHouseholdMember()
        if (!member) {
          if (mounted) {
            setAuthState("denied")
            setUserEmail(user.email)
          }
          return
        }

        if (mounted) {
          setUserEmail(user.email)
          setAuthState("ready")
        }

        const subscription = supabase.auth.onAuthStateChange((event) => {
          if (event === "SIGNED_OUT" && mounted) {
            setAuthState("signed_out")
          }
        })
        unsubscribe = () => subscription.data.subscription.unsubscribe()
      } catch (error) {
        if (mounted) {
          setAuthState("error")
          setAuthError(
            error instanceof Error
              ? error.message
              : "Dashboard configuration is incomplete.",
          )
        }
      }
    }

    void initialize()
    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [])

  async function signIn() {
    setSigningIn(true)
    setAuthError(null)
    try {
      const supabase = getBrowserClient()
      const { error } = await supabase.auth.signInWithOAuth({
        options: { redirectTo: window.location.origin },
        provider: "google",
      })
      if (error) setAuthError("Google sign-in could not start.")
    } catch {
      setAuthError("Dashboard configuration is incomplete.")
    } finally {
      setSigningIn(false)
    }
  }

  async function signOut() {
    await getBrowserClient().auth.signOut()
    setAuthState("signed_out")
  }

  if (authState === "loading") {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3" aria-busy="true" aria-live="polite">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-8 w-full" />
          <span className="sr-only">Checking household access</span>
        </div>
      </div>
    )
  }

  if (authState === "signed_out" || authState === "denied" || authState === "error") {
    return (
      <AuthScreen
        denied={authState === "denied"}
        error={authError}
        onSignIn={() => void signIn()}
        signingIn={signingIn}
      />
    )
  }

  return (
    <HouseholdProvider
      value={{
        email: userEmail,
        isLocalPreview: IS_LOCAL_PREVIEW,
        signIn: () => void signIn(),
      }}
    >
      <SidebarProvider>
        <AppSidebar
          email={userEmail}
          isLocalPreview={IS_LOCAL_PREVIEW}
          onSignOut={() => void signOut()}
        />
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
