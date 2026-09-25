import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type LooseTable = {
  Row: Record<string, unknown>;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

type LooseSchema = {
  Tables: Record<string, LooseTable>;
  Views: Record<string, LooseTable>;
  Functions: Record<
    string,
    {
      Args: Record<string, unknown>;
      Returns: unknown;
    }
  >;
  Enums: Record<string, never>;
  CompositeTypes: Record<string, never>;
};

export type Database = {
  public: LooseSchema;
  consumption: LooseSchema;
};

export type BrowserClient = SupabaseClient<Database>;

function getBrowserConfig(): { supabaseUrl: string; publishableKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl) {
    throw new Error(
      "Missing required dashboard environment variable: NEXT_PUBLIC_SUPABASE_URL",
    );
  }
  if (!publishableKey) {
    throw new Error(
      "Missing required dashboard environment variable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }
  return { publishableKey, supabaseUrl };
}

let publicClient: BrowserClient | undefined;

export function getPublicClient(): BrowserClient {
  if (!publicClient) {
    const { publishableKey, supabaseUrl } = getBrowserConfig();
    publicClient = createClient<Database>(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return publicClient;
}

export function getConsumptionClient() {
  return getPublicClient().schema("consumption");
}
