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

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          account_id: string
          account_type: string | null
          archived_at: string | null
          created_at: string
          currency_code: string | null
          finwise_account_id: string | null
          first_seen_at: string | null
          household_id: string
          last_seen_at: string | null
          lifecycle_status: string
          name: string
          raw_payload: Json | null
          raw_payload_hash: string | null
          source_account_id: string
          source_platform: string
          source_system: string
          source_updated_at: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          account_id?: string
          account_type?: string | null
          archived_at?: string | null
          created_at?: string
          currency_code?: string | null
          finwise_account_id?: string | null
          first_seen_at?: string | null
          household_id: string
          last_seen_at?: string | null
          lifecycle_status?: string
          name: string
          raw_payload?: Json | null
          raw_payload_hash?: string | null
          source_account_id: string
          source_platform?: string
          source_system: string
          source_updated_at?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          account_type?: string | null
          archived_at?: string | null
          created_at?: string
          currency_code?: string | null
          finwise_account_id?: string | null
          first_seen_at?: string | null
          household_id?: string
          last_seen_at?: string | null
          lifecycle_status?: string
          name?: string
          raw_payload?: Json | null
          raw_payload_hash?: string | null
          source_account_id?: string
          source_platform?: string
          source_system?: string
          source_updated_at?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      dlq_ingest_jobs: {
        Row: {
          bank: string
          created_at: string
          error: string
          id: string
          job_id: string
          message_id: string
          payload: Json
        }
        Insert: {
          bank: string
          created_at?: string
          error: string
          id?: string
          job_id: string
          message_id: string
          payload: Json
        }
        Update: {
          bank?: string
          created_at?: string
          error?: string
          id?: string
          job_id?: string
          message_id?: string
          payload?: Json
        }
        Relationships: []
      }
      processed_transactions: {
        Row: {
          created_at: string
          external_id: string
        }
        Insert: {
          created_at?: string
          external_id: string
        }
        Update: {
          created_at?: string
          external_id?: string
        }
        Relationships: []
      }
      snapshots: {
        Row: {
          account_id: string
          amount_cents: number
          created_at: string | null
          currency_code: string | null
          date: string
          household_id: string | null
          observed_at: string | null
          source_system: string | null
          sync_run_id: string | null
        }
        Insert: {
          account_id: string
          amount_cents: number
          created_at?: string | null
          currency_code?: string | null
          date: string
          household_id?: string | null
          observed_at?: string | null
          source_system?: string | null
          sync_run_id?: string | null
        }
        Update: {
          account_id?: string
          amount_cents?: number
          created_at?: string | null
          currency_code?: string | null
          date?: string
          household_id?: string | null
          observed_at?: string | null
          source_system?: string | null
          sync_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "snapshots_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["account_id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_id: string
          amount: number | null
          created_at: string
          currency_code: string | null
          date: string
          description: string | null
          details: Json
          effective_at: string | null
          finwise_transaction_id: string | null
          household_id: string | null
          id: string
          lifecycle_status: string
          merchant_name: string | null
          merchant_source_id: string | null
          notes: string | null
          occurred_on: string | null
          original_description: string | null
          owned_category_id: string | null
          parent_transaction_id: string | null
          posted_at: string | null
          publication_error: string | null
          publication_status: string | null
          published_at: string | null
          raw_payload_hash: string | null
          source_category_id: string | null
          source_category_name_snapshot: string | null
          source_first_seen_at: string | null
          source_is_archived: boolean | null
          source_is_pending: boolean | null
          source_is_transfer: boolean | null
          source_last_seen_at: string | null
          source_system: string | null
          source_transaction_id: string | null
          source_updated_at: string | null
          updated_at: string
        }
        Insert: {
          account_id: string
          amount?: number | null
          created_at?: string
          currency_code?: string | null
          date: string
          description?: string | null
          details: Json
          effective_at?: string | null
          finwise_transaction_id?: string | null
          household_id?: string | null
          id: string
          lifecycle_status?: string
          merchant_name?: string | null
          merchant_source_id?: string | null
          notes?: string | null
          occurred_on?: string | null
          original_description?: string | null
          owned_category_id?: string | null
          parent_transaction_id?: string | null
          posted_at?: string | null
          publication_error?: string | null
          publication_status?: string | null
          published_at?: string | null
          raw_payload_hash?: string | null
          source_category_id?: string | null
          source_category_name_snapshot?: string | null
          source_first_seen_at?: string | null
          source_is_archived?: boolean | null
          source_is_pending?: boolean | null
          source_is_transfer?: boolean | null
          source_last_seen_at?: string | null
          source_system?: string | null
          source_transaction_id?: string | null
          source_updated_at?: string | null
          updated_at?: string
        }
        Update: {
          account_id?: string
          amount?: number | null
          created_at?: string
          currency_code?: string | null
          date?: string
          description?: string | null
          details?: Json
          effective_at?: string | null
          finwise_transaction_id?: string | null
          household_id?: string | null
          id?: string
          lifecycle_status?: string
          merchant_name?: string | null
          merchant_source_id?: string | null
          notes?: string | null
          occurred_on?: string | null
          original_description?: string | null
          owned_category_id?: string | null
          parent_transaction_id?: string | null
          posted_at?: string | null
          publication_error?: string | null
          publication_status?: string | null
          published_at?: string | null
          raw_payload_hash?: string | null
          source_category_id?: string | null
          source_category_name_snapshot?: string | null
          source_first_seen_at?: string | null
          source_is_archived?: boolean | null
          source_is_pending?: boolean | null
          source_is_transfer?: boolean | null
          source_last_seen_at?: string | null
          source_system?: string | null
          source_transaction_id?: string | null
          source_updated_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["account_id"]
          },
          {
            foreignKeyName: "transactions_parent_transaction_id_fkey"
            columns: ["parent_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      finance_caller_membership_v1: {
        Args: Record<PropertyKey, never>
        Returns: { member: boolean }
      }
      finance_finish_sync_run: {
        Args: { p_error: string; p_status: string; p_sync_run_id: string }
        Returns: string
      }
      finance_get_transaction_activity_v1: { Args: never; Returns: Json }
      finance_get_transaction_filters_v1: { Args: never; Returns: Json }
      finance_get_transaction_v1: {
        Args: { p_transaction_id: string }
        Returns: Json
      }
      finance_list_transactions_v1: {
        Args: { p_cursor?: string; p_filters?: Json; p_limit?: number }
        Returns: Json
      }
      finance_record_classification_run: {
        Args: {
          p_classifier_version: string
          p_confidence: number
          p_exclude_from_spend: boolean
          p_household_id: string
          p_input_token_count: number
          p_is_transfer: boolean
          p_model_id: string
          p_nature: string
          p_owned_category_id: string
          p_result: Json
          p_transaction_id: string
        }
        Returns: string
      }
      finance_set_transaction_category_v1: {
        Args: {
          p_category_id: string
          p_expected_confirmed_classification_id: string
          p_expected_proposed_classification_id: string
          p_review_command_id: string
          p_transaction_id: string
        }
        Returns: Json
      }
      finance_set_transaction_treatment_v1: {
        Args: {
          p_exclude_from_spend: boolean
          p_expected_confirmed_treatment_id: string
          p_expected_proposed_treatment_id: string
          p_is_transfer: boolean
          p_nature: string
          p_review_command_id: string
          p_transaction_id: string
        }
        Returns: Json
      }
      finance_start_sync_run: {
        Args: { p_household_id: string; p_source_system: string }
        Returns: string
      }
      finance_undo_transaction_category_v1: {
        Args: {
          p_category_id: string
          p_expected_confirmed_classification_id: string
          p_review_command_id: string
          p_transaction_id: string
        }
        Returns: Json
      }
      finance_upsert_source_account: {
        Args: { p_household_id: string; p_payload: Json }
        Returns: string
      }
      finance_upsert_source_accounts: {
        Args: { p_household_id: string; p_rows: Json }
        Returns: Json
      }
      finance_upsert_source_categories: {
        Args: { p_household_id: string; p_rows: Json }
        Returns: Json
      }
      finance_upsert_source_category: {
        Args: { p_household_id: string; p_payload: Json }
        Returns: string
      }
      finance_upsert_source_transaction: {
        Args: { p_household_id: string; p_payload: Json; p_sync_run_id: string }
        Returns: string
      }
      finance_upsert_source_transactions: {
        Args: { p_household_id: string; p_rows: Json; p_sync_run_id: string }
        Returns: Json
      }
      get_local_dashboard_data: { Args: never; Returns: Json }
      ingest_consumption_batch: { Args: { p_payload: Json }; Returns: Json }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  consumption: {
    Tables: {
      devices: Table<{
        id: string
        parent_device_id: string | null
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
        created_at: string
        updated_at: string
      }>
      readings: Table<{
        id: string
        device_id: string | null
        source: string
        source_record_id: string
        period_start: string
        period_end: string
        metric: string
        value: number
        unit: string
        quality: string
        raw_event_id: string | null
        metadata: Json
        created_at: string
        measurement_target: string
      }>
      ledger_entries: Table<{
        id: string
        source: string
        source_record_id: string
        device_id: string
        utility_type: string
        entry_type: string
        direction: string
        amount: number
        currency: string
        quantity: number | null
        quantity_unit: string | null
        rate: number | null
        occurred_at: string | null
        posted_at: string | null
        description: string | null
        reference: string | null
        raw_event_id: string | null
        metadata: Json
        created_at: string
      }>
      ingestion_runs: Table<{
        id: string
        source: string
        runner: string
        status: string
        started_at: string
        finished_at: string | null
        window_start: string | null
        window_end: string | null
        rows_fetched: number
        rows_written: number
        error: string | null
        metadata: Json
      }>
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type DeviceRow = Database["consumption"]["Tables"]["devices"]["Row"]
export type ReadingRow = Database["consumption"]["Tables"]["readings"]["Row"]
export type LedgerRow = Database["consumption"]["Tables"]["ledger_entries"]["Row"]
export type IngestionRunRow = Database["consumption"]["Tables"]["ingestion_runs"]["Row"]
export type SnapshotRow = Database["public"]["Tables"]["snapshots"]["Row"]
