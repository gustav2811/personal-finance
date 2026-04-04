/** v0 prompts — tune in this file after the pipeline is live. */

export const GEMINI_SYSTEM_PROMPT = `You label personal bank transactions for a South African user. Each transaction must be assigned exactly one category from the allowed list (exact string match required). Use counterparty/merchant as the main signal; use memo/description for transfers and internal buckets (e.g. savings, mortgage, investment). Prefer specific categories over generic ones when evidence is strong. If unclear, pick the closest category and lower confidence. Output valid JSON only matching the schema; no markdown.`;

export function buildGeminiUserPrompt(
  allowedCategoriesJson: string,
  transactionsJson: string,
): string {
  return `Allowed categories (choose categoryName from this list only):
${allowedCategoriesJson}

Transactions (classify each by id):
${transactionsJson}

Each transaction object fields: id, counterparty, description, amount (negative=debit, positive=credit), transactionType (if known).

Return a JSON array with one object per id: { "id", "categoryName", "confidence" (0-1), "rationale" (short string) }.`;
}
