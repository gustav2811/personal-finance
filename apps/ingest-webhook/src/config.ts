import "dotenv/config";
import type {
  BankZeroAccountMapping,
  IngestCoreConfig,
} from "@investments/ingest-core";
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
  const categorisationEnabled =
    process.env.CATEGORISATION_ENABLED === "true" ||
    process.env.CATEGORISATION_ENABLED === "1";
  const geminiApiKey = process.env.GEMINI_API_KEY ?? "";
  const geminiModel = process.env.GEMINI_MODEL ?? "gemini-3-flash-preview";
  const geminiApiBase =
    process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com";
  const categorisationLlmTimeoutMs = parseInt(
    process.env.CATEGORISATION_LLM_TIMEOUT_MS ?? "45000",
    10,
  );
  const categorisationMinConfidence = parseFloat(
    process.env.CATEGORISATION_MIN_CONFIDENCE ?? "0.35",
  );
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
    categorisationEnabled,
    geminiApiKey,
    geminiModel,
    geminiApiBase,
    categorisationLlmTimeoutMs: Number.isFinite(categorisationLlmTimeoutMs)
      ? categorisationLlmTimeoutMs
      : 45_000,
    categorisationMinConfidence: Number.isFinite(categorisationMinConfidence)
      ? categorisationMinConfidence
      : 0.35,
    nodeEnv,
    port,
  };
}
