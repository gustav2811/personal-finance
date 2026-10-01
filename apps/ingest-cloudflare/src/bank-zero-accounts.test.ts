import { describe, expect, it } from "vitest";
import type { IngestCoreConfig } from "@investments/ingest-core";
import { getAccountIdForBankAndFilename } from "../../../libs/ingest-core/src/parsers/bank-config.js";
import { bankZeroAccountMap } from "./bank-zero-accounts.js";

function config(): IngestCoreConfig {
  return {
    finwiseApiKey: "x",
    finwiseBaseUrl: "https://api.example.com",
    supabaseUrl: "https://x.supabase.co",
    supabaseServiceRoleKey: "x",
    bankZeroAccountId: "",
    bankZeroAccountMap,
    uploadToFinwise: false,
    categorisationEnabled: false,
    geminiApiKey: "",
    geminiModel: "gemini-gemini-3-flash-preview",
    geminiApiBase: "https://generativelanguage.googleapis.com",
    categorisationLlmTimeoutMs: 45_000,
    categorisationMinConfidence: 0.35,
  };
}

describe("bank zero account map", () => {
  it("routes the September statements that missed the old map", () => {
    const accounts = config();
    expect(
      getAccountIdForBankAndFilename(
        accounts,
        "bank_zero",
        "Euro Trip Notice 32 Day Notice September2026.xls",
      ),
    ).toBe("80d18c07-c69a-4354-bbb1-0773aef4b83a");
    expect(
      getAccountIdForBankAndFilename(
        accounts,
        "bank_zero",
        "Loft space Savings September2026.xls",
      ),
    ).toBe("c5b35700-298e-4a9f-bbc2-95314a59b827");
    expect(
      getAccountIdForBankAndFilename(
        accounts,
        "bank_zero",
        "Gifts Savings September2026.xls",
      ),
    ).toBe("43dc381f-4322-4702-b7df-2a9a67e97211");
  });

  it("keeps the broader gifts and notice rows from stealing specific accounts", () => {
    const accounts = config();
    expect(
      getAccountIdForBankAndFilename(
        accounts,
        "bank_zero",
        "Wedding Gifts Savings September2026.xls",
      ),
    ).toBe("0df59676-4a8a-4975-a263-af69687de2e8");
    expect(
      getAccountIdForBankAndFilename(
        accounts,
        "bank_zero",
        "32-day notice September2026.xls",
      ),
    ).toBe("a2aaf332-69d5-4c06-a91d-bfde03a5dd1a");
  });
});
