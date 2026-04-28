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
  public: {
    Tables: {
      companies: {
        Row: {
          advanced_field_visibility: Json
          apply_business_state_tax: boolean
          company_type: string
          created_at: string
          default_setaside_method: string
          default_setaside_pct: number | null
          id: string
          include_in_tax: boolean
          include_se_tax_in_recommendation: boolean
          name: string
          nickname: string
          notes: string
          organization_id: string | null
          source_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          advanced_field_visibility?: Json
          apply_business_state_tax?: boolean
          company_type?: string
          created_at?: string
          default_setaside_method?: string
          default_setaside_pct?: number | null
          id?: string
          include_in_tax?: boolean
          include_se_tax_in_recommendation?: boolean
          name?: string
          nickname?: string
          notes?: string
          organization_id?: string | null
          source_kind?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          advanced_field_visibility?: Json
          apply_business_state_tax?: boolean
          company_type?: string
          created_at?: string
          default_setaside_method?: string
          default_setaside_pct?: number | null
          id?: string
          include_in_tax?: boolean
          include_se_tax_in_recommendation?: boolean
          name?: string
          nickname?: string
          notes?: string
          organization_id?: string | null
          source_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      home_office_deductions: {
        Row: {
          allowed_amount: number
          calculated_amount: number
          company_id: string | null
          created_at: string
          deduction_type: string
          id: string
          include_in_tax_calculation: boolean
          method: string
          organization_id: string | null
          prior_year_amount: number | null
          square_feet: number | null
          status: string
          tax_year: number
          unused_capped_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          allowed_amount?: number
          calculated_amount?: number
          company_id?: string | null
          created_at?: string
          deduction_type?: string
          id?: string
          include_in_tax_calculation?: boolean
          method?: string
          organization_id?: string | null
          prior_year_amount?: number | null
          square_feet?: number | null
          status?: string
          tax_year?: number
          unused_capped_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          allowed_amount?: number
          calculated_amount?: number
          company_id?: string | null
          created_at?: string
          deduction_type?: string
          id?: string
          include_in_tax_calculation?: boolean
          method?: string
          organization_id?: string | null
          prior_year_amount?: number | null
          square_feet?: number | null
          status?: string
          tax_year?: number
          unused_capped_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      hsa_contributions: {
        Row: {
          amount: number
          company_id: string | null
          contribution_date: string
          created_at: string
          created_from: string
          id: string
          income_entry_id: string | null
          notes: string | null
          organization_id: string | null
          source_type: string
          tax_year: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          company_id?: string | null
          contribution_date?: string
          created_at?: string
          created_from?: string
          id?: string
          income_entry_id?: string | null
          notes?: string | null
          organization_id?: string | null
          source_type?: string
          tax_year?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          company_id?: string | null
          contribution_date?: string
          created_at?: string
          created_from?: string
          id?: string
          income_entry_id?: string | null
          notes?: string | null
          organization_id?: string | null
          source_type?: string
          tax_year?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hsa_contributions_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hsa_contributions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      income_entries: {
        Row: {
          additional_tax_reserve: number
          base_tax_estimate: number
          company: string
          cost_basis: number | null
          created_at: string
          deposited_amount: number
          dynamic_tax_recommendation: number
          federal_withholding: number
          gross_amount: number
          healthcare_deduction: number
          hsa_contribution: number
          id: string
          include_in_cash_flow: boolean
          include_in_tax_estimate: boolean
          income_date: string
          income_type: string
          is_actual: boolean
          linked_hsa_contribution_id: string | null
          linked_transaction_id: string | null
          medicare_withholding: number
          name: string
          notes: string | null
          organization_id: string | null
          origin_planner_conversion_id: string | null
          origin_type: string
          paycheck_amount: number
          pre_tax_deductions: number
          quarterly_adjustment_amount: number
          realized_gain_loss: number | null
          recommendation_status: string
          retirement_401k: number
          source_bucket: string
          source_id: string | null
          ss_withholding: number
          state_withholding: number
          status: string
          tax_category: string
          taxes_withheld: number
          ui_income_subtype: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_tax_reserve?: number
          base_tax_estimate?: number
          company?: string
          cost_basis?: number | null
          created_at?: string
          deposited_amount?: number
          dynamic_tax_recommendation?: number
          federal_withholding?: number
          gross_amount?: number
          healthcare_deduction?: number
          hsa_contribution?: number
          id?: string
          include_in_cash_flow?: boolean
          include_in_tax_estimate?: boolean
          income_date?: string
          income_type?: string
          is_actual?: boolean
          linked_hsa_contribution_id?: string | null
          linked_transaction_id?: string | null
          medicare_withholding?: number
          name?: string
          notes?: string | null
          organization_id?: string | null
          origin_planner_conversion_id?: string | null
          origin_type?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          quarterly_adjustment_amount?: number
          realized_gain_loss?: number | null
          recommendation_status?: string
          retirement_401k?: number
          source_bucket?: string
          source_id?: string | null
          ss_withholding?: number
          state_withholding?: number
          status?: string
          tax_category?: string
          taxes_withheld?: number
          ui_income_subtype?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_tax_reserve?: number
          base_tax_estimate?: number
          company?: string
          cost_basis?: number | null
          created_at?: string
          deposited_amount?: number
          dynamic_tax_recommendation?: number
          federal_withholding?: number
          gross_amount?: number
          healthcare_deduction?: number
          hsa_contribution?: number
          id?: string
          include_in_cash_flow?: boolean
          include_in_tax_estimate?: boolean
          income_date?: string
          income_type?: string
          is_actual?: boolean
          linked_hsa_contribution_id?: string | null
          linked_transaction_id?: string | null
          medicare_withholding?: number
          name?: string
          notes?: string | null
          organization_id?: string | null
          origin_planner_conversion_id?: string | null
          origin_type?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          quarterly_adjustment_amount?: number
          realized_gain_loss?: number | null
          recommendation_status?: string
          retirement_401k?: number
          source_bucket?: string
          source_id?: string | null
          ss_withholding?: number
          state_withholding?: number
          status?: string
          tax_category?: string
          taxes_withheld?: number
          ui_income_subtype?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_entries_origin_planner_conversion_id_fkey"
            columns: ["origin_planner_conversion_id"]
            isOneToOne: false
            referencedRelation: "planner_conversions"
            referencedColumns: ["id"]
          },
        ]
      }
      income_forecasts: {
        Row: {
          company_name: string
          company_type: string
          created_at: string
          expected_withholding: number
          gross_income: number
          id: string
          month: string
          notes: string | null
          organization_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company_name?: string
          company_type?: string
          created_at?: string
          expected_withholding?: number
          gross_income?: number
          id?: string
          month: string
          notes?: string | null
          organization_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company_name?: string
          company_type?: string
          created_at?: string
          expected_withholding?: number
          gross_income?: number
          id?: string
          month?: string
          notes?: string | null
          organization_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "income_forecasts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      income_pathway_history: {
        Row: {
          active_income_stream_flags: Json
          changed_at: string
          changed_by_user: string
          created_at: string
          effective_date: string
          id: string
          new_user_type: string
          organization_id: string | null
          previous_user_type: string
          user_id: string
        }
        Insert: {
          active_income_stream_flags?: Json
          changed_at?: string
          changed_by_user: string
          created_at?: string
          effective_date: string
          id?: string
          new_user_type: string
          organization_id?: string | null
          previous_user_type: string
          user_id: string
        }
        Update: {
          active_income_stream_flags?: Json
          changed_at?: string
          changed_by_user?: string
          created_at?: string
          effective_date?: string
          id?: string
          new_user_type?: string
          organization_id?: string | null
          previous_user_type?: string
          user_id?: string
        }
        Relationships: []
      }
      mileage_entries: {
        Row: {
          company_id: string | null
          company_name: string
          created_at: string
          id: string
          miles: number
          month: number
          organization_id: string | null
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          company_id?: string | null
          company_name?: string
          created_at?: string
          id?: string
          miles?: number
          month: number
          organization_id?: string | null
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          company_id?: string | null
          company_name?: string
          created_at?: string
          id?: string
          miles?: number
          month?: number
          organization_id?: string | null
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "mileage_entries_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mileage_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_user_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      plaid_accounts: {
        Row: {
          account_business_mode: string
          account_mask: string | null
          account_name: string
          account_routing: string
          account_subtype: string | null
          account_type: string
          available_balance: number | null
          created_at: string
          current_balance: number | null
          default_company_id: string | null
          id: string
          is_active: boolean
          organization_id: string | null
          plaid_account_id: string
          plaid_item_id: string
          sync_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          account_business_mode?: string
          account_mask?: string | null
          account_name?: string
          account_routing?: string
          account_subtype?: string | null
          account_type?: string
          available_balance?: number | null
          created_at?: string
          current_balance?: number | null
          default_company_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          plaid_account_id: string
          plaid_item_id: string
          sync_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          account_business_mode?: string
          account_mask?: string | null
          account_name?: string
          account_routing?: string
          account_subtype?: string | null
          account_type?: string
          available_balance?: number | null
          created_at?: string
          current_balance?: number | null
          default_company_id?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string | null
          plaid_account_id?: string
          plaid_item_id?: string
          sync_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_accounts_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plaid_accounts_plaid_item_id_fkey"
            columns: ["plaid_item_id"]
            isOneToOne: false
            referencedRelation: "plaid_items_safe"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_deleted_tombstones: {
        Row: {
          deleted_at: string
          id: string
          organization_id: string | null
          plaid_transaction_id: string
          reason: string | null
          user_id: string
        }
        Insert: {
          deleted_at?: string
          id?: string
          organization_id?: string | null
          plaid_transaction_id: string
          reason?: string | null
          user_id: string
        }
        Update: {
          deleted_at?: string
          id?: string
          organization_id?: string | null
          plaid_transaction_id?: string
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_deleted_tombstones_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_items: {
        Row: {
          access_token: string
          created_at: string
          cursor: string | null
          id: string
          institution_id: string
          institution_name: string
          item_id: string
          last_synced_at: string | null
          organization_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          cursor?: string | null
          id?: string
          institution_id?: string
          institution_name?: string
          item_id: string
          last_synced_at?: string | null
          organization_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          cursor?: string | null
          id?: string
          institution_id?: string
          institution_name?: string
          item_id?: string
          last_synced_at?: string | null
          organization_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_transactions: {
        Row: {
          amount: number
          authorized_date: string | null
          category_raw: string | null
          created_at: string
          date: string
          id: string
          imported_at: string
          iso_currency_code: string | null
          merchant_name: string | null
          name: string
          organization_id: string | null
          payment_channel: string | null
          pending: boolean
          plaid_account_id: string
          plaid_transaction_id: string
          raw_json: Json | null
          unofficial_currency_code: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          authorized_date?: string | null
          category_raw?: string | null
          created_at?: string
          date: string
          id?: string
          imported_at?: string
          iso_currency_code?: string | null
          merchant_name?: string | null
          name?: string
          organization_id?: string | null
          payment_channel?: string | null
          pending?: boolean
          plaid_account_id: string
          plaid_transaction_id: string
          raw_json?: Json | null
          unofficial_currency_code?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          authorized_date?: string | null
          category_raw?: string | null
          created_at?: string
          date?: string
          id?: string
          imported_at?: string
          iso_currency_code?: string | null
          merchant_name?: string | null
          name?: string
          organization_id?: string | null
          payment_channel?: string | null
          pending?: boolean
          plaid_account_id?: string
          plaid_transaction_id?: string
          raw_json?: Json | null
          unofficial_currency_code?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plaid_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      planner_conversions: {
        Row: {
          bonus_event_id: string | null
          created_at: string
          id: string
          income_entry_id: string | null
          ledger_bucket: string
          needs_review_reason: string | null
          occurrence_date: string
          organization_id: string | null
          status: string
          stream_id: string | null
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bonus_event_id?: string | null
          created_at?: string
          id?: string
          income_entry_id?: string | null
          ledger_bucket: string
          needs_review_reason?: string | null
          occurrence_date: string
          organization_id?: string | null
          status?: string
          stream_id?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bonus_event_id?: string | null
          created_at?: string
          id?: string
          income_entry_id?: string | null
          ledger_bucket?: string
          needs_review_reason?: string | null
          occurrence_date?: string
          organization_id?: string | null
          status?: string
          stream_id?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "planner_conversions_bonus_event_id_fkey"
            columns: ["bonus_event_id"]
            isOneToOne: true
            referencedRelation: "projected_bonus_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planner_conversions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "planner_conversions_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "projected_income_streams"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          first_name: string
          id: string
          last_name: string
          organization_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          organization_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          first_name?: string
          id?: string
          last_name?: string
          organization_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      projected_bonus_events: {
        Row: {
          amount: number
          created_at: string
          frequency: string
          id: string
          name: string
          organization_id: string | null
          scheduled_date: string
          stream_id: string
          taxes_withheld: number
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          frequency?: string
          id?: string
          name?: string
          organization_id?: string | null
          scheduled_date?: string
          stream_id: string
          taxes_withheld?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          frequency?: string
          id?: string
          name?: string
          organization_id?: string | null
          scheduled_date?: string
          stream_id?: string
          taxes_withheld?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projected_bonus_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projected_bonus_events_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "projected_income_streams"
            referencedColumns: ["id"]
          },
        ]
      }
      projected_income_overrides: {
        Row: {
          action: string
          created_at: string
          healthcare_deduction: number
          hsa_contribution: number
          id: string
          notes: string | null
          organization_id: string | null
          override_date: string
          paycheck_amount: number
          pre_tax_deductions: number
          retirement_401k: number
          stream_id: string
          taxes_withheld: number
          updated_at: string
          user_id: string
        }
        Insert: {
          action?: string
          created_at?: string
          healthcare_deduction?: number
          hsa_contribution?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          override_date: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          retirement_401k?: number
          stream_id: string
          taxes_withheld?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          healthcare_deduction?: number
          hsa_contribution?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          override_date?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          retirement_401k?: number
          stream_id?: string
          taxes_withheld?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projected_income_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projected_income_overrides_stream_id_fkey"
            columns: ["stream_id"]
            isOneToOne: false
            referencedRelation: "projected_income_streams"
            referencedColumns: ["id"]
          },
        ]
      }
      projected_income_streams: {
        Row: {
          additional_tax_reserve: number
          company: string
          company_type: string
          created_at: string
          custom_interval_days: number | null
          end_date: string | null
          federal_withholding: number
          healthcare_deduction: number
          hsa_contribution: number
          id: string
          include_in_tax: boolean
          is_active: boolean
          medicare_withholding: number
          notes: string
          organization_id: string | null
          pay_frequency: string
          paycheck_amount: number
          pre_tax_deductions: number
          retirement_401k: number
          source_id: string | null
          ss_withholding: number
          start_date: string
          state_withholding: number
          taxes_withheld: number
          ui_income_subtype: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          additional_tax_reserve?: number
          company?: string
          company_type?: string
          created_at?: string
          custom_interval_days?: number | null
          end_date?: string | null
          federal_withholding?: number
          healthcare_deduction?: number
          hsa_contribution?: number
          id?: string
          include_in_tax?: boolean
          is_active?: boolean
          medicare_withholding?: number
          notes?: string
          organization_id?: string | null
          pay_frequency?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          retirement_401k?: number
          source_id?: string | null
          ss_withholding?: number
          start_date?: string
          state_withholding?: number
          taxes_withheld?: number
          ui_income_subtype?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          additional_tax_reserve?: number
          company?: string
          company_type?: string
          created_at?: string
          custom_interval_days?: number | null
          end_date?: string | null
          federal_withholding?: number
          healthcare_deduction?: number
          hsa_contribution?: number
          id?: string
          include_in_tax?: boolean
          is_active?: boolean
          medicare_withholding?: number
          notes?: string
          organization_id?: string | null
          pay_frequency?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          retirement_401k?: number
          source_id?: string | null
          ss_withholding?: number
          start_date?: string
          state_withholding?: number
          taxes_withheld?: number
          ui_income_subtype?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projected_income_streams_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retirement_contributions: {
        Row: {
          account_type: string
          apply_to_withholding: boolean
          contribution_amount: number
          created_at: string
          employer_match: number
          end_date: string | null
          frequency: string
          id: string
          notes: string | null
          organization_id: string | null
          start_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type?: string
          apply_to_withholding?: boolean
          contribution_amount?: number
          created_at?: string
          employer_match?: number
          end_date?: string | null
          frequency?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          start_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          apply_to_withholding?: boolean
          contribution_amount?: number
          created_at?: string
          employer_match?: number
          end_date?: string | null
          frequency?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          start_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retirement_contributions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transactions: {
        Row: {
          cost_basis: number
          created_at: string
          estimated_tax: number
          gain_loss: number
          id: string
          notes: string | null
          organization_id: string | null
          sale_date: string
          sale_type: string
          total_sale_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          cost_basis?: number
          created_at?: string
          estimated_tax?: number
          gain_loss?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          sale_date?: string
          sale_type?: string
          total_sale_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          cost_basis?: number
          created_at?: string
          estimated_tax?: number
          gain_loss?: number
          id?: string
          notes?: string | null
          organization_id?: string | null
          sale_date?: string
          sale_type?: string
          total_sale_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_payments: {
        Row: {
          amount: number
          applied_quarter: string
          applied_tax_year: number
          created_at: string
          id: string
          notes: string | null
          organization_id: string | null
          payment_date: string
          quarter: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          applied_quarter?: string
          applied_tax_year?: number
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          payment_date?: string
          quarter?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          applied_quarter?: string
          applied_tax_year?: number
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          payment_date?: string
          quarter?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_payments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_savings: {
        Row: {
          amount: number
          created_at: string
          id: string
          notes: string | null
          organization_id: string | null
          savings_date: string
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          savings_date?: string
          source?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          savings_date?: string
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_savings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_settings: {
        Row: {
          auto_convert_future_income_to_ledger: boolean
          business_state_tax_application_mode: string
          business_state_tax_base: string
          business_state_tax_company_ids: string[]
          business_state_tax_enabled: boolean
          business_state_tax_rate: number
          created_at: string
          deduction_strategy: string
          deduction_type: string
          enabled_deduction_types: string[]
          enabled_income_sources: Json
          enabled_personal_income_types: string[]
          filing_status: string
          flat_federal_rate: number | null
          flat_state_rate: number | null
          household_additional_w2_job_enabled: boolean
          household_business_1099_income_enabled: boolean
          household_investment_income_enabled: boolean
          household_k1_partnership_income_enabled: boolean
          household_other_income_enabled: boolean
          household_rental_income_enabled: boolean
          household_scorp_income_enabled: boolean
          household_spouse_w2_income_enabled: boolean
          household_w2_income_enabled: boolean
          hsa_enabled: boolean
          hsa_source_company_id: string | null
          id: string
          income_profile_type: string
          itemized_deduction_amount: number
          last_year_tax: number
          manual_effective_tax_rate: number | null
          onboarding_banner_dismissed: boolean
          onboarding_complete: boolean | null
          onboarding_first_name: string
          organization_id: string | null
          other_dependents_count: number
          personal_state_tax_annual_estimate: number
          personal_state_tax_mode: string
          personal_state_tax_rate: number
          qualifying_children_count: number
          quarterly_tracker_method: string
          ss_wage_cap: number
          standard_deduction_override: number | null
          state_income_tax_enabled: boolean
          state_of_residence: string
          state_tax_enabled: boolean
          subscription_tier: string
          tax_mode: string
          tax_recommendation_method: string
          updated_at: string
          user_id: string
          withholding_method: string
          withholding_override_amount: number | null
          withholding_override_percent: number | null
          withholding_override_type: string
        }
        Insert: {
          auto_convert_future_income_to_ledger?: boolean
          business_state_tax_application_mode?: string
          business_state_tax_base?: string
          business_state_tax_company_ids?: string[]
          business_state_tax_enabled?: boolean
          business_state_tax_rate?: number
          created_at?: string
          deduction_strategy?: string
          deduction_type?: string
          enabled_deduction_types?: string[]
          enabled_income_sources?: Json
          enabled_personal_income_types?: string[]
          filing_status?: string
          flat_federal_rate?: number | null
          flat_state_rate?: number | null
          household_additional_w2_job_enabled?: boolean
          household_business_1099_income_enabled?: boolean
          household_investment_income_enabled?: boolean
          household_k1_partnership_income_enabled?: boolean
          household_other_income_enabled?: boolean
          household_rental_income_enabled?: boolean
          household_scorp_income_enabled?: boolean
          household_spouse_w2_income_enabled?: boolean
          household_w2_income_enabled?: boolean
          hsa_enabled?: boolean
          hsa_source_company_id?: string | null
          id?: string
          income_profile_type?: string
          itemized_deduction_amount?: number
          last_year_tax?: number
          manual_effective_tax_rate?: number | null
          onboarding_banner_dismissed?: boolean
          onboarding_complete?: boolean | null
          onboarding_first_name?: string
          organization_id?: string | null
          other_dependents_count?: number
          personal_state_tax_annual_estimate?: number
          personal_state_tax_mode?: string
          personal_state_tax_rate?: number
          qualifying_children_count?: number
          quarterly_tracker_method?: string
          ss_wage_cap?: number
          standard_deduction_override?: number | null
          state_income_tax_enabled?: boolean
          state_of_residence?: string
          state_tax_enabled?: boolean
          subscription_tier?: string
          tax_mode?: string
          tax_recommendation_method?: string
          updated_at?: string
          user_id: string
          withholding_method?: string
          withholding_override_amount?: number | null
          withholding_override_percent?: number | null
          withholding_override_type?: string
        }
        Update: {
          auto_convert_future_income_to_ledger?: boolean
          business_state_tax_application_mode?: string
          business_state_tax_base?: string
          business_state_tax_company_ids?: string[]
          business_state_tax_enabled?: boolean
          business_state_tax_rate?: number
          created_at?: string
          deduction_strategy?: string
          deduction_type?: string
          enabled_deduction_types?: string[]
          enabled_income_sources?: Json
          enabled_personal_income_types?: string[]
          filing_status?: string
          flat_federal_rate?: number | null
          flat_state_rate?: number | null
          household_additional_w2_job_enabled?: boolean
          household_business_1099_income_enabled?: boolean
          household_investment_income_enabled?: boolean
          household_k1_partnership_income_enabled?: boolean
          household_other_income_enabled?: boolean
          household_rental_income_enabled?: boolean
          household_scorp_income_enabled?: boolean
          household_spouse_w2_income_enabled?: boolean
          household_w2_income_enabled?: boolean
          hsa_enabled?: boolean
          hsa_source_company_id?: string | null
          id?: string
          income_profile_type?: string
          itemized_deduction_amount?: number
          last_year_tax?: number
          manual_effective_tax_rate?: number | null
          onboarding_banner_dismissed?: boolean
          onboarding_complete?: boolean | null
          onboarding_first_name?: string
          organization_id?: string | null
          other_dependents_count?: number
          personal_state_tax_annual_estimate?: number
          personal_state_tax_mode?: string
          personal_state_tax_rate?: number
          qualifying_children_count?: number
          quarterly_tracker_method?: string
          ss_wage_cap?: number
          standard_deduction_override?: number | null
          state_income_tax_enabled?: boolean
          state_of_residence?: string
          state_tax_enabled?: boolean
          subscription_tier?: string
          tax_mode?: string
          tax_recommendation_method?: string
          updated_at?: string
          user_id?: string
          withholding_method?: string
          withholding_override_amount?: number | null
          withholding_override_percent?: number | null
          withholding_override_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_attachments: {
        Row: {
          caption: string | null
          company_id: string | null
          created_at: string
          extracted_amount: number | null
          extracted_date: string | null
          extracted_vendor: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string | null
          id: string
          ocr_status: string | null
          organization_id: string | null
          thumbnail_path: string | null
          transaction_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          caption?: string | null
          company_id?: string | null
          created_at?: string
          extracted_amount?: number | null
          extracted_date?: string | null
          extracted_vendor?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          ocr_status?: string | null
          organization_id?: string | null
          thumbnail_path?: string | null
          transaction_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          caption?: string | null
          company_id?: string | null
          created_at?: string
          extracted_amount?: number | null
          extracted_date?: string | null
          extracted_vendor?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string | null
          id?: string
          ocr_status?: string | null
          organization_id?: string | null
          thumbnail_path?: string | null
          transaction_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_attachments_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_attachments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_links: {
        Row: {
          confidence_score: number | null
          created_at: string
          created_by_user: boolean
          id: string
          linked_at: string
          linked_group_id: string
          manual_transaction_id: string | null
          organization_id: string | null
          plaid_transaction_record_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          created_by_user?: boolean
          id?: string
          linked_at?: string
          linked_group_id: string
          manual_transaction_id?: string | null
          organization_id?: string | null
          plaid_transaction_record_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          created_by_user?: boolean
          id?: string
          linked_at?: string
          linked_group_id?: string
          manual_transaction_id?: string | null
          organization_id?: string | null
          plaid_transaction_record_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_links_manual_transaction_id_fkey"
            columns: ["manual_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_links_plaid_transaction_record_id_fkey"
            columns: ["plaid_transaction_record_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_match_ignores: {
        Row: {
          created_at: string
          id: string
          manual_transaction_id: string | null
          organization_id: string | null
          plaid_transaction_record_id: string | null
          reason: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          manual_transaction_id?: string | null
          organization_id?: string | null
          plaid_transaction_record_id?: string | null
          reason?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          manual_transaction_id?: string | null
          organization_id?: string | null
          plaid_transaction_record_id?: string | null
          reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_match_ignores_manual_transaction_id_fkey"
            columns: ["manual_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_match_ignores_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_match_ignores_plaid_transaction_record_id_fkey"
            columns: ["plaid_transaction_record_id"]
            isOneToOne: false
            referencedRelation: "plaid_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          account_source: string
          actual_withholding: number
          amount: number
          assignment_source: string
          category: string
          company_type: string
          created_at: string
          entity: string
          excluded_from_reports: boolean
          id: string
          is_recurring: boolean
          linked_group_id: string | null
          match_status: string
          needs_review: boolean
          notes: string | null
          organization_id: string | null
          origin_planner_conversion_id: string | null
          origin_type: string
          parent_transaction_id: string | null
          plaid_transaction_ref: string | null
          receipt_url: string | null
          recommended_withholding: number
          recurring_frequency: string | null
          schedule_c_category: string | null
          source_id: string | null
          source_type: string
          status: string
          transaction_date: string
          transaction_type: string
          transfer_subtype: string | null
          updated_at: string
          user_edited: boolean
          user_id: string
          vendor: string
          withholding_saved: boolean
        }
        Insert: {
          account_source?: string
          actual_withholding?: number
          amount?: number
          assignment_source?: string
          category?: string
          company_type?: string
          created_at?: string
          entity?: string
          excluded_from_reports?: boolean
          id?: string
          is_recurring?: boolean
          linked_group_id?: string | null
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          organization_id?: string | null
          origin_planner_conversion_id?: string | null
          origin_type?: string
          parent_transaction_id?: string | null
          plaid_transaction_ref?: string | null
          receipt_url?: string | null
          recommended_withholding?: number
          recurring_frequency?: string | null
          schedule_c_category?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          transaction_date?: string
          transaction_type?: string
          transfer_subtype?: string | null
          updated_at?: string
          user_edited?: boolean
          user_id: string
          vendor?: string
          withholding_saved?: boolean
        }
        Update: {
          account_source?: string
          actual_withholding?: number
          amount?: number
          assignment_source?: string
          category?: string
          company_type?: string
          created_at?: string
          entity?: string
          excluded_from_reports?: boolean
          id?: string
          is_recurring?: boolean
          linked_group_id?: string | null
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          organization_id?: string | null
          origin_planner_conversion_id?: string | null
          origin_type?: string
          parent_transaction_id?: string | null
          plaid_transaction_ref?: string | null
          receipt_url?: string | null
          recommended_withholding?: number
          recurring_frequency?: string | null
          schedule_c_category?: string | null
          source_id?: string | null
          source_type?: string
          status?: string
          transaction_date?: string
          transaction_type?: string
          transfer_subtype?: string | null
          updated_at?: string
          user_edited?: boolean
          user_id?: string
          vendor?: string
          withholding_saved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "transactions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_origin_planner_conversion_id_fkey"
            columns: ["origin_planner_conversion_id"]
            isOneToOne: false
            referencedRelation: "planner_conversions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      plaid_items_safe: {
        Row: {
          created_at: string | null
          cursor: string | null
          id: string | null
          institution_id: string | null
          institution_name: string | null
          item_id: string | null
          last_synced_at: string | null
          organization_id: string | null
          status: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          cursor?: string | null
          id?: string | null
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string | null
          last_synced_at?: string | null
          organization_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          cursor?: string | null
          id?: string | null
          institution_id?: string | null
          institution_name?: string | null
          item_id?: string | null
          last_synced_at?: string | null
          organization_id?: string | null
          status?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plaid_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_user_org_ids: { Args: { _user_id: string }; Returns: string[] }
      has_org_role: {
        Args: {
          _org_id: string
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      install_planner_cron_job: {
        Args: { _secret: string }
        Returns: undefined
      }
      is_org_admin_or_owner: {
        Args: { _org_id: string; _user_id: string }
        Returns: boolean
      }
      store_plaid_token_in_vault: {
        Args: { _item_id: string; _token: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "owner" | "admin" | "member"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner", "admin", "member"],
    },
  },
} as const
