import { closedWindow } from "./dates.js";
import { IsmrtClient, type IsmrtCredentials } from "./ismrt.js";
import { buildConsumptionBatch, mergeBatches, type ConsumptionBatch } from "./map.js";
import { ConsumptionRpc } from "./supabase.js";
import type { SubrequestUsage } from "../jobs/budget.js";

export type ConsumptionEnv = {
  ISMRT_USERNAME: string;
  ISMRT_PASSWORD: string;
  ISMRT_HOUSEHOLD_ID: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  ISMRT_LOOKBACK_DAYS?: string;
};

export type RunSummary = {
  wallets: number;
  readings: number;
  ledgerEntries: number;
  documents: number;
  windowStart: string;
  windowEnd: string;
  rpc: unknown;
};

export async function runConsumptionSync(
  env: ConsumptionEnv,
  now: Date,
  fetchImpl: typeof fetch = fetch,
  jobId?: string,
): Promise<RunSummary> {
  const startedAt = now.toISOString();
  const lookback = Number(env.ISMRT_LOOKBACK_DAYS ?? "45");
  const window = closedWindow(now, lookback);
  const rpc = openRpc(env, fetchImpl);
  try {
    const householdId = requiredHouseholdId(env.ISMRT_HOUSEHOLD_ID);
    const batch = await pullBatch(credentials(env), window, startedAt, fetchImpl);
    const result = await rpc.ingest(batch);
    const wallets = batch.devices.filter(
      (device) => device.source === "ismrt" && device.kind === "wallet",
    );
    for (const wallet of wallets) {
      if (typeof wallet.external_id !== "string" || wallet.external_id.length === 0) {
        throw new Error("ISMRT batch contains a wallet without an external ID");
      }
      await rpc.provisionIsmrtOwnership(householdId, wallet.external_id);
    }
    return {
      wallets: wallets.length,
      readings: batch.readings.length,
      ledgerEntries: batch.ledger_entries.length,
      documents: batch.documents.length,
      windowStart: window.start,
      windowEnd: window.end,
      rpc: result,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "ismrt sync failed";
    await rpc.recordFailure({
      startedAt,
      windowStart: window.start,
      windowEnd: window.end,
      error: message,
    }).catch((auditErr: unknown) => {
      console.log(
        JSON.stringify({
          level: "warn",
          msg: "ismrt_failure_audit_failed",
          component: "ingest-consumer",
          ...(jobId === undefined ? {} : { job_id: jobId }),
          error: auditErr instanceof Error ? auditErr.message : "unknown",
        }),
      );
    });
    throw err;
  }
}

function requiredHouseholdId(value: string | undefined): string {
  const householdId = value?.trim();
  if (!householdId) {
    throw new Error("missing ISMRT_HOUSEHOLD_ID; utility ownership cannot be provisioned");
  }
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(householdId)) {
    throw new Error("ISMRT_HOUSEHOLD_ID must be a UUID");
  }
  return householdId;
}

async function pullBatch(
  creds: IsmrtCredentials,
  window: { start: string; end: string },
  fetchedAt: string,
  fetchImpl: typeof fetch,
): Promise<ConsumptionBatch> {
  const client = new IsmrtClient(creds, fetchImpl);
  await client.authenticate();
  const wallets = (await client.listWallets()).filter((wallet) => wallet.isActive);
  if (wallets.length === 0) throw new Error("ISMRT returned no active wallets");

  const batches = await Promise.all(
    wallets.map(async (wallet) => {
      const [meters, expenses, deposits, invoices, proofs] = await Promise.all([
        client.listMeters(wallet.id),
        client.listExpenses(wallet.id, window.start, window.end),
        client.listDeposits(wallet.id, window.start, window.end),
        client.listInvoices(wallet.id, window.start, window.end),
        client.listProofs(wallet.id, window.start, window.end),
      ]);
      if (meters.length === 0) throw new Error(`wallet ${wallet.id} has no electricity meter`);
      const profiles = await Promise.all(
        meters.map((meter) => client.meterProfile(meter.serial, window.start, window.end)),
      );
      return buildConsumptionBatch({
        wallet,
        meters,
        expenses,
        deposits,
        invoices,
        proofs,
        profiles,
        windowStart: window.start,
        windowEnd: window.end,
        fetchedAt,
      });
    }),
  );
  return mergeBatches(batches, fetchedAt);
}

function credentials(env: ConsumptionEnv): IsmrtCredentials {
  const username = env.ISMRT_USERNAME?.trim();
  const password = env.ISMRT_PASSWORD?.trim();
  if (!username || !password) throw new Error("missing ISMRT credentials");
  return { username, password };
}

function openRpc(env: ConsumptionEnv, fetchImpl: typeof fetch): ConsumptionRpc {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_KEY?.trim();
  if (!url || !key) throw new Error("missing supabase credentials");
  return new ConsumptionRpc(url, key, fetchImpl);
}

export function logSummary(
  summary: RunSummary,
  jobId?: string,
  subrequestsUsed?: SubrequestUsage,
): void {
  console.log(
    JSON.stringify({
      component: "ingest-consumer",
      msg: "ismrt_consumption_sync",
      ...(jobId === undefined ? {} : { job_id: jobId }),
      ...(subrequestsUsed === undefined
        ? {}
        : { subrequests_used: subrequestsUsed }),
      wallets: summary.wallets,
      readings: summary.readings,
      ledger_entries: summary.ledgerEntries,
      documents: summary.documents,
      window_start: summary.windowStart,
      window_end: summary.windowEnd,
    }),
  );
}
