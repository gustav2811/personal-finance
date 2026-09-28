import { getBrowserClient } from "./browser"

export async function signInWithGoogle(): Promise<void> {
  const supabase = getBrowserClient()
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      queryParams: { hd: "klingbiel.org" },
    },
  })
  if (error) {
    throw new Error("Google sign-in could not start.")
  }
}

export async function signOut(): Promise<void> {
  const supabase = getBrowserClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    throw new Error("Sign-out could not finish.")
  }
  window.location.assign("/login")
}
