import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"
import { getSupabaseEnv, sessionCookieOptions } from "./env"

export type BrowserClient = SupabaseClient<Database>

let browserClient: BrowserClient | undefined

export function getBrowserClient(): BrowserClient {
  if (!browserClient) {
    const { publishableKey, supabaseUrl } = getSupabaseEnv()
    browserClient = createBrowserClient<Database>(supabaseUrl, publishableKey, {
      cookieOptions: sessionCookieOptions,
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: false,
        flowType: "pkce",
        persistSession: true,
      },
    })
  }
  return browserClient
}
