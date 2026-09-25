import { createClient } from "@supabase/supabase-js";

type BrowserClient = ReturnType<typeof createClient>;
type ConsumptionSchema = ReturnType<BrowserClient["schema"]>;

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
let consumptionSchema: ConsumptionSchema | undefined;

export function getPublicClient(): BrowserClient {
  if (!publicClient) {
    const { publishableKey, supabaseUrl } = getBrowserConfig();
    publicClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return publicClient;
}

export function getConsumptionClient(): ConsumptionSchema {
  if (!consumptionSchema) {
    consumptionSchema = getPublicClient().schema("consumption");
  }
  return consumptionSchema;
}
