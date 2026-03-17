import "dotenv/config";

export interface BankZeroAccountMapping {
  /** Substring to match in filename/subject (case-insensitive). First match wins. Use "" or "*" for default. */
  pattern: string;
  accountId: string;
  /** Optional: require this account number in subject or filename to match. Use to distinguish multiple accounts with same pattern (e.g. two Transactional accounts). */
  accountNumber?: string;
}

export interface IngestWebhookConfig {
  ingestToken: string;
  finwiseApiKey: string;
  finwiseBaseUrl: string;
  redisUrl: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** Default Finwise account for Bank Zero when no filename pattern matches */
  bankZeroAccountId: string;
  /** Optional: map filename patterns to account IDs (e.g. "Savings" → savings account). First match wins. */
  bankZeroAccountMap: BankZeroAccountMapping[];
  /** When false, worker processes and logs transactions but does not upload to Finwise. */
  uploadToFinwise: boolean;
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
  const bankZeroAccountMapRaw = process.env.BANK_ZERO_ACCOUNT_MAP ?? "[]";
  let bankZeroAccountMap: BankZeroAccountMapping[] = [];
  try {
    const parsed = JSON.parse(bankZeroAccountMapRaw) as unknown;
    if (Array.isArray(parsed)) {
      bankZeroAccountMap = parsed.filter(
        (x): x is BankZeroAccountMapping =>
          x != null &&
          typeof x === "object" &&
          "pattern" in x &&
          "accountId" in x &&
          typeof (x as BankZeroAccountMapping).pattern === "string" &&
          typeof (x as BankZeroAccountMapping).accountId === "string" &&
          ((x as BankZeroAccountMapping).accountNumber === undefined ||
            typeof (x as BankZeroAccountMapping).accountNumber === "string"),
      );
    }
  } catch {
    // ignore invalid JSON; use empty map
  }

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
