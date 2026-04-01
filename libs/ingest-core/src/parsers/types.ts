export interface CanonicalTransaction {
  external_id: string;
  account_id: string;
  date: string;
  amount: number;
  currency: string;
  description: string;
  counterparty?: string;
  balance?: number;
  raw?: Record<string, unknown>;
  meta: {
    bank: string;
    source_email: string;
    filename: string;
  };
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
