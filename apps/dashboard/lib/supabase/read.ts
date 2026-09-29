import type { BrowserClient } from "./browser"
import type {
  DeviceRead,
  IngestionRunRead,
  LedgerRead,
  ReadingRead,
  SnapshotRead,
} from "./rows"

const FROM_DATE = () => new Date(Date.now() - 366 * 24 * 60 * 60 * 1000).toISOString()

const DEVICE_SELECT =
  "id,source,external_id,kind,name,utility_type,location,timezone,active_from,active_to"
const READING_SELECT =
  "id,device_id,source,source_record_id,period_start,period_end,metric,measurement_target,value,unit,quality"
const LEDGER_SELECT =
  "id,device_id,source,utility_type,entry_type,direction,amount,currency,quantity,rate,occurred_at,posted_at,description"
const INGESTION_SELECT =
  "id,source,runner,status,error,started_at,finished_at,rows_fetched,rows_written"
const SNAPSHOT_SELECT = "account_id,date,amount_cents,currency_code"

function assertOk(error: { message?: string } | null, source: string): void {
  if (error) {
    throw new Error(`Unable to read ${source} data.`)
  }
}

export function windowStart(): string {
  return FROM_DATE()
}

export async function readDevices(client: BrowserClient): Promise<DeviceRead[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("devices")
    .select(DEVICE_SELECT)
    .order("name")
  assertOk(error, "device")
  return data ?? []
}

export async function readReadings(client: BrowserClient): Promise<ReadingRead[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("readings")
    .select(READING_SELECT)
    .gte("period_start", windowStart())
    .order("period_start")
  assertOk(error, "reading")
  return data ?? []
}

export async function readLedger(client: BrowserClient): Promise<LedgerRead[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("ledger_entries")
    .select(LEDGER_SELECT)
    .gte("occurred_at", windowStart())
    .order("occurred_at")
  assertOk(error, "ledger")
  return data ?? []
}

// Full history, paged past the API row cap. Ordered by id as a tiebreak so pages never overlap.
const PAGE_SIZE = 1000

export async function readReadingsHistory(client: BrowserClient): Promise<ReadingRead[]> {
  const rows: ReadingRead[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .schema("consumption")
      .from("readings")
      .select(READING_SELECT)
      .order("period_start")
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
    assertOk(error, "reading")
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export async function readLedgerHistory(client: BrowserClient): Promise<LedgerRead[]> {
  const rows: LedgerRead[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .schema("consumption")
      .from("ledger_entries")
      .select(LEDGER_SELECT)
      .order("occurred_at")
      .order("id")
      .range(from, from + PAGE_SIZE - 1)
    assertOk(error, "ledger")
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export async function readIngestionRuns(client: BrowserClient): Promise<IngestionRunRead[]> {
  const { data, error } = await client
    .schema("consumption")
    .from("ingestion_runs")
    .select(INGESTION_SELECT)
    .order("started_at", { ascending: false })
    .limit(100)
  assertOk(error, "ingestion")
  return data ?? []
}

export async function readLatestSnapshot(
  client: BrowserClient,
): Promise<{ snapshot: SnapshotRead | null; error: string | null }> {
  const { data, error } = await client
    .from("snapshots")
    .select(SNAPSHOT_SELECT)
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
