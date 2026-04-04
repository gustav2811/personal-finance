/**
 * Port for batched LLM categorisation (one HTTP subrequest per batch).
 */

export interface CategorisationRowInput {
  id: string;
  counterparty: string;
  description: string;
  amount: number;
  transactionType: string;
}

export interface LlmClassification {
  categoryName: string;
  confidence: number;
  rationale?: string;
}

export interface BatchTransactionCategoriser {
  classifyBatch(input: {
    rows: CategorisationRowInput[];
    allowedCategoryNames: string[];
  }): Promise<Map<string, LlmClassification>>;
}
