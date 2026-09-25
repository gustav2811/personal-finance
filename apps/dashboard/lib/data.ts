import {
  getPublicClient,
  type BrowserClient,
} from "./supabase-browser";

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

export type DashboardScope = "overview" | "energy" | "money" | "sources";

export type DashboardData = {
  devices: ConsumptionDevice[];
  readings: ConsumptionReading[];
  ledgerEntries: ConsumptionLedgerEntry[];
  ingestionRuns: IngestionRun[];
  financialTransactions: FinancialTransaction[];
  financialTransactionCount: number;
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

const DEVICE_COLUMNS =
  "id,source,external_id,kind,name,utility_type,location,timezone,active_from,active_to,metadata";
const READING_COLUMNS =
  "id,device_id,source,source_record_id,period_start,period_end,metric,measurement_target,value,unit,quality,metadata";
const LEDGER_COLUMNS =
  "id,source,source_record_id,device_id,utility_type,entry_type,direction,amount,currency,quantity,quantity_unit,rate,occurred_at,posted_at,description,reference,metadata";
const RUN_COLUMNS =
  "id,source,runner,status,started_at,finished_at,rows_fetched,rows_written";

function emptyDashboard(): DashboardData {
  return {
    devices: [],
    readings: [],
    ledgerEntries: [],
    ingestionRuns: [],
    financialTransactions: [],
    financialTransactionCount: 0,
    financialSnapshots: [],
    financialError: null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadDashboardData(
  client: BrowserClient,
  scope: DashboardScope,
): Promise<DashboardData> {
  const consumption = client.schema("consumption");
  const publicClient = client;
  const fromDate = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString();
  const needsReadings = scope === "overview" || scope === "energy" || scope === "sources";
  const needsLedger = scope === "overview" || scope === "money";
  const needsRuns = scope === "sources";
  const needsFinance = scope === "money" || scope === "overview";

  const [devicesResponse, readingsResponse, ledgerResponse, runsResponse, finance] =
    await Promise.all([
      consumption.from("devices").select(DEVICE_COLUMNS).order("name"),
      needsReadings
        ? consumption
            .from("readings")
            .select(READING_COLUMNS)
            .gte("period_start", fromDate)
            .order("period_start")
        : Promise.resolve(null),
      needsLedger
        ? consumption
            .from("ledger_entries")
            .select(LEDGER_COLUMNS)
            .gte("occurred_at", fromDate)
            .order("occurred_at")
        : Promise.resolve(null),
      needsRuns
        ? consumption
            .from("ingestion_runs")
            .select(RUN_COLUMNS)
            .order("started_at", { ascending: false })
            .limit(100)
        : Promise.resolve(null),
      needsFinance
        ? Promise.all([
            scope === "money"
              ? publicClient
                  .from("transactions")
                  .select("id", { count: "exact", head: true })
                  .gte("date", fromDate)
              : Promise.resolve(null),
            publicClient
              .from("snapshots")
              .select("account_id,date,amount_cents,currency_code")
              .gte("date", fromDate)
              .order("date", { ascending: false })
              .limit(1),
          ])
        : Promise.resolve(null),
    ]);

  assertSuccessful(devicesResponse.error, "device");
  if (readingsResponse) assertSuccessful(readingsResponse.error, "reading");
  if (ledgerResponse) assertSuccessful(ledgerResponse.error, "ledger");
  if (runsResponse) assertSuccessful(runsResponse.error, "ingestion");

  const result = emptyDashboard();
  result.devices = asRows<ConsumptionDevice>(devicesResponse.data);
  result.readings = asRows<ConsumptionReading>(readingsResponse?.data);
  result.ledgerEntries = asRows<ConsumptionLedgerEntry>(ledgerResponse?.data);
  result.ingestionRuns = asRows<IngestionRun>(runsResponse?.data);

  if (finance) {
    const [transactionsResponse, snapshotsResponse] = finance;
    const financeFailed = Boolean(
      (transactionsResponse && transactionsResponse.error) || snapshotsResponse.error,
    );
    result.financialError = financeFailed
      ? "Financial transaction data is not available to the authenticated role yet."
      : null;
    result.financialTransactionCount = transactionsResponse?.count ?? 0;
    result.financialSnapshots = asRows<FinancialSnapshot>(snapshotsResponse.data);
  }

  return result;
}

export async function fetchDashboardData(
  scope: DashboardScope,
): Promise<DashboardData> {
  return loadDashboardData(getPublicClient(), scope);
}

export async function fetchDashboardDataFromLocalBridge(
  scope: DashboardScope,
): Promise<DashboardData> {
  const response = await fetch(`/api/dashboard?scope=${scope}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Local dashboard data bridge is unavailable.");
  }
  const body = (await response.json()) as Partial<DashboardData>;
  return {
    ...emptyDashboard(),
    ...body,
    financialTransactionCount:
      body.financialTransactionCount ?? body.financialTransactions?.length ?? 0,
  };
}
