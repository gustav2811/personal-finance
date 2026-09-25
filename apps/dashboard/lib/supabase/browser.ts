import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

export type BrowserClient = SupabaseClient<Database>

function getBrowserConfig(): { supabaseUrl: string; publishableKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!supabaseUrl) {
    throw new Error(
      "Missing required dashboard environment variable: NEXT_PUBLIC_SUPABASE_URL",
    )
  }
  if (!publishableKey) {
    throw new Error(
      "Missing required dashboard environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    )
  }
  return { publishableKey, supabaseUrl }
}

let browserClient: BrowserClient | undefined

export function getBrowserClient(): BrowserClient {
  if (!browserClient) {
    const { publishableKey, supabaseUrl } = getBrowserConfig()
    browserClient = createClient<Database>(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  }
  return browserClient
}
