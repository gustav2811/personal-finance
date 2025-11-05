import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../config";

export function getSupabaseClient(): SupabaseClient {
  const cfg = getConfig();
  return createClient(cfg.supabaseUrl, cfg.supabaseServiceKey);
}
