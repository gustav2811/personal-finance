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
  /** When true, fetch FinWise categories and assign transaction_category_id (rules + batched Gemini). */
  categorisationEnabled: boolean;
  /** Google AI Gemini API key (Worker secret). Empty disables LLM; rules still apply. */
  geminiApiKey: string;
  geminiModel: string;
  /** REST host only, e.g. https://generativelanguage.googleapis.com */
  geminiApiBase: string;
  categorisationLlmTimeoutMs: number;
  /** 0–1; below this, FinWise create omits category even if the model returned a name. */
  categorisationMinConfidence: number;
}
