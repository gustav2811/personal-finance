import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { FinWiseApiError, type FinWiseClient, type Transaction } from "@investments/finwise";
import type { IngestCoreConfig } from "../config.js";

type OutboxClaim = {
  outbox_id: string;
  operation_id: string;
  operation: "create" | "update" | "project";
  household_id: string;
  movement_id: string;
  finwise_transaction_id: string | null;
  exact_request: Record<string, unknown>;
  attempt_count: number;
};

export interface BankZeroPublicationLogger {
  info: (fields: unknown, message?: string) => void;
  warn: (fields: unknown, message?: string) => void;
  error: (fields: unknown, message?: string) => void;
}

const supabaseClients = new Map<string, SupabaseClient>();

function supabaseFor(config: IngestCoreConfig): SupabaseClient {
  const key = `${config.supabaseUrl}\u0000${config.supabaseServiceRoleKey}`;
  let client = supabaseClients.get(key);
  if (!client) {
    client = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    supabaseClients.set(key, client);
  }
  return client;
}

function asClaims(value: unknown): OutboxClaim[] {
  if (!Array.isArray(value)) throw new Error("Outbox claim returned an invalid list");
  return value.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Outbox claim returned an invalid operation");
    }
    const row = entry as Record<string, unknown>;
    if (
      typeof row.outbox_id !== "string" || typeof row.operation_id !== "string" ||
      (row.operation !== "create" && row.operation !== "update" && row.operation !== "project") ||
      typeof row.household_id !== "string" || typeof row.movement_id !== "string" ||
      typeof row.attempt_count !== "number" || !row.exact_request ||
      typeof row.exact_request !== "object" || Array.isArray(row.exact_request)
    ) throw new Error("Outbox claim returned an invalid operation shape");
    return row as unknown as OutboxClaim;
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function occurredOn(date: string): string {
  if (!Number.isFinite(Date.parse(date))) throw new Error("FinWise response has an invalid transaction date");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(date));
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function normalizeTransaction(transaction: Transaction): Record<string, unknown> {
  if (!transaction.id || !transaction.accountId || !transaction.date || !transaction.amount) {
    throw new Error("FinWise create response is missing transaction identity, account, date, or amount");
  }
  const payload = {
    id: transaction.id,
    accountId: transaction.accountId,
    date: transaction.date,
    effectiveDate: transaction.effectiveDate ?? null,
    description: transaction.description ?? "",
    originalDescription: transaction.originalDescription ?? null,
    amount: transaction.amount.amount,
    currencyCode: transaction.amount.currencyCode,
    occurredOn: occurredOn(transaction.date),
    transactionCategoryId: transaction.transactionCategoryId ?? null,
    categoryName: null,
    originalTransactionCategoryId: transaction.originalTransactionCategoryId ?? null,
    merchantId: transaction.merchantId ?? null,
    merchantName: null,
    parentTransactionId: transaction.parentTransactionId ?? null,
    isTransfer: transaction.isTransfer ?? null,
    isPending: transaction.isPending ?? null,
    archived: Boolean(transaction.archivedAt),
    updatedAt: transaction.updatedAt,
    notes: transaction.notes ?? null,
  };
  return { ...payload, rawPayloadHash: createHash("sha256").update(stableJson(payload)).digest("hex") };
}

function retryDelaySeconds(attempt: number): number {
  return Math.min(60 * 2 ** Math.max(attempt - 1, 0), 3600);
}

async function finishFailure(
  client: SupabaseClient,
  claim: OutboxClaim,
  state: "retryable_failure" | "outcome_unknown" | "terminal_failure" | "needs_review",
  error: unknown,
): Promise<void> {
  const delay = state === "retryable_failure" ? retryDelaySeconds(claim.attempt_count) : 0;
  const { error: rpcError } = await client.rpc("bank_zero_finish_publication_v1", {
    p_operation_id: claim.operation_id,
    p_state: state,
    p_error: error instanceof Error ? error.message : String(error),
    p_retry_delay_seconds: delay,
  });
  if (rpcError) throw new Error(`Could not persist publication outcome: ${rpcError.message}`);
}

async function projectTransaction(
  client: SupabaseClient,
  claim: OutboxClaim,
  log: BankZeroPublicationLogger,
): Promise<void> {
  const payload = claim.exact_request;
  const { data: syncRunId, error: startError } = await client.rpc("finance_start_sync_run", {
    p_household_id: claim.household_id,
    p_source_system: "finwise",
  });
  if (startError || typeof syncRunId !== "string") {
    throw new Error(`Could not start FinWise projection sync: ${startError?.message ?? "missing sync run id"}`);
  }
  try {
    const { error: upsertError } = await client.rpc("finance_upsert_source_transaction", {
      p_household_id: claim.household_id,
      p_sync_run_id: syncRunId,
      p_payload: payload,
    });
    if (upsertError) throw new Error(`Could not project FinWise transaction: ${upsertError.message}`);
    const { error: finishRunError } = await client.rpc("finance_finish_sync_run", {
      p_sync_run_id: syncRunId,
      p_status: "succeeded",
      p_error: null,
    });
    if (finishRunError) throw new Error(`Could not finish FinWise projection sync: ${finishRunError.message}`);
  } catch (error) {
    await client.rpc("finance_finish_sync_run", {
      p_sync_run_id: syncRunId,
      p_status: "failed",
      p_error: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
    });
    throw error;
  }
  const { error: finishError } = await client.rpc("bank_zero_finish_projection_v1", {
    p_operation_id: claim.operation_id,
    p_succeeded: true,
  });
  if (finishError) throw new Error(`Could not persist projection completion: ${finishError.message}`);
  log.info({ movement_id: claim.movement_id, finwise_transaction_id: claim.finwise_transaction_id }, "bank_zero_finwise_projection_completed");
}

class BankZeroUpdateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BankZeroUpdateConflictError";
  }
}

async function updateTransaction(
  client: SupabaseClient,
  finwise: FinWiseClient,
  claim: OutboxClaim,
  log: BankZeroPublicationLogger,
): Promise<boolean> {
  const request = claim.exact_request;
  const remoteId = request.finwise_transaction_id;
  const accountId = request.account_id;
  const amount = request.amount;
  const currencyCode = request.currency_code;
  const expected = request.expected;
  const patch = request.patch;
  if (
    typeof remoteId !== "string" || typeof accountId !== "string" ||
    typeof amount !== "number" || typeof currencyCode !== "string" ||
    !expected || typeof expected !== "object" || Array.isArray(expected) ||
    !patch || typeof patch !== "object" || Array.isArray(patch)
  ) throw new Error("FinWise update request is incomplete");
  const expectedFields = expected as Record<string, unknown>;
  const patchFields = patch as Record<string, unknown>;
  const currentRows = await finwise.transactions.list({
    filters: { id: remoteId },
    pagination: { pageNumber: 1, pageSize: 10 },
  });
  const candidates = currentRows.filter((row) => row.id === remoteId);
  if (candidates.length !== 1) throw new BankZeroUpdateConflictError("Retained FinWise transaction is missing or ambiguous");
  const current = candidates[0];
  if (
    current.accountId !== accountId || current.amount?.amount !== amount ||
    current.amount?.currencyCode !== currencyCode
  ) throw new BankZeroUpdateConflictError("FinWise transaction identity no longer matches the recorded movement");

  const supportedPatchKeys = new Set(["description", "notes", "isTransfer"]);
  if (Object.keys(patchFields).some((key) => !supportedPatchKeys.has(key))) {
    throw new Error("FinWise update request contains an unsupported field");
  }
  const remoteField = (key: string): unknown => {
    if (key === "notes") return current.notes ?? null;
    if (key === "isTransfer") return current.isTransfer ?? null;
    return current.description ?? "";
  };
  const isAlreadyUpdated = Object.entries(patchFields)
    .every(([key, value]) => remoteField(key) === value);
  const matchesExpected = Object.entries(expectedFields)
    .every(([key, value]) => remoteField(key) === value);
  if (!isAlreadyUpdated && !matchesExpected) {
    throw new BankZeroUpdateConflictError("FinWise fields changed outside the importer; review is required");
  }
  const updated = isAlreadyUpdated
    ? current
    : await finwise.transactions.update(remoteId, patchFields as never);
  const normalized = normalizeTransaction(updated);
  const { error } = await client.rpc("bank_zero_record_finwise_update_v1", {
    p_operation_id: claim.operation_id,
    p_finwise_transaction_id: remoteId,
    p_normalized_transaction: normalized,
  });
  if (error) throw new Error(`FinWise update completed but its identity could not be recorded: ${error.message}`);
  const projectionClaim = {
    ...claim,
    operation: "project" as const,
    finwise_transaction_id: remoteId,
    exact_request: normalized,
  };
  try {
    await projectTransaction(client, projectionClaim, log);
    return true;
  } catch (error) {
    const { error: finishError } = await client.rpc("bank_zero_finish_projection_v1", {
      p_operation_id: claim.operation_id,
      p_succeeded: false,
      p_error: error instanceof Error ? error.message : String(error),
      p_retry_delay_seconds: retryDelaySeconds(claim.attempt_count),
    });
    if (finishError) throw new Error(`Projection recovery could not be recorded: ${finishError.message}`);
    log.error({ movement_id: claim.movement_id, finwise_transaction_id: remoteId, err: error }, "bank_zero_finwise_projection_failed");
    return false;
  }
}

/** Claims and processes bounded publication work. Creates are never blindly retried. */
export async function processBankZeroPublicationBatch(
  config: IngestCoreConfig,
  finwise: FinWiseClient,
  workerId: string,
  log: BankZeroPublicationLogger,
  limit = 5,
): Promise<{ claimed: number; published: number; deferred: number }> {
  const client = supabaseFor(config);
  const { data, error } = await client.rpc("bank_zero_claim_publication_v1", {
    p_worker_id: workerId,
    p_limit: limit,
  });
  if (error) throw new Error(`Could not claim Bank Zero publication work: ${error.message}`);
  const claims = asClaims(data);
  let published = 0;
  let deferred = 0;

  for (const claim of claims) {
    if (claim.operation === "project") {
      try {
        await projectTransaction(client, claim, log);
        published++;
      } catch (error) {
        const { error: finishError } = await client.rpc("bank_zero_finish_projection_v1", {
          p_operation_id: claim.operation_id,
          p_succeeded: false,
          p_error: error instanceof Error ? error.message : String(error),
          p_retry_delay_seconds: retryDelaySeconds(claim.attempt_count),
        });
        if (finishError) throw new Error(`Projection recovery could not be recorded: ${finishError.message}`);
        deferred++;
        log.error({ movement_id: claim.movement_id, err: error }, "bank_zero_finwise_projection_failed");
      }
      continue;
    }

    if (claim.operation === "update") {
      try {
        if (await updateTransaction(client, finwise, claim, log)) published++;
        else deferred++;
      } catch (error) {
        const state = error instanceof BankZeroUpdateConflictError
          ? "needs_review"
          : error instanceof FinWiseApiError && error.status >= 400 && error.status < 500 && error.status !== 429
            ? "terminal_failure"
            : "retryable_failure";
        await finishFailure(client, claim, state, error);
        deferred++;
        log.error({ movement_id: claim.movement_id, finwise_transaction_id: claim.finwise_transaction_id, err: error }, "bank_zero_finwise_update_failed");
      }
      continue;
    }

    try {
      const created = await finwise.transactions.create(claim.exact_request as never);
      const normalized = normalizeTransaction(created);
      const { error: recordError } = await client.rpc("bank_zero_record_finwise_create_v1", {
        p_operation_id: claim.operation_id,
        p_finwise_transaction_id: created.id,
        p_normalized_transaction: normalized,
      });
      if (recordError) {
        await finishFailure(client, claim, "outcome_unknown", new Error(`FinWise created ${created.id}, but persisting its identity failed: ${recordError.message}`));
        deferred++;
        continue;
      }
      const projectionClaim = { ...claim, operation: "project" as const, finwise_transaction_id: created.id, exact_request: normalized };
      try {
        await projectTransaction(client, projectionClaim, log);
        published++;
      } catch (error) {
        const { error: finishError } = await client.rpc("bank_zero_finish_projection_v1", {
          p_operation_id: claim.operation_id,
          p_succeeded: false,
          p_error: error instanceof Error ? error.message : String(error),
          p_retry_delay_seconds: retryDelaySeconds(claim.attempt_count),
        });
        if (finishError) throw new Error(`Projection recovery could not be recorded: ${finishError.message}`);
        deferred++;
        log.error({ movement_id: claim.movement_id, finwise_transaction_id: created.id, err: error }, "bank_zero_finwise_projection_failed");
      }
    } catch (error) {
      if (error instanceof FinWiseApiError && error.status >= 400 && error.status < 500) {
        const state = error.status === 429 ? "retryable_failure" : "terminal_failure";
        await finishFailure(client, claim, state, error);
      } else {
        await finishFailure(client, claim, "outcome_unknown", error);
      }
      deferred++;
      log.error({ movement_id: claim.movement_id, operation_id: claim.operation_id, err: error }, "bank_zero_finwise_create_failed");
    }
  }

  return { claimed: claims.length, published, deferred };
}
