import type { BrowserClient } from "./browser"
import type {
  DeviceRow,
  IngestionRunRow,
  LedgerRow,
  ReadingRow,
  SnapshotRow,
} from "./database.types"

const FROM_DATE = () => new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString()

function assertOk(error: { message?: string } | null, source: string): void {
  if (error) {
    throw new Error(`Unable to read ${source} data.`)
  }
}

export function windowStart(): string {
  return FROM_DATE()
}

export async function readDevices(client: BrowserClient): Promise<DeviceRow[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("devices")
    .select(
      "id,source,external_id,kind,name,utility_type,location,timezone,active_from,active_to,metadata",
    )
    .order("name")
  assertOk(error, "device")
  return data ?? []
}

export async function readReadings(client: BrowserClient): Promise<ReadingRow[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("readings")
    .select(
      "id,device_id,source,source_record_id,period_start,period_end,metric,measurement_target,value,unit,quality,metadata",
    )
    .gte("period_start", windowStart())
    .order("period_start")
  assertOk(error, "reading")
  return data ?? []
}

export async function readLedger(client: BrowserClient): Promise<LedgerRow[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("ledger_entries")
    .select(
      "id,source,source_record_id,device_id,utility_type,entry_type,direction,amount,currency,quantity,quantity_unit,rate,occurred_at,posted_at,description,reference,metadata",
    )
    .gte("occurred_at", windowStart())
    .order("occurred_at")
  assertOk(error, "ledger")
  return data ?? []
}

export async function readIngestionRuns(client: BrowserClient): Promise<IngestionRunRow[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("ingestion_runs")
    .select("id,source,runner,status,started_at,finished_at,rows_fetched,rows_written")
    .order("started_at", { ascending: false })
    .limit(100)
  assertOk(error, "ingestion")
  return data ?? []
}

export async function readLatestSnapshot(
  client: BrowserClient,
): Promise<{ snapshot: SnapshotRow | null; error: string | null }> {
  const { data, error } = await client
    .from("snapshots")
    .select("account_id,date,amount_cents,currency_code")
    .gte("date", windowStart())
    .order("date", { ascending: false })
    .limit(1)
  if (error) {
    return {
      snapshot: null,
      error: "Financial transaction data is not available to the authenticated role yet.",
    }
  }
  return { snapshot: data?.[0] ?? null, error: null }
}

export async function countTransactions(
  client: BrowserClient,
): Promise<{ count: number; error: string | null }> {
  const { count, error } = await client
    .from("transactions")
    .select("id", { count: "exact", head: true })
    .gte("date", windowStart())
  if (error) {
    return {
      count: 0,
      error: "Financial transaction data is not available to the authenticated role yet.",
    }
  }
  return { count: count ?? 0, error: null }
}
