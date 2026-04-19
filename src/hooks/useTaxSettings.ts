import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type WithholdingMethod = "flat_estimate" | "dynamic_actual" | "dynamic_planner";
export type DeductionType = "standard" | "itemized";
export type WithholdingOverrideType = "none" | "percent" | "amount";

export interface TaxRates {
  id?: string;
  // Legacy fields (kept for backward compatibility, shown under "Legacy / Advanced")
  federalRate: number;
  stateRate: number;
  bnoRate: number;
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
}

const DEFAULT_RATES: TaxRates = {
  federalRate: 20,
  stateRate: 0,
  bnoRate: 1.5,
  filingStatus: "single",
  lastYearTax: 0,
  standardDeductionOverride: null,
  ssWageCap: 168600,
  taxMode: "projected_brackets",
  manualEffectiveTaxRate: null,
  withholdingMethod: "dynamic_actual",
  deductionType: "standard",
  itemizedDeductionAmount: 0,
  qualifyingChildrenCount: 0,
  otherDependentsCount: 0,
  withholdingOverrideType: "none",
  withholdingOverridePercent: null,
  withholdingOverrideAmount: null,
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
        federalRate: Number(data.federal_rate),
        stateRate: Number(data.state_rate),
        bnoRate: Number(data.bno_rate),
        filingStatus: (data.filing_status as TaxRates["filingStatus"]) || "single",
        lastYearTax: Number(data.last_year_tax) || 0,
        standardDeductionOverride: data.standard_deduction_override != null ? Number(data.standard_deduction_override) : null,
        ssWageCap: Number(data.ss_wage_cap) || 168600,
        taxMode: (d.tax_mode as TaxRates["taxMode"]) || "projected_brackets",
        manualEffectiveTaxRate: d.manual_effective_tax_rate != null ? Number(d.manual_effective_tax_rate) : null,
        withholdingMethod: (d.withholding_method as WithholdingMethod) || "dynamic_actual",
        deductionType: (d.deduction_type as DeductionType) || "standard",
        itemizedDeductionAmount: Number(d.itemized_deduction_amount) || 0,
        qualifyingChildrenCount: Number(d.qualifying_children_count) || 0,
        otherDependentsCount: Number(d.other_dependents_count) || 0,
        withholdingOverrideType: (d.withholding_override_type as WithholdingOverrideType) || "none",
        withholdingOverridePercent: d.withholding_override_percent != null ? Number(d.withholding_override_percent) : null,
        withholdingOverrideAmount: d.withholding_override_amount != null ? Number(d.withholding_override_amount) : null,
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
      if (rest.federalRate !== undefined) payload.federal_rate = rest.federalRate;
      if (rest.stateRate !== undefined) payload.state_rate = rest.stateRate;
      if (rest.bnoRate !== undefined) payload.bno_rate = rest.bnoRate;
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

      const { error } = await supabase.from("tax_settings").update(payload as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_settings"] });
      toast.success("Tax settings saved", { duration: 1500 });
    },
    onError: (e) => toast.error(e.message),
  });
}
