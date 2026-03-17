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
 * Resolves Finwise account ID by bank, attachment filename, and optional email subject.
 * For Bank Zero: if BANK_ZERO_ACCOUNT_MAP is set, first pattern that matches (substring in subject + filename, case-insensitive) wins; else uses BANK_ZERO_ACCOUNT_ID.
 * Optional accountNumber on a mapping requires that number to appear in subject or filename (e.g. to distinguish "Transactional 80204387707" vs "Transactional 80204621122").
 */
export function getAccountIdForBankAndFilename(
  config: IngestWebhookConfig,
  bankCode: string,
  filename: string,
  subject?: string
): string | undefined {
  if (bankCode !== "bank_zero") {
    return getAccountIdForBank(config, bankCode);
  }
  const map = config.bankZeroAccountMap;
  if (map && map.length > 0) {
    const searchText = [subject, filename].filter(Boolean).join(" ").toLowerCase();
    for (const { pattern, accountId, accountNumber } of map) {
      const patternMatches =
        pattern === "" ||
        pattern === "*" ||
        searchText.includes(pattern.toLowerCase());
      const accountNumberMatches =
        accountNumber === undefined ||
        accountNumber === "" ||
        searchText.includes(accountNumber);
      if (patternMatches && accountNumberMatches) {
        return accountId;
      }
    }
  }
  return config.bankZeroAccountId || undefined;
}
