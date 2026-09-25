import type { Database } from "./database.types"

export type DeviceRow = Database["consumption"]["Tables"]["devices"]["Row"]
export type ReadingRow = Database["consumption"]["Tables"]["readings"]["Row"]
export type LedgerRow = Database["consumption"]["Tables"]["ledger_entries"]["Row"]
export type IngestionRunRow = Database["consumption"]["Tables"]["ingestion_runs"]["Row"]
export type SnapshotRow = Database["public"]["Tables"]["snapshots"]["Row"]

export type DeviceRead = Pick<
  DeviceRow,
  | "id"
  | "source"
  | "external_id"
  | "kind"
  | "name"
  | "utility_type"
  | "location"
  | "timezone"
  | "active_from"
  | "active_to"
>

export type ReadingRead = Pick<
  ReadingRow,
  | "id"
  | "device_id"
  | "source"
  | "source_record_id"
  | "period_start"
  | "period_end"
  | "metric"
  | "measurement_target"
  | "value"
  | "unit"
  | "quality"
>

export type LedgerRead = Pick<
  LedgerRow,
  | "id"
  | "device_id"
  | "source"
  | "utility_type"
  | "entry_type"
  | "direction"
  | "amount"
  | "currency"
  | "quantity"
  | "occurred_at"
  | "posted_at"
  | "description"
>

export type IngestionRunRead = Pick<
  IngestionRunRow,
  | "id"
  | "source"
  | "runner"
  | "status"
  | "error"
  | "started_at"
  | "finished_at"
  | "rows_fetched"
  | "rows_written"
>

export type SnapshotRead = Pick<
  SnapshotRow,
  "account_id" | "date" | "amount_cents" | "currency_code"
>
