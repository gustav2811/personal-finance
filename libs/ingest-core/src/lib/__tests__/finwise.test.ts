import { describe, it, expect, vi } from "vitest";
import type { FinWiseClient } from "@investments/finwise";
import { postTransactionsToFinwise, ChunkIncomplete, CHUNK_SIZE } from "../finwise.js";
import type { CanonicalTransaction } from "../../parsers/types.js";

describe("postTransactionsToFinwise", () => {
  it("maps canonical transaction to CreateTransactionBody and calls create", async () => {
    const created: unknown[] = [];
    const finwise = {
      transactions: {
        create: vi.fn().mockImplementation(async (body: unknown) => {
          created.push(body);
          return { id: "tx-1" };
        }),
      },
    } as unknown as FinWiseClient;

    const processed = new Set<string>();
    const processedStore = {
      has: vi.fn().mockImplementation(async (id: string) => processed.has(id)),
      add: vi.fn().mockImplementation(async (id: string) => { processed.add(id); }),
      hasMany: vi.fn().mockImplementation(async (ids: string[]) =>
        new Set(ids.filter((id) => processed.has(id)))
      ),
      addMany: vi.fn().mockImplementation(async (ids: string[]) => {
        ids.forEach((id) => processed.add(id));
      }),
    };

    const tx: CanonicalTransaction = {
      external_id: "ext-1",
      account_id: "acc-1",
      date: "2026-01-15",
      amount: -100.5,
      currency: "ZAR",
      description: "PAYMENT",
      counterparty: "Shop",
      meta: { bank: "bank_zero", source_email: "a@b.co", filename: "f.xlsx" },
    };

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    const result = await postTransactionsToFinwise({
      finwise,
      processedStore,
      transactions: [tx],
      log,
    });

    expect(result.created).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.failed).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual({
      accountId: "acc-1",
      date: "2026-01-15",
      description: "PAYMENT",
      amount: { amount: -100.5, currencyCode: "ZAR" },
      notes: "PAYMENT | Shop",
    });
  });

  it("skips when processedStore.has returns true", async () => {
    const finwise = {
      transactions: { create: vi.fn() },
    } as unknown as FinWiseClient;
    const processedStore = {
      has: vi.fn().mockResolvedValue(true),
      add: vi.fn().mockResolvedValue(undefined),
      hasMany: vi.fn().mockImplementation(async (ids: string[]) => new Set(ids)),
      addMany: vi.fn().mockResolvedValue(undefined),
    };

    const tx: CanonicalTransaction = {
      external_id: "ext-1",
      account_id: "acc-1",
      date: "2026-01-15",
      amount: -100,
      currency: "ZAR",
      description: "X",
      meta: { bank: "b", source_email: "e", filename: "f" },
    };

    const result = await postTransactionsToFinwise({
      finwise,
      processedStore,
      transactions: [tx],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(finwise.transactions.create).not.toHaveBeenCalled();
  });

  it("throws ChunkIncomplete and only posts CHUNK_SIZE transactions when there are more pending", async () => {
    const finwise = {
      transactions: { create: vi.fn().mockResolvedValue({ id: "tx" }) },
    } as unknown as FinWiseClient;

    const processed = new Set<string>();
    const processedStore = {
      has: vi.fn(),
      add: vi.fn(),
      hasMany: vi.fn().mockImplementation(async (ids: string[]) =>
        new Set(ids.filter((id) => processed.has(id)))
      ),
      addMany: vi.fn().mockImplementation(async (ids: string[]) => {
        ids.forEach((id) => processed.add(id));
      }),
    };

    // Build CHUNK_SIZE + 5 transactions — more than one chunk
    const transactions: CanonicalTransaction[] = Array.from(
      { length: CHUNK_SIZE + 5 },
      (_, i) => ({
        external_id: `ext-${i}`,
        account_id: "acc-1",
        date: "2026-01-15",
        amount: -10,
        currency: "ZAR",
        description: `TX ${i}`,
        meta: { bank: "bank_zero", source_email: "a@b.co", filename: "f.xlsx" },
      }),
    );

    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    let caughtError: unknown;
    try {
      await postTransactionsToFinwise({ finwise, processedStore, transactions, log });
    } catch (err) {
      caughtError = err;
    }

    // Should throw ChunkIncomplete with the correct remaining count
    expect(caughtError).toBeInstanceOf(ChunkIncomplete);
    expect((caughtError as ChunkIncomplete).remaining).toBe(5);

    // Only CHUNK_SIZE FinWise calls should have been made
    expect(finwise.transactions.create).toHaveBeenCalledTimes(CHUNK_SIZE);

    // Those CHUNK_SIZE ids should be marked as processed
    expect(processedStore.addMany).toHaveBeenCalledWith(
      expect.arrayContaining(
        transactions.slice(0, CHUNK_SIZE).map((tx) => tx.external_id),
      ),
    );
  });
});
