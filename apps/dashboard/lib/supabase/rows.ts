import type { Database } from "./database.types"

export type DeviceRow = Database["consumption"]["Tables"]["devices"]["Row"]
export type ReadingRow = Database["consumption"]["Tables"]["readings"]["Row"]
export type LedgerRow = Database["consumption"]["Tables"]["ledger_entries"]["Row"]
export type IngestionRunRow = Database["consumption"]["Tables"]["ingestion_runs"]["Row"]
export type SnapshotRow = Database["public"]["Tables"]["snapshots"]["Row"]
