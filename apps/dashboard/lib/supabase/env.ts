export const sessionCookieOptions = {
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
}

const FINANCE_DATA_URL = "https://irykogsfzzoexmnnthgc.supabase.co"
const FINANCE_DATA_PUBLISHABLE_KEY = "sb_publishable_mgwEX8SIGj01zSROSNSLYw_C_ohcXBW"

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function getSupabaseEnv(): { supabaseUrl: string; publishableKey: string } {
  const supabaseUrl =
    present(process.env.NEXT_PUBLIC_SUPABASE_URL) ??
    present(process.env.SUPABASE_URL) ??
    FINANCE_DATA_URL
  const publishableKey =
    present(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ??
    present(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ??
    present(process.env.SUPABASE_ANON_KEY) ??
    FINANCE_DATA_PUBLISHABLE_KEY
  return { publishableKey, supabaseUrl }
}
