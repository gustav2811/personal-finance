import { describe, it, expect, vi } from "vitest";
import type { FinWiseClient } from "@investments/finwise";
import { categoriseTransactions } from "../pipeline.js";
import type { IngestCoreConfig } from "../../../config.js";
import type { CanonicalTransaction } from "../../../parsers/types.js";

const baseConfig: IngestCoreConfig = {
  finwiseApiKey: "fw",
  finwiseBaseUrl: "https://api.finwiseapp.io",
  supabaseUrl: "https://x.supabase.co",
  supabaseServiceRoleKey: "sk",
  bankZeroAccountId: "bz",
  bankZeroAccountMap: [],
  uploadToFinwise: true,
  categorisationEnabled: true,
  geminiApiKey: "",
  geminiModel: "gemini-3-flash-preview",
  geminiApiBase: "https://generativelanguage.googleapis.com",
  categorisationLlmTimeoutMs: 5000,
  categorisationMinConfidence: 0.35,
};

const meta = {
  bank: "bank_zero",
  source_email: "a@b.co",
  filename: "f.xlsx",
};

describe("categoriseTransactions", () => {
  it("returns clones unchanged when categorisation disabled", async () => {
    const finwise = {} as FinWiseClient;
    const txs: CanonicalTransaction[] = [
      {
        external_id: "1",
        account_id: "a",
        date: "2026-01-01",
        amount: -10,
        currency: "ZAR",
        description: "x",
        meta,
      },
    ];
    const out = await categoriseTransactions(
      { ...baseConfig, categorisationEnabled: false },
      finwise,
      txs,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).not.toBe(txs[0]);
    expect(out[0].external_id).toBe("1");
    expect(out[0].transaction_category_id).toBeUndefined();
  });

  it("applies rules using FinWise category map", async () => {
    const invId = "11111111-1111-1111-1111-111111111111";
    const finwise = {
      transactionCategories: {
        list: vi.fn().mockResolvedValue([
          { id: invId, name: "Investments" },
          { id: "22222222-2222-2222-2222-222222222222", name: "Coffee" },
        ]),
      },
    } as unknown as FinWiseClient;

    const txs: CanonicalTransaction[] = [
      {
        external_id: "e1",
        account_id: "a",
        date: "2026-03-23",
        amount: -3000,
        currency: "ZAR",
        counterparty: "Carina Van Der Colff",
        description: "TFSA",
        meta,
      },
    ];

    const out = await categoriseTransactions(
      { ...baseConfig, geminiApiKey: "" },
      finwise,
      txs,
      { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    );

    expect(out[0].transaction_category_id).toBe(invId);
    expect(out[0].classification_source).toBe("rule");
  });
});
