export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type Table<Row extends Record<string, unknown>> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

type EmptySchema = {
  Tables: Record<string, never>
  Views: Record<string, never>
  Functions: Record<string, never>
  Enums: Record<string, never>
  CompositeTypes: Record<string, never>
}

export type Database = {
  public: {
    Tables: {
      transactions: Table<{
        id: string
        account_id: string
        date: string
        details: Json
      }>
      snapshots: Table<{
        account_id: string
        date: string
        amount_cents: number
        currency_code: string
      }>
    }
    Views: Record<string, never>
    Functions: {
      finance_caller_membership_v1: {
        Args: Record<PropertyKey, never>
        Returns: { member: boolean }
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
  consumption: {
    Tables: {
      devices: Table<{
        id: string
        source: string
        external_id: string
        kind: string
        name: string
        utility_type: string | null
        location: string | null
        timezone: string
        active_from: string | null
        active_to: string | null
        metadata: Json
      }>
      readings: Table<{
        id: string
        device_id: string
        source: string
        source_record_id: string
        period_start: string
        period_end: string
        metric: string
        measurement_target: string
        value: number
        unit: string
        quality: string
        metadata: Json
      }>
      ledger_entries: Table<{
        id: string
        source: string
        source_record_id: string
        device_id: string
        utility_type: string
        entry_type: string
        direction: "debit" | "credit"
        amount: number
        currency: string
        quantity: number | null
        quantity_unit: string | null
        rate: number | null
        occurred_at: string | null
        posted_at: string | null
        description: string | null
        reference: string | null
        metadata: Json
      }>
      ingestion_runs: Table<{
        id: string
        source: string
        runner: string
        status: "running" | "succeeded" | "failed"
        started_at: string
        finished_at: string | null
        rows_fetched: number
        rows_written: number
      }>
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
  finance: EmptySchema
}

export type DeviceRow = Database["consumption"]["Tables"]["devices"]["Row"]
export type ReadingRow = Database["consumption"]["Tables"]["readings"]["Row"]
export type LedgerRow = Database["consumption"]["Tables"]["ledger_entries"]["Row"]
export type IngestionRunRow = Database["consumption"]["Tables"]["ingestion_runs"]["Row"]
export type SnapshotRow = Database["public"]["Tables"]["snapshots"]["Row"]
