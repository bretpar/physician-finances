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
  /** Recommended tax savings (calculated by the engine, guidance only). */
  tax_recommendation: number;
  /** Actual tax amount the user moved into savings/withholding for this entry. Null = not yet saved. */
  actual_tax_saved?: number | null;
  /** Decimal rate used in the recommendation (e.g. 0.15). */
  tax_rate_used?: number | null;
  /** Tax method label, e.g. "long_term_capital_gains". */
  tax_method_used?: string | null;
  is_qualified_dividend?: boolean | null;
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
  let shortTermSales = 0;
  let longTermSales = 0;
  let qualifiedDividends = 0;
  let nonQualifiedDividends = 0;
  for (const e of entries) {
    const amount = Number(e.taxable_amount || 0);
    if (e.investment_income_type === "short_term_sale") shortTermSales += amount;
    else if (e.investment_income_type === "long_term_sale") longTermSales += amount;
    else if (e.investment_income_type === "dividend") {
      // Default to qualified when flag is null/undefined (legacy entries).
      if (e.is_qualified_dividend === false) nonQualifiedDividends += amount;
      else qualifiedDividends += amount;
    }
  }
  const dividends = qualifiedDividends + nonQualifiedDividends;
  // Bucket routing for the central tax engine:
  //  - Short-term sales (gain side) and non-qualified dividends → ordinary income.
  //  - Long-term sales (gain side) and qualified dividends → long-term capital gains.
  // NOTE: We do not yet apply the $3,000 annual capital loss limitation or
  // cross-bucket loss carryovers — losses only offset same-type gains here.
  const ordinaryInvestmentIncome = Math.max(0, shortTermSales) + Math.max(0, nonQualifiedDividends);
  const longTermCapitalGain = Math.max(0, longTermSales) + Math.max(0, qualifiedDividends);
  return {
    shortTermSales,
    longTermSales,
    dividends,
    qualifiedDividends,
    nonQualifiedDividends,
    totalTaxableIncome: shortTermSales + longTermSales + dividends,
    // Back-compat field — sum of net sales floored at zero.
    netSalesForCurrentTaxEngine: Math.max(0, shortTermSales + longTermSales),
    ordinaryInvestmentIncome,
    longTermCapitalGain,
  };
}

/** Total of user-entered actual tax savings across investment entries (null/blank = $0). */
export function sumInvestmentActualTaxSaved(entries: InvestmentIncomeEntry[]): number {
  return entries.reduce((s, e) => s + Math.max(0, Number(e.actual_tax_saved ?? 0)), 0);
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
        actual_tax_saved: entry.actual_tax_saved ?? null,
        tax_rate_used: entry.tax_rate_used ?? null,
        tax_method_used: entry.tax_method_used ?? null,
        is_qualified_dividend: entry.is_qualified_dividend ?? true,
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
