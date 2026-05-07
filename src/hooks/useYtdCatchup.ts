import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export type YtdCatchupSourceType = "w2" | "1099_k1" | "other";

export interface YtdCatchupEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  tax_year: number;
  source_type: YtdCatchupSourceType;
  company_id: string | null;
  company_name: string;
  period_start: string;
  period_end: string;
  gross_income: number;
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
  retirement_401k: number;
  hsa_contribution: number;
  healthcare_premiums: number;
  dental_vision: number;
  other_pretax: number;
  post_tax_deductions: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export type YtdCatchupInput = Partial<Omit<YtdCatchupEntry, "id" | "user_id" | "organization_id" | "created_at" | "updated_at">>;

const KEY = ["ytd_catchup_entries"] as const;

export function useYtdCatchupEntries() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ytd_catchup_entries" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as YtdCatchupEntry[];
    },
  });
}

export function useUpsertYtdCatchup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: YtdCatchupInput & { id?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const row = {
        ...input,
        user_id: user.id,
        organization_id: orgId,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from("ytd_catchup_entries" as any)
          .update(row as any)
          .eq("id", input.id)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase
        .from("ytd_catchup_entries" as any)
        .insert(row as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("YTD catch-up saved");
    },
    onError: (e: any) => toast.error(e.message || "Could not save catch-up entry"),
  });
}

export function useDeleteYtdCatchup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ytd_catchup_entries" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      toast.success("YTD catch-up removed");
    },
  });
}

/**
 * Aggregate YTD catch-up totals to feed the tax engine.
 * Add these to actuals from income_entries dated AFTER the catch-up period_end
 * to get true YTD figures.
 */
export interface YtdCatchupTotals {
  grossIncome: number;
  federalWithholding: number;
  stateWithholding: number;
  ssWithholding: number;
  medicareWithholding: number;
  preTaxDeductions: number;
  retirement401k: number;
  hsaContribution: number;
  postTaxDeductions: number;
  /** Latest catch-up period_end across all entries — actual income should be summed AFTER this date. */
  latestPeriodEnd: string | null;
}

export function aggregateYtdCatchup(entries: YtdCatchupEntry[] | undefined, taxYear?: number): YtdCatchupTotals {
  const empty: YtdCatchupTotals = {
    grossIncome: 0, federalWithholding: 0, stateWithholding: 0,
    ssWithholding: 0, medicareWithholding: 0, preTaxDeductions: 0,
    retirement401k: 0, hsaContribution: 0, postTaxDeductions: 0,
    latestPeriodEnd: null,
  };
  if (!entries?.length) return empty;
  const year = taxYear ?? new Date().getFullYear();
  const filtered = entries.filter((e) => e.tax_year === year);
  return filtered.reduce<YtdCatchupTotals>((acc, e) => {
    acc.grossIncome += Number(e.gross_income) || 0;
    acc.federalWithholding += Number(e.federal_withholding) || 0;
    acc.stateWithholding += Number(e.state_withholding) || 0;
    acc.ssWithholding += Number(e.ss_withholding) || 0;
    acc.medicareWithholding += Number(e.medicare_withholding) || 0;
    acc.retirement401k += Number(e.retirement_401k) || 0;
    acc.hsaContribution += Number(e.hsa_contribution) || 0;
    acc.preTaxDeductions += (Number(e.healthcare_premiums) || 0)
      + (Number(e.dental_vision) || 0)
      + (Number(e.other_pretax) || 0)
      + (Number(e.retirement_401k) || 0)
      + (Number(e.hsa_contribution) || 0);
    acc.postTaxDeductions += Number(e.post_tax_deductions) || 0;
    if (!acc.latestPeriodEnd || e.period_end > acc.latestPeriodEnd) acc.latestPeriodEnd = e.period_end;
    return acc;
  }, empty);
}
