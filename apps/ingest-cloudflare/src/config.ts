import {
  parseBankZeroAccountMapJson,
  type IngestCoreConfig,
} from "@investments/ingest-core";

export interface ConsumerEnv {
  INGEST_BUCKET: R2Bucket;
  JOBS_QUEUE: Queue<unknown>;
  FINWISE_API_KEY: string;
  FINWISE_BASE_URL: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  BANK_ZERO_ACCOUNT_ID: string;
  BANK_ZERO_ACCOUNT_MAP: string;
  UPLOAD_TO_FINWISE: string;
  CATEGORISATION_ENABLED?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_API_BASE?: string;
  CATEGORISATION_LLM_TIMEOUT_MS?: string;
  CATEGORISATION_MIN_CONFIDENCE?: string;
  ISMRT_USERNAME?: string;
  ISMRT_PASSWORD?: string;
  ISMRT_LOOKBACK_DAYS?: string;
  TUYA_DEVICE_ID: string;
  TUYA_ACCESS_ID: string;
  TUYA_ACCESS_SECRET: string;
}

export function getConsumerConfig(env: ConsumerEnv): IngestCoreConfig {
  const timeoutRaw = env.CATEGORISATION_LLM_TIMEOUT_MS ?? "45000";
  const timeoutParsed = parseInt(timeoutRaw, 10);
  const confRaw = env.CATEGORISATION_MIN_CONFIDENCE ?? "0.35";
  const confParsed = parseFloat(confRaw);
  return {
    finwiseApiKey: env.FINWISE_API_KEY,
    finwiseBaseUrl: env.FINWISE_BASE_URL || "https://api.finwiseapp.io",
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_KEY,
    bankZeroAccountId: env.BANK_ZERO_ACCOUNT_ID ?? "",
    bankZeroAccountMap: parseBankZeroAccountMapJson(
      env.BANK_ZERO_ACCOUNT_MAP ?? "[]",
    ),
    uploadToFinwise:
      env.UPLOAD_TO_FINWISE === "true" || env.UPLOAD_TO_FINWISE === "1",
    categorisationEnabled:
      env.CATEGORISATION_ENABLED === "true" ||
      env.CATEGORISATION_ENABLED === "1",
    geminiApiKey: env.GEMINI_API_KEY ?? "",
    geminiModel: env.GEMINI_MODEL ?? "gemini-gemini-3-flash-preview",
    geminiApiBase:
      env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com",
    categorisationLlmTimeoutMs: Number.isFinite(timeoutParsed)
      ? timeoutParsed
      : 45_000,
    categorisationMinConfidence: Number.isFinite(confParsed)
      ? confParsed
      : 0.35,
  };
}
