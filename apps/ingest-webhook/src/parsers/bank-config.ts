import type { IngestWebhookConfig } from "../config.js";

/**
 * Resolves Finwise account ID for a bank. Use this when you don't have a filename.
 */
export function getAccountIdForBank(
  config: IngestWebhookConfig,
  bankCode: string
): string | undefined {
  switch (bankCode) {
    case "bank_zero":
      return config.bankZeroAccountId || undefined;
    default:
      return undefined;
  }
}

/**
 * Resolves Finwise account ID by bank and attachment filename.
 * For Bank Zero: if BANK_ZERO_ACCOUNT_MAP is set, first pattern that matches (substring in filename, case-insensitive) wins; else uses BANK_ZERO_ACCOUNT_ID.
 * Enables multiple statements (e.g. "Feb 26 Savings.xlsx" vs "Feb 26 Transactions.xlsx") to map to different accounts.
 */
export function getAccountIdForBankAndFilename(
  config: IngestWebhookConfig,
  bankCode: string,
  filename: string
): string | undefined {
  if (bankCode !== "bank_zero") {
    return getAccountIdForBank(config, bankCode);
  }
  const map = config.bankZeroAccountMap;
  if (map && map.length > 0) {
    const lower = filename.toLowerCase();
    for (const { pattern, accountId } of map) {
      if (pattern === "" || pattern === "*" || lower.includes(pattern.toLowerCase())) {
        return accountId;
      }
    }
  }
  return config.bankZeroAccountId || undefined;
}
