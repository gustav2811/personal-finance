import "dotenv/config";
import type { BankZeroAccountMapping, IngestCoreConfig } from "@investments/ingest-core";
import { parseBankZeroAccountMapJson } from "@investments/ingest-core";

export type { BankZeroAccountMapping };

export interface IngestWebhookConfig extends IngestCoreConfig {
  ingestToken: string;
  redisUrl: string;
  nodeEnv: string;
  port: number;
}

export function getConfig(): IngestWebhookConfig {
  const ingestToken = process.env.INGEST_TOKEN ?? "";
  const finwiseApiKey = process.env.FINWISE_API_KEY ?? "";
  const finwiseBaseUrl =
    process.env.FINWISE_BASE_URL ?? "https://api.finwiseapp.io";
  const redisUrl = process.env.REDIS_URL ?? "";
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_KEY ?? "";
  const bankZeroAccountId = process.env.BANK_ZERO_ACCOUNT_ID ?? "";
  const bankZeroAccountMap = parseBankZeroAccountMapJson(
    process.env.BANK_ZERO_ACCOUNT_MAP ?? "[]",
  );

  const uploadToFinwise =
    process.env.UPLOAD_TO_FINWISE === "true" ||
    process.env.UPLOAD_TO_FINWISE === "1";
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const port = parseInt(process.env.PORT ?? "3000", 10);

  const missing: string[] = [];
  if (!ingestToken) missing.push("INGEST_TOKEN");
  if (!finwiseApiKey) missing.push("FINWISE_API_KEY");
  if (!redisUrl) missing.push("REDIS_URL");
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_KEY");
  if (!bankZeroAccountId && bankZeroAccountMap.length === 0)
    missing.push("BANK_ZERO_ACCOUNT_ID or BANK_ZERO_ACCOUNT_MAP");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  return {
    ingestToken,
    finwiseApiKey,
    finwiseBaseUrl,
    redisUrl,
    supabaseUrl,
    supabaseServiceRoleKey,
    bankZeroAccountId,
    bankZeroAccountMap,
    uploadToFinwise,
    nodeEnv,
    port,
  };
}
