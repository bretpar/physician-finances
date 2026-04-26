import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type WithholdingMethod = "flat_estimate" | "dynamic_actual" | "dynamic_planner";
export type QuarterlyTrackerMethod = "even" | "dynamic";
export type DeductionType = "standard" | "itemized";
export type WithholdingOverrideType = "none" | "percent" | "amount";
export type PersonalStateTaxMode = "none" | "flat_rate" | "annual_estimate";
export type BusinessStateTaxBase = "net_profit" | "gross";
export type BusinessStateTaxApplicationMode = "all_business" | "selected";

export interface TaxRates {
  id?: string;
  // Core profile
  filingStatus: "single" | "married_filing_jointly";
  lastYearTax: number;
  standardDeductionOverride: number | null;
  ssWageCap: number;
  taxMode: "projected_brackets" | "manual_effective_rate";
  manualEffectiveTaxRate: number | null;
  withholdingMethod: WithholdingMethod;
  // New tax profile fields
  deductionType: DeductionType;
  itemizedDeductionAmount: number;
  qualifyingChildrenCount: number;
  otherDependentsCount: number;
  withholdingOverrideType: WithholdingOverrideType;
  withholdingOverridePercent: number | null;
  withholdingOverrideAmount: number | null;
  // ─── State Tax ───
  stateIncomeTaxEnabled: boolean;
  /** Backwards-compatible alias for personal state income tax only. */
  stateTaxEnabled: boolean;
  stateOfResidence: string;
  personalStateTaxMode: PersonalStateTaxMode;
  personalStateTaxRate: number;              // percent (e.g. 4.5 = 4.5%)
  personalStateTaxAnnualEstimate: number;    // dollars
  businessStateTaxEnabled: boolean;
  businessStateTaxRate: number;              // percent
  businessStateTaxBase: BusinessStateTaxBase;
  businessStateTaxApplicationMode: BusinessStateTaxApplicationMode;
  businessStateTaxCompanyIds: string[];
  // ─── HSA ───
  hsaEnabled: boolean;
  hsaSourceCompanyId: string | null;
  // ─── Forecasting Automation ───
  /** Auto-convert future planned income into real ledger drafts on/after their date. */
  autoConvertFutureIncomeToLedger: boolean;
  // ─── Quarterly Tax Tracker ───
  /** How the dashboard Quarterly Tax Progress card computes each quarter's target. */
  quarterlyTrackerMethod: QuarterlyTrackerMethod;
}

const DEFAULT_RATES: TaxRates = {
  filingStatus: "single",
  lastYearTax: 0,
  standardDeductionOverride: null,
  ssWageCap: 168600,
  taxMode: "projected_brackets",
  manualEffectiveTaxRate: null,
  withholdingMethod: "dynamic_planner",
  deductionType: "standard",
  itemizedDeductionAmount: 0,
  qualifyingChildrenCount: 0,
  otherDependentsCount: 0,
  withholdingOverrideType: "none",
  withholdingOverridePercent: null,
  withholdingOverrideAmount: null,
  stateIncomeTaxEnabled: false,
  stateTaxEnabled: false,
  stateOfResidence: "",
  personalStateTaxMode: "none",
  personalStateTaxRate: 0,
  personalStateTaxAnnualEstimate: 0,
  businessStateTaxEnabled: false,
  businessStateTaxRate: 0,
  businessStateTaxBase: "net_profit",
  businessStateTaxApplicationMode: "all_business",
  businessStateTaxCompanyIds: [],
  hsaEnabled: false,
  hsaSourceCompanyId: null,
  autoConvertFutureIncomeToLedger: false,
  quarterlyTrackerMethod: "even",
};

export function useTaxSettings() {
  return useQuery({
    queryKey: ["tax_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_settings")
        .select("*")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULT_RATES;
      const d = data as any;
      return {
        id: data.id,
        filingStatus: (data.filing_status as TaxRates["filingStatus"]) || "single",
        lastYearTax: Number(data.last_year_tax) || 0,
        standardDeductionOverride: data.standard_deduction_override != null ? Number(data.standard_deduction_override) : null,
        ssWageCap: Number(data.ss_wage_cap) || 168600,
        taxMode: (d.tax_mode as TaxRates["taxMode"]) || "projected_brackets",
        manualEffectiveTaxRate: d.manual_effective_tax_rate != null ? Number(d.manual_effective_tax_rate) : null,
        withholdingMethod: (d.withholding_method as WithholdingMethod) || "dynamic_planner",
        deductionType: (d.deduction_type as DeductionType) || "standard",
        itemizedDeductionAmount: Number(d.itemized_deduction_amount) || 0,
        qualifyingChildrenCount: Number(d.qualifying_children_count) || 0,
        otherDependentsCount: Number(d.other_dependents_count) || 0,
        withholdingOverrideType: (d.withholding_override_type as WithholdingOverrideType) || "none",
        withholdingOverridePercent: d.withholding_override_percent != null ? Number(d.withholding_override_percent) : null,
        withholdingOverrideAmount: d.withholding_override_amount != null ? Number(d.withholding_override_amount) : null,
        stateIncomeTaxEnabled: !!(d.state_income_tax_enabled ?? d.state_tax_enabled),
        stateTaxEnabled: !!(d.state_income_tax_enabled ?? d.state_tax_enabled),
        stateOfResidence: (d.state_of_residence as string) || "",
        personalStateTaxMode: (d.personal_state_tax_mode as PersonalStateTaxMode) || "none",
        personalStateTaxRate: Number(d.personal_state_tax_rate) || 0,
        personalStateTaxAnnualEstimate: Number(d.personal_state_tax_annual_estimate) || 0,
        businessStateTaxEnabled: !!d.business_state_tax_enabled,
        businessStateTaxRate: Number(d.business_state_tax_rate) || 0,
        businessStateTaxBase: (d.business_state_tax_base as BusinessStateTaxBase) || "net_profit",
        businessStateTaxApplicationMode: (d.business_state_tax_application_mode as BusinessStateTaxApplicationMode) || "all_business",
        businessStateTaxCompanyIds: Array.isArray(d.business_state_tax_company_ids) ? (d.business_state_tax_company_ids as string[]) : [],
        hsaEnabled: !!d.hsa_enabled,
        hsaSourceCompanyId: (d.hsa_source_company_id as string | null) ?? null,
        autoConvertFutureIncomeToLedger: !!d.auto_convert_future_income_to_ledger,
        quarterlyTrackerMethod: (d.quarterly_tracker_method as QuarterlyTrackerMethod) || "even",
      } as TaxRates;
    },
  });
}

export function useUpdateTaxSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<TaxRates> & { id: string }) => {
      const { id, ...rest } = settings;
      const payload: Record<string, unknown> = {};
      if (rest.filingStatus !== undefined) payload.filing_status = rest.filingStatus;
      if (rest.lastYearTax !== undefined) payload.last_year_tax = rest.lastYearTax;
      if (rest.standardDeductionOverride !== undefined) payload.standard_deduction_override = rest.standardDeductionOverride;
      if (rest.ssWageCap !== undefined) payload.ss_wage_cap = rest.ssWageCap;
      if (rest.withholdingMethod !== undefined) payload.withholding_method = rest.withholdingMethod;
      if (rest.manualEffectiveTaxRate !== undefined) payload.manual_effective_tax_rate = rest.manualEffectiveTaxRate;
      if (rest.deductionType !== undefined) payload.deduction_type = rest.deductionType;
      if (rest.itemizedDeductionAmount !== undefined) payload.itemized_deduction_amount = rest.itemizedDeductionAmount;
      if (rest.qualifyingChildrenCount !== undefined) payload.qualifying_children_count = rest.qualifyingChildrenCount;
      if (rest.otherDependentsCount !== undefined) payload.other_dependents_count = rest.otherDependentsCount;
      if (rest.withholdingOverrideType !== undefined) payload.withholding_override_type = rest.withholdingOverrideType;
      if (rest.withholdingOverridePercent !== undefined) payload.withholding_override_percent = rest.withholdingOverridePercent;
      if (rest.withholdingOverrideAmount !== undefined) payload.withholding_override_amount = rest.withholdingOverrideAmount;
      if (rest.stateIncomeTaxEnabled !== undefined) {
        payload.state_income_tax_enabled = rest.stateIncomeTaxEnabled;
      }
      if (rest.stateTaxEnabled !== undefined) {
        payload.state_income_tax_enabled = rest.stateTaxEnabled;
        payload.state_tax_enabled = rest.stateTaxEnabled;
      }
      if (rest.stateOfResidence !== undefined) payload.state_of_residence = rest.stateOfResidence;
      if (rest.personalStateTaxMode !== undefined) payload.personal_state_tax_mode = rest.personalStateTaxMode;
      if (rest.personalStateTaxRate !== undefined) payload.personal_state_tax_rate = rest.personalStateTaxRate;
      if (rest.personalStateTaxAnnualEstimate !== undefined) payload.personal_state_tax_annual_estimate = rest.personalStateTaxAnnualEstimate;
      if (rest.businessStateTaxEnabled !== undefined) payload.business_state_tax_enabled = rest.businessStateTaxEnabled;
      if (rest.businessStateTaxRate !== undefined) payload.business_state_tax_rate = rest.businessStateTaxRate;
      if (rest.businessStateTaxBase !== undefined) payload.business_state_tax_base = rest.businessStateTaxBase;
      if (rest.businessStateTaxApplicationMode !== undefined) payload.business_state_tax_application_mode = rest.businessStateTaxApplicationMode;
      if (rest.businessStateTaxCompanyIds !== undefined) payload.business_state_tax_company_ids = rest.businessStateTaxCompanyIds;
      if (rest.hsaEnabled !== undefined) payload.hsa_enabled = rest.hsaEnabled;
      if (rest.hsaSourceCompanyId !== undefined) payload.hsa_source_company_id = rest.hsaSourceCompanyId;
      if (rest.autoConvertFutureIncomeToLedger !== undefined) payload.auto_convert_future_income_to_ledger = rest.autoConvertFutureIncomeToLedger;
      if ((rest as any).quarterlyTrackerMethod !== undefined) payload.quarterly_tracker_method = (rest as any).quarterlyTrackerMethod;

      const { error } = await supabase.from("tax_settings").update(payload as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_settings"] });
      qc.invalidateQueries({ queryKey: ["tax_settings", "auto_convert_flag"] });
      toast.success("Tax settings saved", { duration: 1500 });
    },
    onError: (e) => toast.error(e.message),
  });
}
