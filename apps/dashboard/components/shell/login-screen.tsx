"use client"

import { useState } from "react"
import { GalleryVerticalEnd } from "lucide-react"
import { LoginForm } from "@/components/login-form"
import { signInWithGoogle, signOut } from "@/lib/supabase/auth"

export function LoginScreen({
  denied = false,
  error,
}: {
  denied?: boolean
  error: string | null
}) {
  const [signingIn, setSigningIn] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  async function onSignIn() {
    setSigningIn(true)
    setLocalError(null)
    try {
      await signInWithGoogle()
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : "Google sign-in could not start.")
      setSigningIn(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <GalleryVerticalEnd className="size-4" />
          </div>
          Household
        </div>
        <LoginForm
          denied={denied}
          error={localError ?? error}
          onSignIn={() => void onSignIn()}
          onSignOut={denied ? () => void signOut() : undefined}
          signingIn={signingIn}
        />
      </div>
    </div>
  )
}
