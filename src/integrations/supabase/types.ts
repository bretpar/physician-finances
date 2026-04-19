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
          company_type: string
          created_at: string
          default_setaside_method: string
          default_setaside_pct: number | null
          id: string
          include_in_tax: boolean
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
          company_type?: string
          created_at?: string
          default_setaside_method?: string
          default_setaside_pct?: number | null
          id?: string
          include_in_tax?: boolean
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
          company_type?: string
          created_at?: string
          default_setaside_method?: string
          default_setaside_pct?: number | null
          id?: string
          include_in_tax?: boolean
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
          id: string
          include_in_cash_flow: boolean
          include_in_tax_estimate: boolean
          income_date: string
          income_type: string
          is_actual: boolean
          linked_transaction_id: string | null
          name: string
          notes: string | null
          organization_id: string | null
          owner_healthcare: number
          paycheck_amount: number
          pre_tax_deductions: number
          quarterly_adjustment_amount: number
          realized_gain_loss: number | null
          recommendation_status: string
          retirement_401k: number
          source_bucket: string
          source_id: string | null
          state_withholding: number
          status: string
          tax_category: string
          taxes_withheld: number
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
          id?: string
          include_in_cash_flow?: boolean
          include_in_tax_estimate?: boolean
          income_date?: string
          income_type?: string
          is_actual?: boolean
          linked_transaction_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          owner_healthcare?: number
          paycheck_amount?: number
          pre_tax_deductions?: number
          quarterly_adjustment_amount?: number
          realized_gain_loss?: number | null
          recommendation_status?: string
          retirement_401k?: number
          source_bucket?: string
          source_id?: string | null
          state_withholding?: number
          status?: string
          tax_category?: string
          taxes_withheld?: number
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
          id?: string
          include_in_cash_flow?: boolean
          include_in_tax_estimate?: boolean
          income_date?: string
          income_type?: string
          is_actual?: boolean
          linked_transaction_id?: string | null
          name?: string
          notes?: string | null
          organization_id?: string | null
          owner_healthcare?: number
          paycheck_amount?: number
          pre_tax_deductions?: number
          quarterly_adjustment_amount?: number
          realized_gain_loss?: number | null
          recommendation_status?: string
          retirement_401k?: number
          source_bucket?: string
          source_id?: string | null
          state_withholding?: number
          status?: string
          tax_category?: string
          taxes_withheld?: number
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
      mileage_entries: {
        Row: {
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
          company: string
          company_type: string
          created_at: string
          custom_interval_days: number | null
          end_date: string | null
          id: string
          include_in_tax: boolean
          is_active: boolean
          organization_id: string | null
          pay_frequency: string
          paycheck_amount: number
          pre_tax_deductions: number
          retirement_401k: number
          source_id: string | null
          start_date: string
          taxes_withheld: number
          updated_at: string
          user_id: string
        }
        Insert: {
          company?: string
          company_type?: string
          created_at?: string
          custom_interval_days?: number | null
          end_date?: string | null
          id?: string
          include_in_tax?: boolean
          is_active?: boolean
          organization_id?: string | null
          pay_frequency?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          retirement_401k?: number
          source_id?: string | null
          start_date?: string
          taxes_withheld?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          company?: string
          company_type?: string
          created_at?: string
          custom_interval_days?: number | null
          end_date?: string | null
          id?: string
          include_in_tax?: boolean
          is_active?: boolean
          organization_id?: string | null
          pay_frequency?: string
          paycheck_amount?: number
          pre_tax_deductions?: number
          retirement_401k?: number
          source_id?: string | null
          start_date?: string
          taxes_withheld?: number
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
          bno_rate: number
          created_at: string
          federal_rate: number
          filing_status: string
          id: string
          last_year_tax: number
          manual_effective_tax_rate: number | null
          organization_id: string | null
          ss_wage_cap: number
          standard_deduction_override: number | null
          state_rate: number
          tax_mode: string
          updated_at: string
          user_id: string
          withholding_method: string
        }
        Insert: {
          bno_rate?: number
          created_at?: string
          federal_rate?: number
          filing_status?: string
          id?: string
          last_year_tax?: number
          manual_effective_tax_rate?: number | null
          organization_id?: string | null
          ss_wage_cap?: number
          standard_deduction_override?: number | null
          state_rate?: number
          tax_mode?: string
          updated_at?: string
          user_id: string
          withholding_method?: string
        }
        Update: {
          bno_rate?: number
          created_at?: string
          federal_rate?: number
          filing_status?: string
          id?: string
          last_year_tax?: number
          manual_effective_tax_rate?: number | null
          organization_id?: string | null
          ss_wage_cap?: number
          standard_deduction_override?: number | null
          state_rate?: number
          tax_mode?: string
          updated_at?: string
          user_id?: string
          withholding_method?: string
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
          is_deleted: boolean
          is_recurring: boolean
          linked_group_id: string | null
          match_status: string
          needs_review: boolean
          notes: string | null
          organization_id: string | null
          parent_transaction_id: string | null
          plaid_transaction_ref: string | null
          receipt_url: string | null
          recommended_withholding: number
          recurring_frequency: string | null
          schedule_c_category: string | null
          source_id: string | null
          source_type: string
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
          is_deleted?: boolean
          is_recurring?: boolean
          linked_group_id?: string | null
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          organization_id?: string | null
          parent_transaction_id?: string | null
          plaid_transaction_ref?: string | null
          receipt_url?: string | null
          recommended_withholding?: number
          recurring_frequency?: string | null
          schedule_c_category?: string | null
          source_id?: string | null
          source_type?: string
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
          is_deleted?: boolean
          is_recurring?: boolean
          linked_group_id?: string | null
          match_status?: string
          needs_review?: boolean
          notes?: string | null
          organization_id?: string | null
          parent_transaction_id?: string | null
          plaid_transaction_ref?: string | null
          receipt_url?: string | null
          recommended_withholding?: number
          recurring_frequency?: string | null
          schedule_c_category?: string | null
          source_id?: string | null
          source_type?: string
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
