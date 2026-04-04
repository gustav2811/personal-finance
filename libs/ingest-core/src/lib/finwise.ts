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

/**
 * Max FinWise creates per queue retry invocation under the Workers free-plan cap (~50
 * subrequests). Budget per successful chunk is roughly: 1 hasMany + K creates + 1 addMany,
 * plus P category list pages + L batched LLM when categorisation runs earlier in the same
 * invocation (see process-job). Keep K conservative so DLQ and retries still have headroom.
 */
export const CHUNK_SIZE = 40;

/** Thrown when a statement has more pending transactions than CHUNK_SIZE allows in one invocation. */
export class ChunkIncomplete extends Error {
  readonly remaining: number;
  constructor(remaining: number) {
    super(
      `postTransactionsToFinwise: ${remaining} transaction(s) deferred to next invocation`,
    );
    this.name = "ChunkIncomplete";
    this.remaining = remaining;
  }
}

function canonicalToCreateBody(tx: CanonicalTransaction): CreateTransactionBody {
  const description =
    tx.description?.trim() || tx.counterparty?.trim() || "Statement import";
  const notes = [tx.description, tx.counterparty].filter(Boolean).join(" | ");
  const body: CreateTransactionBody = {
    accountId: tx.account_id,
    date: tx.date,
    description,
    amount: { amount: tx.amount, currencyCode: tx.currency },
    notes: notes || undefined,
  };
  if (tx.transaction_category_id) {
    body.transactionCategoryId = tx.transaction_category_id;
  }
  return body;
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
  hasMany(externalIds: string[]): Promise<Set<string>>;
  addMany(externalIds: string[]): Promise<void>;
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

  // Single bulk check: 1 subrequest instead of N
  const allIds = transactions.map((tx) => tx.external_id);
  const alreadyProcessed = await processedStore.hasMany(allIds);

  // Separate already-done from pending, then cap at CHUNK_SIZE
  const pending = transactions.filter((tx) => !alreadyProcessed.has(tx.external_id));
  skipped += transactions.length - pending.length;

  const chunk = pending.slice(0, CHUNK_SIZE);
  const toMarkProcessed: string[] = [];

  for (const tx of chunk) {
    const body = canonicalToCreateBody(tx);
    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
      try {
        await finwise.transactions.create(body);
        toMarkProcessed.push(tx.external_id);
        created++;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof FinWiseApiError) {
          if (err.status === 409) {
            toMarkProcessed.push(tx.external_id);
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

  // Single bulk write: 1 subrequest instead of N
  if (toMarkProcessed.length > 0) {
    await processedStore.addMany(toMarkProcessed).catch((err: unknown) => {
      log.warn(
        { err, count: toMarkProcessed.length },
        "processedStore.addMany failed; transactions posted but not marked as processed",
      );
    });
  }

  // If more transactions remain beyond this chunk, throw so the queue retries
  // the message with a fresh subrequest budget for the next chunk.
  const remaining = pending.length - chunk.length;
  if (remaining > 0) {
    log.info(
      { remaining, chunk_processed: chunk.length, created, skipped },
      "postTransactionsToFinwise: chunk complete, deferring remaining to next invocation",
    );
    throw new ChunkIncomplete(remaining);
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
