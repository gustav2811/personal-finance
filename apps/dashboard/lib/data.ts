import { getConsumptionClient, getPublicClient } from "./supabase-browser";

export type ConsumptionDevice = {
  id: string;
  source: string;
  external_id: string;
  kind: string;
  name: string;
  utility_type: string | null;
  location: string | null;
  timezone: string;
  active_from: string | null;
  active_to: string | null;
  metadata: Record<string, unknown>;
};

export type ConsumptionReading = {
  id: string;
  device_id: string;
  source: string;
  source_record_id: string;
  period_start: string;
  period_end: string;
  metric: string;
  measurement_target: string;
  value: number;
  unit: string;
  quality: string;
  metadata: Record<string, unknown>;
};

export type ConsumptionLedgerEntry = {
  id: string;
  source: string;
  source_record_id: string;
  device_id: string;
  utility_type: string;
  entry_type: string;
  direction: "debit" | "credit";
  amount: number;
  currency: string;
  quantity: number | null;
  quantity_unit: string | null;
  rate: number | null;
  occurred_at: string | null;
  posted_at: string | null;
  description: string | null;
  reference: string | null;
  metadata: Record<string, unknown>;
};

export type IngestionRun = {
  id: string;
  source: string;
  runner: string;
  status: "running" | "succeeded" | "failed";
  started_at: string;
  finished_at: string | null;
  rows_fetched: number;
  rows_written: number;
};

export type FinancialTransaction = {
  id: string;
  account_id: string;
  date: string;
  details: unknown;
};

export type FinancialSnapshot = {
  account_id: string;
  date: string;
  amount_cents: number;
  currency_code: string;
};

export type DashboardData = {
  devices: ConsumptionDevice[];
  readings: ConsumptionReading[];
  ledgerEntries: ConsumptionLedgerEntry[];
  ingestionRuns: IngestionRun[];
  financialTransactions: FinancialTransaction[];
  financialSnapshots: FinancialSnapshot[];
  financialError: string | null;
  fetchedAt: string;
};

function asRows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function assertSuccessful(
  error: { message?: string } | null,
  source: string,
): void {
  if (error) {
    throw new Error(`Unable to read ${source} data.`);
  }
}

export async function fetchDashboardData(): Promise<DashboardData> {
  const consumption = getConsumptionClient();
  const publicClient = getPublicClient();
  const fromDate = new Date(
    Date.now() - 366 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const [
    devicesResponse,
    readingsResponse,
    ledgerResponse,
    runsResponse,
    financialResponse,
  ] = await Promise.all([
    consumption
      .from("devices")
      .select(
        "id,source,external_id,kind,name,utility_type,location,timezone,active_from,active_to,metadata",
      )
      .order("name"),
    consumption
      .from("readings")
      .select(
        "id,device_id,source,source_record_id,period_start,period_end,metric,measurement_target,value,unit,quality,metadata",
      )
      .gte("period_start", fromDate)
      .order("period_start"),
    consumption
      .from("ledger_entries")
      .select(
        "id,source,source_record_id,device_id,utility_type,entry_type,direction,amount,currency,quantity,quantity_unit,rate,occurred_at,posted_at,description,reference,metadata",
      )
      .gte("occurred_at", fromDate)
      .order("occurred_at"),
    consumption
      .from("ingestion_runs")
      .select(
        "id,source,runner,status,started_at,finished_at,rows_fetched,rows_written",
      )
      .order("started_at", { ascending: false })
      .limit(100),
    Promise.all([
      publicClient
        .from("transactions")
        .select("id,account_id,date,details")
        .gte("date", fromDate)
        .order("date", { ascending: false })
        .limit(5000),
      publicClient
        .from("snapshots")
        .select("account_id,date,amount_cents,currency_code")
        .gte("date", fromDate)
        .order("date", { ascending: false })
        .limit(5000),
    ]),
  ]);

  assertSuccessful(devicesResponse.error, "device");
  assertSuccessful(readingsResponse.error, "reading");
  assertSuccessful(ledgerResponse.error, "ledger");
  assertSuccessful(runsResponse.error, "ingestion");

  const [transactionsResponse, snapshotsResponse] = financialResponse;
  const financialError =
    transactionsResponse.error || snapshotsResponse.error
      ? "Financial transaction data is not available to the authenticated role yet."
      : null;

  return {
    devices: asRows<ConsumptionDevice>(devicesResponse.data),
    readings: asRows<ConsumptionReading>(readingsResponse.data),
    ledgerEntries: asRows<ConsumptionLedgerEntry>(ledgerResponse.data),
    ingestionRuns: asRows<IngestionRun>(runsResponse.data),
    financialTransactions: asRows<FinancialTransaction>(
      transactionsResponse.data,
    ),
    financialSnapshots: asRows<FinancialSnapshot>(snapshotsResponse.data),
    financialError,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchDashboardDataFromLocalBridge(): Promise<DashboardData> {
  const response = await fetch("/api/dashboard", {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Local dashboard data bridge is unavailable.");
  }
  return (await response.json()) as DashboardData;
}
