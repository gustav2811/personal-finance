export interface BankZeroAccountMapping {
  pattern: string;
  accountId: string;
  accountNumber?: string;
}

/** Shared config for ingest processing (Finwise, Supabase DLQ, bank mapping). */
export interface IngestCoreConfig {
  finwiseApiKey: string;
  finwiseBaseUrl: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  bankZeroAccountId: string;
  bankZeroAccountMap: BankZeroAccountMapping[];
  uploadToFinwise: boolean;
}

export function parseBankZeroAccountMapJson(raw: string): BankZeroAccountMapping[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
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
  } catch {
    return [];
  }
}
