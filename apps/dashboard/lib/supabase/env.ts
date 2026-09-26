export const sessionCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
}

export function getSupabaseEnv(): { supabaseUrl: string; publishableKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl) {
    throw new Error("Missing required dashboard environment variable: NEXT_PUBLIC_SUPABASE_URL")
  }
  if (!publishableKey) {
    throw new Error(
      "Missing required dashboard environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    )
  }
  return { publishableKey, supabaseUrl }
}
