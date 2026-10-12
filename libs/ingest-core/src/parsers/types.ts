export type ClassificationSource =
  | "rule"
  | "llm"
  | "llm_error"
  | "none";

export interface CanonicalTransaction {
  external_id: string;
  account_id: string;
  date: string;
  amount: number;
  /** Separate statement fee amount when the bank supplies it as a distinct column. */
  fee?: number;
  currency: string;
  description: string;
  counterparty?: string;
  /** When set, FinWise `notes` uses this only; otherwise notes default to `description | counterparty`. */
  notes?: string;
  balance?: number;
  raw?: Record<string, unknown>;
  meta: {
    bank: string;
    source_email: string;
    filename: string;
    /** Bank-local event timestamp when the statement supplies time precision. */
    bank_event_at?: string;
    event_precision?: "minute" | "day";
    statement_sheet?: string;
    statement_row?: number;
  };
  /** FinWise UUID when categorisation assigned a category above confidence threshold */
  transaction_category_id?: string;
  classification_source?: ClassificationSource;
  classification_confidence?: number;
}

export interface ParserContext {
  bank: string;
  source_email: string;
  filename: string;
  account_id: string;
}

export type BankParser = (
  buffer: Uint8Array | Buffer,
  ctx: ParserContext,
) => Promise<CanonicalTransaction[]> | CanonicalTransaction[];

export interface BankConfig {
  account_id: string;
  from_domains?: string[];
  to_local_parts?: string[];
  filename_patterns?: string[];
  columns?: {
    date?: string[];
    description?: string[];
    amount?: string[];
    balance?: string[];
    counterparty?: string[];
    reference?: string[];
  };
}
