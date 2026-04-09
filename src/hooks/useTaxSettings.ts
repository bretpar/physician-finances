import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface TaxRates {
  id?: string;
  federalRate: number;
  stateRate: number;
  bnoRate: number;
  filingStatus: "single" | "married_filing_jointly";
  lastYearTax: number;
  standardDeductionOverride: number | null;
  ssWageCap: number;
}

const DEFAULT_RATES: TaxRates = {
  federalRate: 20,
  stateRate: 0,
  bnoRate: 1.5,
  filingStatus: "single",
  lastYearTax: 0,
  standardDeductionOverride: null,
  ssWageCap: 168600,
};

export function useTaxSettings() {
  return useQuery({
    queryKey: ["tax_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_settings")
        .select("id, federal_rate, state_rate, bno_rate, filing_status, last_year_tax, standard_deduction_override, ss_wage_cap")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULT_RATES;
      return {
        id: data.id,
        federalRate: Number(data.federal_rate),
        stateRate: Number(data.state_rate),
        bnoRate: Number(data.bno_rate),
        filingStatus: (data.filing_status as TaxRates["filingStatus"]) || "single",
        lastYearTax: Number(data.last_year_tax) || 0,
        standardDeductionOverride: data.standard_deduction_override != null ? Number(data.standard_deduction_override) : null,
        ssWageCap: Number(data.ss_wage_cap) || 168600,
      } as TaxRates;
    },
  });
}

export function useUpdateTaxSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<TaxRates> & { id: string }) => {
      const { id, ...rest } = settings;
      const { error } = await supabase.from("tax_settings").update({
        ...(rest.federalRate !== undefined && { federal_rate: rest.federalRate }),
        ...(rest.stateRate !== undefined && { state_rate: rest.stateRate }),
        ...(rest.bnoRate !== undefined && { bno_rate: rest.bnoRate }),
        ...(rest.filingStatus !== undefined && { filing_status: rest.filingStatus }),
        ...(rest.lastYearTax !== undefined && { last_year_tax: rest.lastYearTax }),
        ...(rest.standardDeductionOverride !== undefined && { standard_deduction_override: rest.standardDeductionOverride }),
        ...(rest.ssWageCap !== undefined && { ss_wage_cap: rest.ssWageCap }),
      }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_settings"] });
      toast.success("Tax settings saved", { duration: 1500 });
    },
    onError: (e) => toast.error(e.message),
  });
}
