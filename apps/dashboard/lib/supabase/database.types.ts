export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  consumption: {
    Tables: {
      context_events: {
        Row: {
          confidence: number | null
          created_at: string
          device_id: string | null
          end_at: string | null
          event_type: string
          id: string
          notes: string | null
          source: string
          start_at: string
          value: Json
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          device_id?: string | null
          end_at?: string | null
          event_type: string
          id?: string
          notes?: string | null
          source: string
          start_at: string
          value?: Json
        }
        Update: {
          confidence?: number | null
          created_at?: string
          device_id?: string | null
          end_at?: string | null
          event_type?: string
          id?: string
          notes?: string | null
          source?: string
          start_at?: string
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "context_events_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      devices: {
        Row: {
          active_from: string | null
          active_to: string | null
          created_at: string
          external_id: string
          id: string
          kind: string
          location: string | null
          metadata: Json
          name: string
          parent_device_id: string | null
          source: string
          timezone: string
          updated_at: string
          utility_type: string | null
        }
        Insert: {
          active_from?: string | null
          active_to?: string | null
          created_at?: string
          external_id: string
          id?: string
          kind: string
          location?: string | null
          metadata?: Json
          name: string
          parent_device_id?: string | null
          source: string
          timezone?: string
          updated_at?: string
          utility_type?: string | null
        }
        Update: {
          active_from?: string | null
          active_to?: string | null
          created_at?: string
          external_id?: string
          id?: string
          kind?: string
          location?: string | null
          metadata?: Json
          name?: string
          parent_device_id?: string | null
          source?: string
          timezone?: string
          updated_at?: string
          utility_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "devices_parent_device_id_fkey"
            columns: ["parent_device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          currency: string
          document_date: string | null
          document_number: string | null
          document_type: string
          file_name: string | null
          id: string
          metadata: Json
          raw_event_id: string | null
          source: string
          source_record_id: string
          storage_path: string | null
          total: number | null
        }
        Insert: {
          created_at?: string
          currency?: string
          document_date?: string | null
          document_number?: string | null
          document_type: string
          file_name?: string | null
          id?: string
          metadata?: Json
          raw_event_id?: string | null
          source: string
          source_record_id: string
          storage_path?: string | null
          total?: number | null
        }
        Update: {
          created_at?: string
          currency?: string
          document_date?: string | null
          document_number?: string | null
          document_type?: string
          file_name?: string | null
          id?: string
          metadata?: Json
          raw_event_id?: string | null
          source?: string
          source_record_id?: string
          storage_path?: string | null
          total?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "raw_events"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_runs: {
        Row: {
          error: string | null
          finished_at: string | null
          id: string
          metadata: Json
          rows_fetched: number
          rows_written: number
          runner: string
          source: string
          started_at: string
          status: string
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          rows_fetched?: number
          rows_written?: number
          runner: string
          source: string
          started_at?: string
          status: string
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          id?: string
          metadata?: Json
          rows_fetched?: number
          rows_written?: number
          runner?: string
          source?: string
          started_at?: string
          status?: string
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          amount: number
          created_at: string
          currency: string
          description: string | null
          device_id: string
          direction: string
          entry_type: string
          id: string
          metadata: Json
          occurred_at: string | null
          posted_at: string | null
          quantity: number | null
          quantity_unit: string | null
          rate: number | null
          raw_event_id: string | null
          reference: string | null
          source: string
          source_record_id: string
          utility_type: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          description?: string | null
          device_id: string
          direction: string
          entry_type: string
          id?: string
          metadata?: Json
          occurred_at?: string | null
          posted_at?: string | null
          quantity?: number | null
          quantity_unit?: string | null
          rate?: number | null
          raw_event_id?: string | null
          reference?: string | null
          source: string
          source_record_id: string
          utility_type: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          device_id?: string
          direction?: string
          entry_type?: string
          id?: string
          metadata?: Json
          occurred_at?: string | null
          posted_at?: string | null
          quantity?: number | null
          quantity_unit?: string | null
          rate?: number | null
          raw_event_id?: string | null
          reference?: string | null
          source?: string
          source_record_id?: string
          utility_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "raw_events"
            referencedColumns: ["id"]
          },
        ]
      }
      raw_events: {
        Row: {
          event_at: string | null
          event_type: string
          fetched_at: string
          id: string
          metadata: Json
          payload: Json
          payload_hash: string
          source: string
          source_record_id: string
        }
        Insert: {
          event_at?: string | null
          event_type: string
          fetched_at?: string
          id?: string
          metadata?: Json
          payload: Json
          payload_hash: string
          source: string
          source_record_id: string
        }
        Update: {
          event_at?: string | null
          event_type?: string
          fetched_at?: string
          id?: string
          metadata?: Json
          payload?: Json
          payload_hash?: string
          source?: string
          source_record_id?: string
        }
        Relationships: []
      }
      readings: {
        Row: {
          created_at: string
          device_id: string | null
          id: string
          measurement_target: string
          metadata: Json
          metric: string
          period_end: string
          period_start: string
          quality: string
          raw_event_id: string | null
          source: string
          source_record_id: string
          unit: string
          value: number
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          id?: string
          measurement_target: string
          metadata?: Json
          metric: string
          period_end: string
          period_start: string
          quality?: string
          raw_event_id?: string | null
          source: string
          source_record_id: string
          unit: string
          value: number
        }
        Update: {
          created_at?: string
          device_id?: string | null
          id?: string
          measurement_target?: string
          metadata?: Json
          metric?: string
          period_end?: string
          period_start?: string
          quality?: string
          raw_event_id?: string | null
          source?: string
          source_record_id?: string
          unit?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "readings_device_id_fkey"
            columns: ["device_id"]
            isOneToOne: false
            referencedRelation: "devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "readings_raw_event_id_fkey"
            columns: ["raw_event_id"]
            isOneToOne: false
            referencedRelation: "raw_events"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      is_dashboard_user: { Args: never; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  finance: {
    Tables: {
      account_semantics: {
        Row: {
          account_id: string
          context: string | null
          household_id: string
          owner_scope: string
          role: string
          updated_at: string
        }
        Insert: {
          account_id: string
          context?: string | null
          household_id: string
          owner_scope: string
          role: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          context?: string | null
          household_id?: string
          owner_scope?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_semantics_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      categories: {
        Row: {
          archived_at: string | null
          created_at: string
          group_name: string | null
          household_id: string
          id: string
          lifecycle_status: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          group_name?: string | null
          household_id: string
          id?: string
          lifecycle_status?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          group_name?: string | null
          household_id?: string
          id?: string
          lifecycle_status?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_feedback: {
        Row: {
          action: string
          created_at: string
          household_id: string
          id: string
          note: string | null
          proposal_id: string | null
          review_command_id: string
          reviewed_classification_id: string | null
          reviewed_treatment_id: string | null
          reviewer_id: string
          run_id: string | null
          selected_category_id: string | null
          transaction_id: string
        }
        Insert: {
          action: string
          created_at?: string
          household_id: string
          id?: string
          note?: string | null
          proposal_id?: string | null
          review_command_id: string
          reviewed_classification_id?: string | null
          reviewed_treatment_id?: string | null
          reviewer_id: string
          run_id?: string | null
          selected_category_id?: string | null
          transaction_id: string
        }
        Update: {
          action?: string
          created_at?: string
          household_id?: string
          id?: string
          note?: string | null
          proposal_id?: string | null
          review_command_id?: string
          reviewed_classification_id?: string | null
          reviewed_treatment_id?: string | null
          reviewer_id?: string
          run_id?: string | null
          selected_category_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_feedback_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "classification_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_reviewed_classification_id_fkey"
            columns: ["reviewed_classification_id"]
            isOneToOne: false
            referencedRelation: "transaction_classifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_reviewed_treatment_id_fkey"
            columns: ["reviewed_treatment_id"]
            isOneToOne: false
            referencedRelation: "transaction_treatments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "classification_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_feedback_selected_category_id_fkey"
            columns: ["selected_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_proposals: {
        Row: {
          confidence: number | null
          created_at: string
          evidence_transaction_ids: string[]
          household_id: string
          id: string
          needs_review: boolean
          proposed_category_id: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          run_id: string | null
          status: string
          transaction_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence_transaction_ids?: string[]
          household_id: string
          id?: string
          needs_review?: boolean
          proposed_category_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          status?: string
          transaction_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence_transaction_ids?: string[]
          household_id?: string
          id?: string
          needs_review?: boolean
          proposed_category_id?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          run_id?: string | null
          status?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "classification_proposals_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_proposals_proposed_category_id_fkey"
            columns: ["proposed_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classification_proposals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "classification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      classification_runs: {
        Row: {
          classifier: string
          classifier_version: string
          completed_at: string | null
          error: string | null
          household_id: string
          id: string
          input_token_count: number | null
          model_id: string | null
          output_token_count: number | null
          result: Json | null
          started_at: string
          status: string
          transaction_id: string | null
        }
        Insert: {
          classifier: string
          classifier_version: string
          completed_at?: string | null
          error?: string | null
          household_id: string
          id?: string
          input_token_count?: number | null
          model_id?: string | null
          output_token_count?: number | null
          result?: Json | null
          started_at?: string
          status: string
          transaction_id?: string | null
        }
        Update: {
          classifier?: string
          classifier_version?: string
          completed_at?: string | null
          error?: string | null
          household_id?: string
          id?: string
          input_token_count?: number | null
          model_id?: string | null
          output_token_count?: number | null
          result?: Json | null
          started_at?: string
          status?: string
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classification_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_event_legs: {
        Row: {
          created_at: string
          event_id: string
          household_id: string
          id: string
          leg_role: string
          status: string
          transaction_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          household_id: string
          id?: string
          leg_role: string
          status?: string
          transaction_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          household_id?: string
          id?: string
          leg_role?: string
          status?: string
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_event_legs_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "financial_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_event_legs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_events: {
        Row: {
          created_at: string
          event_type: string
          household_id: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          event_type: string
          household_id: string
          id?: string
          status?: string
        }
        Update: {
          created_at?: string
          event_type?: string
          household_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_events_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      household_members: {
        Row: {
          auth_user_id: string | null
          created_at: string
          email: string | null
          household_id: string
          id: string
          role: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          household_id: string
          id?: string
          role?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          email?: string | null
          household_id?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "household_members_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      households: {
        Row: {
          created_at: string
          id: string
        }
        Insert: {
          created_at?: string
          id?: string
        }
        Update: {
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      relationship_semantics: {
        Row: {
          context: string | null
          counterparty_key: string | null
          created_at: string
          default_category_id: string | null
          default_is_transfer: boolean | null
          default_leg_role: string | null
          destination_account_id: string | null
          direction: string | null
          effective_from: string | null
          effective_to: string | null
          event_type: string | null
          household_id: string
          id: string
          provenance: string
          source_account_id: string
          status: string
        }
        Insert: {
          context?: string | null
          counterparty_key?: string | null
          created_at?: string
          default_category_id?: string | null
          default_is_transfer?: boolean | null
          default_leg_role?: string | null
          destination_account_id?: string | null
          direction?: string | null
          effective_from?: string | null
          effective_to?: string | null
          event_type?: string | null
          household_id: string
          id?: string
          provenance: string
          source_account_id: string
          status?: string
        }
        Update: {
          context?: string | null
          counterparty_key?: string | null
          created_at?: string
          default_category_id?: string | null
          default_is_transfer?: boolean | null
          default_leg_role?: string | null
          destination_account_id?: string | null
          direction?: string | null
          effective_from?: string | null
          effective_to?: string | null
          event_type?: string | null
          household_id?: string
          id?: string
          provenance?: string
          source_account_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "relationship_semantics_default_category_id_fkey"
            columns: ["default_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "relationship_semantics_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      source_categories: {
        Row: {
          group_name: string | null
          household_id: string
          id: string
          lifecycle_status: string
          name: string
          observed_at: string
          owned_category_id: string | null
          raw_payload: Json | null
          raw_payload_hash: string | null
          source_category_id: string
          source_system: string
        }
        Insert: {
          group_name?: string | null
          household_id: string
          id?: string
          lifecycle_status?: string
          name: string
          observed_at?: string
          owned_category_id?: string | null
          raw_payload?: Json | null
          raw_payload_hash?: string | null
          source_category_id: string
          source_system: string
        }
        Update: {
          group_name?: string | null
          household_id?: string
          id?: string
          lifecycle_status?: string
          name?: string
          observed_at?: string
          owned_category_id?: string | null
          raw_payload?: Json | null
          raw_payload_hash?: string | null
          source_category_id?: string
          source_system?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_categories_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_categories_owned_category_id_fkey"
            columns: ["owned_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_runs: {
        Row: {
          completed_at: string | null
          error: string | null
          household_id: string
          id: string
          source_system: string
          started_at: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          error?: string | null
          household_id: string
          id?: string
          source_system: string
          started_at?: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          error?: string | null
          household_id?: string
          id?: string
          source_system?: string
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_runs_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_classifications: {
        Row: {
          actor_id: string | null
          category_id: string
          confidence: number | null
          confirmed_at: string | null
          created_at: string
          decision_source: string
          household_id: string
          id: string
          reason: string | null
          run_id: string | null
          status: string
          superseded_at: string | null
          transaction_id: string
        }
        Insert: {
          actor_id?: string | null
          category_id: string
          confidence?: number | null
          confirmed_at?: string | null
          created_at?: string
          decision_source: string
          household_id: string
          id?: string
          reason?: string | null
          run_id?: string | null
          status: string
          superseded_at?: string | null
          transaction_id: string
        }
        Update: {
          actor_id?: string | null
          category_id?: string
          confidence?: number | null
          confirmed_at?: string | null
          created_at?: string
          decision_source?: string
          household_id?: string
          id?: string
          reason?: string | null
          run_id?: string | null
          status?: string
          superseded_at?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_classifications_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_classifications_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_classifications_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "classification_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_source_observations: {
        Row: {
          household_id: string
          id: string
          observed_at: string
          raw_payload: Json
          raw_payload_hash: string
          source_updated_at: string | null
          sync_run_id: string | null
          transaction_id: string
        }
        Insert: {
          household_id: string
          id?: string
          observed_at?: string
          raw_payload: Json
          raw_payload_hash: string
          source_updated_at?: string | null
          sync_run_id?: string | null
          transaction_id: string
        }
        Update: {
          household_id?: string
          id?: string
          observed_at?: string
          raw_payload?: Json
          raw_payload_hash?: string
          source_updated_at?: string | null
          sync_run_id?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_source_observations_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_source_observations_sync_run_id_fkey"
            columns: ["sync_run_id"]
            isOneToOne: false
            referencedRelation: "sync_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_treatments: {
        Row: {
          created_at: string
          decision_source: string
          event_id: string | null
          exclude_from_spend: boolean
          household_id: string
          id: string
          is_transfer: boolean
          leg_role: string | null
          nature: string | null
          status: string
          superseded_at: string | null
          transaction_id: string
        }
        Insert: {
          created_at?: string
          decision_source: string
          event_id?: string | null
          exclude_from_spend: boolean
          household_id: string
          id?: string
          is_transfer: boolean
          leg_role?: string | null
          nature?: string | null
          status: string
          superseded_at?: string | null
          transaction_id: string
        }
        Update: {
          created_at?: string
          decision_source?: string
          event_id?: string | null
          exclude_from_spend?: boolean
          household_id?: string
          id?: string
          is_transfer?: boolean
          leg_role?: string | null
          nature?: string | null
          status?: string
          superseded_at?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_treatments_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "financial_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_treatments_household_id_fkey"
            columns: ["household_id"]
            isOneToOne: false
            referencedRelation: "households"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      encode_transaction_cursor: {
        Args: { p_date: string; p_id: string }
        Returns: string
      }
      is_household_member: {
        Args: { target_household_id: string }
        Returns: boolean
      }
      map_decision_provenance: { Args: { p_source: string }; Returns: string }
      resolve_caller_household: { Args: never; Returns: string }
      resolve_reviewer_id: { Args: never; Returns: string }
      transaction_feed_item: {
        Args: { p_transaction_id: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
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
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  consumption: {
    Enums: {},
  },
  finance: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
