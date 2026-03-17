import { describe, it, expect } from "vitest";
import { getAccountIdForBankAndFilename } from "../bank-config.js";
import type { IngestWebhookConfig } from "../../config.js";

function configWithMap(
  map: IngestWebhookConfig["bankZeroAccountMap"],
  defaultId = "default-id"
): IngestWebhookConfig {
  return {
    ingestToken: "x",
    finwiseApiKey: "x",
    finwiseBaseUrl: "https://api.example.com",
    redisUrl: "redis://x",
    supabaseUrl: "https://x.supabase.co",
    supabaseServiceRoleKey: "x",
    bankZeroAccountId: defaultId,
    bankZeroAccountMap: map,
    uploadToFinwise: true,
    nodeEnv: "test",
    port: 3000,
  };
}

describe("getAccountIdForBankAndFilename", () => {
  it("returns accountId when pattern matches in filename", () => {
    const config = configWithMap([
      { pattern: "Savings", accountId: "savings-id" },
      { pattern: "Transactional", accountId: "tx-id" },
    ]);
    expect(
      getAccountIdForBankAndFilename(config, "bank_zero", "Feb 26 Savings.xlsx")
    ).toBe("savings-id");
    expect(
      getAccountIdForBankAndFilename(config, "bank_zero", "Mar 1 Transactional.xlsx")
    ).toBe("tx-id");
  });

  it("uses subject when provided and matches by pattern", () => {
    const config = configWithMap([
      { pattern: "EmergencySavings", accountId: "emergency-id" },
    ]);
    expect(
      getAccountIdForBankAndFilename(
        config,
        "bank_zero",
        "statement.xlsx",
        "Bank Zero – EmergencySavings statement"
      )
    ).toBe("emergency-id");
  });

  it("distinguishes two Transactional accounts by accountNumber in filename", () => {
    const config = configWithMap([
      { pattern: "Transactional", accountNumber: "80204387707", accountId: "tx-80204387707-id" },
      { pattern: "Transactional", accountNumber: "80204621122", accountId: "tx-80204621122-id" },
    ]);
    expect(
      getAccountIdForBankAndFilename(
        config,
        "bank_zero",
        "Transactional 80204387707 Mar 2026.xlsx"
      )
    ).toBe("tx-80204387707-id");
    expect(
      getAccountIdForBankAndFilename(
        config,
        "bank_zero",
        "Transactional 80204621122 Mar 2026.xlsx"
      )
    ).toBe("tx-80204621122-id");
  });

  it("distinguishes two Transactional accounts by accountNumber in subject", () => {
    const config = configWithMap([
      { pattern: "Transactional", accountNumber: "80204387707", accountId: "tx-A-id" },
      { pattern: "Transactional", accountNumber: "80204621122", accountId: "tx-B-id" },
    ]);
    expect(
      getAccountIdForBankAndFilename(
        config,
        "bank_zero",
        "Statement.xlsx",
        "Bank Zero Transactional 80204621122 statement"
      )
    ).toBe("tx-B-id");
    expect(
      getAccountIdForBankAndFilename(
        config,
        "bank_zero",
        "Statement.xlsx",
        "Bank Zero Transactional 80204387707"
      )
    ).toBe("tx-A-id");
  });

  it("falls back to default when no pattern matches", () => {
    const config = configWithMap([{ pattern: "Savings", accountId: "savings-id" }]);
    expect(
      getAccountIdForBankAndFilename(config, "bank_zero", "Other.xlsx")
    ).toBe("default-id");
  });

  it("does not match Transactional when accountNumber is missing from subject and filename", () => {
    const config = configWithMap([
      { pattern: "Transactional", accountNumber: "80204387707", accountId: "tx-A-id" },
      { pattern: "Transactional", accountNumber: "80204621122", accountId: "tx-B-id" },
    ]);
    expect(
      getAccountIdForBankAndFilename(config, "bank_zero", "Transactional statement.xlsx")
    ).toBe("default-id");
  });
});
