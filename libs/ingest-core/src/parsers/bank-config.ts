import type { IngestCoreConfig } from "../config.js";

export function getAccountIdForBank(
  config: IngestCoreConfig,
  bankCode: string,
): string | undefined {
  switch (bankCode) {
    case "bank_zero":
      return config.bankZeroAccountId || undefined;
    default:
      return undefined;
  }
}

export function getAccountIdForBankAndFilename(
  config: IngestCoreConfig,
  bankCode: string,
  filename: string,
  subject?: string,
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
