import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TaxRates {
  federalRate: number;
  stateRate: number;
  bnoRate: number;
}

const DEFAULT_RATES: TaxRates = { federalRate: 20, stateRate: 0, bnoRate: 1.5 };

export function useTaxSettings() {
  return useQuery({
    queryKey: ["tax_settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_settings")
        .select("federal_rate, state_rate, bno_rate")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return DEFAULT_RATES;
      return {
        federalRate: Number(data.federal_rate),
        stateRate: Number(data.state_rate),
        bnoRate: Number(data.bno_rate),
      } as TaxRates;
    },
  });
}
