import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";

export type InvestmentIncomeType = "short_term_sale" | "long_term_sale" | "dividend";

export interface InvestmentIncomeEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  entry_date: string;
  investment_income_type: InvestmentIncomeType;
  asset_name_or_ticker: string;
  sale_proceeds: number | null;
  cost_basis: number | null;
  taxable_amount: number;
  tax_recommendation: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

export const investmentIncomeTypeLabels: Record<InvestmentIncomeType, string> = {
  short_term_sale: "Short-term sale",
  long_term_sale: "Long-term sale",
  dividend: "Dividend",
};

export function calculateInvestmentTaxableAmount(args: {
  type: InvestmentIncomeType;
  saleProceeds: number;
  costBasis: number;
  taxableAmountOverride?: number | null;
}) {
  if (args.type === "dividend") return args.taxableAmountOverride ?? 0;
  return args.taxableAmountOverride ?? args.saleProceeds - args.costBasis;
}

export function aggregateInvestmentTaxBuckets(entries: InvestmentIncomeEntry[]) {
  const buckets = entries.reduce(
    (acc, entry) => {
      const amount = Number(entry.taxable_amount || 0);
      if (entry.investment_income_type === "short_term_sale") acc.shortTermSales += amount;
      if (entry.investment_income_type === "long_term_sale") acc.longTermSales += amount;
      if (entry.investment_income_type === "dividend") acc.dividends += amount;
      return acc;
    },
    { shortTermSales: 0, longTermSales: 0, dividends: 0 },
  );

  const salesNet = buckets.shortTermSales + buckets.longTermSales;
  // TODO: apply annual capital loss limitation rules here when the app supports carryovers/annual limits.
  return {
    ...buckets,
    totalTaxableIncome: buckets.shortTermSales + buckets.longTermSales + buckets.dividends,
    netSalesForCurrentTaxEngine: Math.max(0, salesNet),
    ordinaryInvestmentIncome: buckets.shortTermSales + buckets.dividends,
    longTermCapitalGain: buckets.longTermSales,
  };
}

export function useInvestmentIncomeEntries() {
  return useQuery({
    queryKey: ["investment_income_entries"],
    queryFn: async () => {
      const client = supabase as any;
      const { data, error } = await client
        .from("investment_income_entries")
        .select("*")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as InvestmentIncomeEntry[];
    },
  });
}

export function useAddInvestmentIncomeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<InvestmentIncomeEntry>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const client = supabase as any;
      const { error } = await client.from("investment_income_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        entry_date: entry.entry_date || new Date().toISOString().split("T")[0],
        investment_income_type: entry.investment_income_type || "short_term_sale",
        asset_name_or_ticker: entry.asset_name_or_ticker || "",
        sale_proceeds: entry.sale_proceeds ?? null,
        cost_basis: entry.cost_basis ?? null,
        taxable_amount: entry.taxable_amount || 0,
        tax_recommendation: entry.tax_recommendation || 0,
        notes: entry.notes || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investment_income_entries"] });
      toast.success("Investment income added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateInvestmentIncomeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<InvestmentIncomeEntry> & { id: string }) => {
      const client = supabase as any;
      const { error } = await client.from("investment_income_entries").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investment_income_entries"] });
      toast.success("Investment income updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInvestmentIncomeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const client = supabase as any;
      const { error } = await client.from("investment_income_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investment_income_entries"] });
      toast.success("Investment income deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
