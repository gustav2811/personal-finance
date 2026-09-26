"use client"

import { useState } from "react"
import { AuthScreen } from "@/components/shell/auth-screen"
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
    <AuthScreen
      denied={denied}
      error={localError ?? error}
      onSignIn={() => void onSignIn()}
      onSignOut={denied ? () => void signOut() : undefined}
      signingIn={signingIn}
    />
  )
}
