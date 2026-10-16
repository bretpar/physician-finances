/**
 * Read-only tax reconciliation export (Developer diagnostics).
 *
 * Builds a JSON snapshot of the signed-in account's stored records plus the
 * EXISTING calculation outputs. It performs no tax math and no writes.
 * Every dataset uses an explicit column allowlist so secrets (tokens, bank
 * account numbers, DOB, SSNs, provider payloads) can never leak in.
 */

export const RECONCILIATION_EXPORT_SCHEMA_VERSION = "1.1.0";

export function reconciliationFileName(taxYear: number): string {
  return `paycheckmd-tax-reconciliation-${taxYear}.json`;
}

/** Explicit per-table allowlists. Only these columns are requested and kept. */
export const RECONCILIATION_DATASETS = {
  companies: [
    "id", "name", "nickname", "company_type", "source_kind", "employee_role", "k1_tax_treatment",
    "apply_business_state_tax", "include_in_tax", "include_se_tax_in_recommendation",
    "archived_at", "merged_into_company_id", "pay_frequency", "projected_annual_gross",
    "remaining_paychecks_override", "expected_federal_withholding_per_paycheck",
    "current_extra_w4_withholding", "default_setaside_method", "default_setaside_pct",
    "advanced_field_visibility", "notes", "created_at", "updated_at",
  ],
  transactions: [
    "id", "transaction_date", "vendor", "entity", "amount", "transaction_type", "category",
    "schedule_c_category", "company_type", "source_id", "source_type", "status",
    "excluded_from_reports", "match_status", "needs_review", "linked_group_id",
    "parent_transaction_id", "linked_plaid_transaction_id", "linked_plaid_amount",
    "linked_plaid_posted_date", "plaid_transaction_ref", "origin_type",
    "origin_planner_conversion_id", "origin_ytd_catchup_id", "actual_withholding",
    "recommended_withholding", "withholding_saved", "transfer_subtype", "assignment_source",
    "user_edited", "is_recurring", "recurring_frequency", "notes", "created_at", "updated_at",
  ],
  income_entries: [
    "id", "name", "company", "source_id", "income_date", "income_type", "ui_income_subtype",
    "tax_category", "source_bucket", "entry_kind", "status", "is_actual",
    "include_in_tax_estimate", "include_in_cash_flow", "recommendation_status", "needs_review",
    "gross_amount", "paycheck_amount", "deposited_amount", "cost_basis", "realized_gain_loss",
    "federal_withholding", "state_withholding", "ss_withholding", "medicare_withholding",
    "taxes_withheld", "retirement_401k", "employer_retirement_contribution",
    "hsa_contribution", "employer_hsa_contribution", "healthcare_deduction",
    "pre_tax_deductions", "additional_tax_reserve", "base_tax_estimate",
    "dynamic_tax_recommendation", "quarterly_adjustment_amount", "linked_transaction_id",
    "linked_hsa_contribution_id", "linked_employer_hsa_contribution_id",
    "linked_ytd_catchup_id", "origin_planner_conversion_id", "origin_type", "notes",
    "created_at", "updated_at",
  ],
  projected_income_streams: [
    "id", "company", "company_type", "source_id", "ui_income_subtype", "pay_frequency",
    "custom_interval_days", "start_date", "end_date", "is_active", "include_in_tax",
    "paycheck_amount", "federal_withholding", "state_withholding", "ss_withholding",
    "medicare_withholding", "taxes_withheld", "retirement_401k",
    "employer_retirement_contribution", "hsa_contribution", "healthcare_deduction",
    "pre_tax_deductions", "additional_tax_reserve", "forecast_expense_per_period",
    "forecast_expense_notes", "notes", "created_at", "updated_at",
  ],
  projected_bonus_events: [
    "id", "stream_id", "name", "amount", "scheduled_date", "frequency", "taxes_withheld",
    "created_at", "updated_at",
  ],
  projected_income_overrides: [
    "id", "stream_id", "override_date", "new_date", "action", "has_detailed_breakdown",
    "paycheck_amount", "federal_withholding", "state_withholding", "ss_withholding",
    "medicare_withholding", "taxes_withheld", "retirement_401k",
    "employer_retirement_contribution", "hsa_contribution", "healthcare_deduction",
    "pre_tax_deductions", "additional_tax_reserve", "notes", "created_at", "updated_at",
  ],
  planner_conversions: [
    "id", "stream_id", "bonus_event_id", "occurrence_date", "status", "ledger_bucket",
    "transaction_id", "income_entry_id", "needs_review_reason", "created_at", "updated_at",
  ],
  ytd_catchup_entries: [
    "id", "tax_year", "period_start", "period_end", "company_id", "company_name",
    "owner_person", "source_type", "gross_income", "federal_withholding", "state_withholding",
    "ss_withholding", "medicare_withholding", "retirement_401k", "hsa_contribution",
    "healthcare_premiums", "dental_vision", "other_pretax", "post_tax_deductions",
    "business_expenses", "notes", "created_at", "updated_at",
  ],
  stock_transactions: [
    "id", "sale_date", "sale_type", "total_sale_amount", "cost_basis", "gain_loss",
    "estimated_tax", "notes", "created_at", "updated_at",
  ],
  retirement_contributions: [
    "id", "company_id", "account_type", "contribution_type", "contribution_amount",
    "employer_match", "contribution_date", "start_date", "end_date", "frequency",
    "apply_to_withholding", "notes", "created_at", "updated_at",
  ],
  hsa_contributions: [
    "id", "tax_year", "company_id", "contribution_date", "contribution_type", "amount",
    "source_type", "created_from", "income_entry_id", "linked_income_entry_role", "notes",
    "created_at", "updated_at",
  ],
  mileage_entries: [
    "id", "company_id", "company_name", "year", "month", "miles", "created_at", "updated_at",
  ],
  home_office_deductions: [
    "id", "tax_year", "company_id", "deduction_type", "method", "status", "square_feet",
    "calculated_amount", "allowed_amount", "unused_capped_amount", "prior_year_amount",
    "include_in_tax_calculation", "created_at", "updated_at",
  ],
  tax_payments: [
    "id", "payment_date", "applied_tax_year", "applied_quarter", "quarter", "amount", "notes",
    "created_at", "updated_at",
  ],
  investment_income_entries: [
    "id", "entry_date", "investment_income_type", "asset_name_or_ticker", "sale_proceeds",
    "cost_basis", "taxable_amount", "is_qualified_dividend", "tax_recommendation",
    "actual_tax_saved", "tax_rate_used", "tax_method_used", "notes", "created_at", "updated_at",
  ],
  transaction_links: [
    "id", "linked_group_id", "manual_transaction_id", "plaid_transaction_record_id", "status",
    "confidence_score", "linked_at", "created_by_user", "created_at", "updated_at",
  ],
  income_entry_links: [
    "id", "linked_group_id", "canonical_entry_id", "merged_entry_id", "status",
    "created_by_user", "created_at", "updated_at",
  ],
  tax_savings: ["id", "savings_date", "source", "amount", "notes", "created_at", "updated_at"],
  tax_settings: [
    "id", "filing_status", "tax_mode", "timezone", "state_of_residence", "deduction_type",
    "deduction_strategy", "standard_deduction_override", "tax_recommendation_method",
    "withholding_method", "withholding_override_type", "withholding_override_amount",
    "withholding_override_percent", "w2_paycheck_rec_method", "quarterly_tracker_method",
    "flat_federal_rate", "flat_state_rate", "manual_effective_tax_rate", "last_year_tax",
    "state_tax_enabled", "state_income_tax_enabled", "personal_state_tax_mode",
    "personal_state_tax_rate", "personal_state_tax_annual_estimate",
    "business_state_tax_enabled", "business_state_tax_rate", "business_state_tax_base",
    "business_state_tax_application_mode", "business_state_tax_company_ids",
    "custom_ss_wage_cap_enabled", "ss_wage_cap", "hsa_enabled", "hsa_coverage_type",
    "hsa_coverage_periods", "hsa_age55_catchup", "hsa_source_company_id",
    "itemized_deductions_enabled", "itemized_deduction_amount", "itemized_mortgage_interest",
    "itemized_mortgage_balance", "itemized_other_deductions", "salt_state_income_tax_mode",
    "salt_state_income_tax_manual", "salt_property_tax", "salt_personal_property_tax",
    "salt_sales_tax_base", "salt_sales_tax_large_purchases", "salt_force_sales_tax_election",
    "salt_cap_override", "student_loan_interest_annual", "qualifying_children_count",
    "other_dependents_count", "income_profile_type", "enabled_income_sources",
    "enabled_personal_income_types", "enabled_deduction_types", "ytd_catchup_choice",
    "auto_convert_future_income_to_ledger", "household_w2_income_enabled",
    "household_spouse_w2_income_enabled", "household_additional_w2_job_enabled",
    "household_business_1099_income_enabled", "household_k1_partnership_income_enabled",
    "household_scorp_income_enabled", "household_investment_income_enabled",
    "household_rental_income_enabled", "household_other_income_enabled", "updated_at",
  ],
} as const;

export type ReconciliationDatasetName = keyof typeof RECONCILIATION_DATASETS;

/**
 * Sensitive-key detection on WORD boundaries (camelCase + snake_case), so
 * legitimate calculation fields like `businessNonW2HsaAboveLine` (contains
 * the letters "ssn") are kept while real secrets are dropped.
 */
const FORBIDDEN_WORDS = new Set(["token", "tokens", "secret", "secrets", "password", "ssn", "vault"]);
const FORBIDDEN_PHRASES = [
  "access_key", "account_number", "routing_number", "date_of_birth", "receipt_url",
  "raw_payload", "raw_json", "plaid_item", "file_path", "thumbnail_path",
];
export function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
export function isForbiddenKey(key: string): boolean {
  const words = keyWords(key);
  if (words.some((w) => FORBIDDEN_WORDS.has(w))) return true;
  const joined = `_${words.join("_")}_`;
  return FORBIDDEN_PHRASES.some((p) => joined.includes(`_${p}_`));
}

export function pickAllowed<T extends Record<string, unknown>>(
  row: T,
  allowed: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of allowed) if (k in row) out[k] = row[k];
  return out;
}

/** Deep-strip forbidden keys from calculation outputs (they have no allowlist schema). */
export function stripForbidden(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    return typeof value === "number" && !Number.isFinite(value) ? String(value) : value;
  }
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) return stripForbidden(Object.fromEntries(value), seen);
  if (value instanceof Set) return stripForbidden([...value], seen);
  if (Array.isArray(value)) return value.map((v) => stripForbidden(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenKey(k) || typeof v === "function") continue;
    out[k] = stripForbidden(v, seen);
  }
  return out;
}

export type DatasetResult =
  | { status: "ok"; rows: Record<string, unknown>[]; truncated?: boolean; pages?: number }
  | { status: "error"; error: string };

export interface ReconciliationExportArgs {
  taxYear: number;
  generatedAt: Date;
  timezone: string;
  build: Record<string, string>;
  selectedTaxMode: string;
  datasets: Partial<Record<ReconciliationDatasetName, DatasetResult>>;
  /** Existing calculation outputs, each null when not available. */
  calculations: Record<string, unknown>;
  /** Read-only record-selection bridge (built from the canonical selection). */
  recordSelectionBridge?: unknown | null;
  /** Source-card vs canonical totals. */
  reconciliation?: unknown | null;
}

export function buildReconciliationExport(args: ReconciliationExportArgs) {
  const records: Record<string, unknown> = {};
  const counts: Record<string, number | null> = {};
  const unavailable: { dataset: string; reason: string }[] = [];

  for (const name of Object.keys(RECONCILIATION_DATASETS) as ReconciliationDatasetName[]) {
    const res = args.datasets[name];
    if (!res) {
      records[name] = null;
      counts[name] = null;
      unavailable.push({ dataset: name, reason: "not requested" });
    } else if (res.status === "error") {
      // Never substitute an empty list for a failed query.
      records[name] = { error: res.error };
      counts[name] = null;
      unavailable.push({ dataset: name, reason: res.error });
    } else if (res.truncated) {
      // Never certify a capped response.
      const allowed = RECONCILIATION_DATASETS[name];
      records[name] = res.rows.map((r) => pickAllowed(r, allowed));
      counts[name] = res.rows.length;
      unavailable.push({ dataset: name, reason: "truncated: more rows exist than were fetched" });
    } else {
      const allowed = RECONCILIATION_DATASETS[name];
      records[name] = res.rows.map((r) => pickAllowed(r, allowed));
      counts[name] = res.rows.length;
    }
  }

  const calculations: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args.calculations)) {
    if (v === null || v === undefined) {
      calculations[k] = { unavailable: true };
      unavailable.push({ dataset: `calculations.${k}`, reason: "not available from existing calculation" });
    } else {
      calculations[k] = stripForbidden(v);
    }
  }

  for (const k of ["recordSelectionBridge", "reconciliation"] as const) {
    if (args[k] === null || args[k] === undefined) {
      unavailable.push({ dataset: k, reason: "not available" });
    }
  }

  const settingsRes = args.datasets.tax_settings;
  const settingsRow = settingsRes?.status === "ok" ? settingsRes.rows[0] : undefined;

  return {
    metadata: {
      schemaVersion: RECONCILIATION_EXPORT_SCHEMA_VERSION,
      generatedAt: args.generatedAt.toISOString(),
      timezone: args.timezone,
      taxYear: args.taxYear,
      build: args.build,
      filingStatus: settingsRow?.filing_status ?? null,
      selectedTaxMode: args.selectedTaxMode,
      complete: unavailable.length === 0,
      recordCounts: counts,
      unavailable,
      notes: [
        "Records are exported unfiltered by year (as stored, within account access) so out-of-year inclusion can be investigated.",
        "calculations.* are the existing app outputs; no values were recalculated for this export.",
      ],
    },
    records,
    calculations,
    recordSelectionBridge: args.recordSelectionBridge == null ? { unavailable: true } : stripForbidden(args.recordSelectionBridge),
    reconciliation: args.reconciliation == null ? { unavailable: true } : stripForbidden(args.reconciliation),
  };
}
