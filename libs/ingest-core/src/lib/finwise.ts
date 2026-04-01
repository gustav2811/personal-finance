import * as FinwiseNamespace from "@investments/finwise";
import type {
  CreateTransactionBody,
  FinWiseClient,
  FinWiseClientConfig,
} from "@investments/finwise";
import type { CanonicalTransaction } from "../parsers/types.js";

type FinwiseModule = typeof FinwiseNamespace & {
  default?: typeof FinwiseNamespace | (new (config: FinWiseClientConfig) => FinWiseClient);
};
const ns = FinwiseNamespace as FinwiseModule;
const withDefault =
  ns.default && typeof ns.default === "object" ? ns.default : ns;
const FinWiseClientCtorRaw =
  (typeof withDefault.FinWiseClient === "function"
    ? withDefault.FinWiseClient
    : null) ??
  (typeof ns.default === "function"
    ? (ns.default as new (config: FinWiseClientConfig) => FinWiseClient)
    : null);
const FinWiseApiError = withDefault.FinWiseApiError;
if (!FinWiseClientCtorRaw) {
  throw new Error(
    "@investments/finwise: FinWiseClient not found (ESM/CJS interop). Ensure the package exports FinWiseClient.",
  );
}
const FinWiseClientCtor = FinWiseClientCtorRaw as new (
  config: FinWiseClientConfig,
) => FinWiseClient;

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

function canonicalToCreateBody(tx: CanonicalTransaction): CreateTransactionBody {
  const description =
    tx.description?.trim() || tx.counterparty?.trim() || "Statement import";
  const notes = [tx.description, tx.counterparty].filter(Boolean).join(" | ");
  return {
    accountId: tx.account_id,
    date: tx.date,
    description,
    amount: { amount: tx.amount, currencyCode: tx.currency },
    notes: notes || undefined,
  };
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ProcessedStore {
  has(externalId: string): Promise<boolean>;
  add(externalId: string): Promise<void>;
}

export interface PostToFinwiseOptions {
  finwise: FinWiseClient;
  processedStore: ProcessedStore;
  transactions: CanonicalTransaction[];
  log: {
    info: (o: unknown, msg?: string) => void;
    warn: (o: unknown, msg?: string) => void;
    error: (o: unknown, msg?: string) => void;
  };
}

export async function postTransactionsToFinwise(
  opts: PostToFinwiseOptions,
): Promise<{
  created: number;
  skipped: number;
  failed: Array<{ external_id: string; error: string }>;
}> {
  const { finwise, processedStore, transactions, log } = opts;
  let created = 0;
  let skipped = 0;
  const failed: Array<{ external_id: string; error: string }> = [];

  for (const tx of transactions) {
    const already = await processedStore.has(tx.external_id);
    if (already) {
      skipped++;
      continue;
    }

    const body = canonicalToCreateBody(tx);
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        await finwise.transactions.create(body);
        await processedStore.add(tx.external_id);
        created++;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof FinWiseApiError) {
          if (err.status === 409) {
            await processedStore.add(tx.external_id).catch(() => {});
            skipped++;
            break;
          }
          if (!isRetryableStatus(err.status)) {
            failed.push({
              external_id: tx.external_id,
              error: err.message,
            });
            log.warn(
              { external_id: tx.external_id, status: err.status },
              "Finwise non-retryable error",
            );
            break;
          }
        }
        attempt++;
        if (attempt < MAX_RETRIES) {
          const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
          await sleep(delay);
        } else {
          failed.push({
            external_id: tx.external_id,
            error: lastError.message,
          });
          log.error(
            { external_id: tx.external_id, err: lastError },
            "Finwise create failed after retries",
          );
        }
      }
    }
  }

  return { created, skipped, failed };
}

export function createFinwiseClient(
  apiKey: string,
  baseUrl: string,
  logger?: {
    debug?: (msg: string, meta?: Record<string, unknown>) => void;
    error?: (msg: string, meta?: Record<string, unknown>) => void;
  },
): FinWiseClient {
  return new FinWiseClientCtor({
    apiKey,
    baseUrl,
    logger,
  });
}
