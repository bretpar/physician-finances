import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export interface StockTransaction {
  id: string;
  user_id: string;
  organization_id: string | null;
  sale_date: string;
  total_sale_amount: number;
  cost_basis: number;
  gain_loss: number;
  sale_type: string;
  estimated_tax: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useStockTransactions() {
  return useQuery({
    queryKey: ["stock_transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_transactions")
        .select("*")
        .order("sale_date", { ascending: false });
      if (error) throw error;
      return (data || []) as StockTransaction[];
    },
  });
}

export function useAddStockTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Partial<StockTransaction>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("stock_transactions").insert({
        user_id: user.id,
        organization_id: orgId,
        sale_date: tx.sale_date || new Date().toISOString().split("T")[0],
        total_sale_amount: tx.total_sale_amount || 0,
        cost_basis: tx.cost_basis || 0,
        gain_loss: tx.gain_loss || 0,
        sale_type: tx.sale_type || "short_term",
        estimated_tax: tx.estimated_tax || 0,
        notes: tx.notes || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_transactions"] });
      toast.success("Stock transaction added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateStockTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<StockTransaction> & { id: string }) => {
      const { error } = await supabase
        .from("stock_transactions")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_transactions"] });
      toast.success("Transaction updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteStockTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("stock_transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stock_transactions"] });
      toast.success("Transaction deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

// Long-term capital gains tax brackets (2024)
const LTCG_BRACKETS = [
  { threshold: 49450, rate: 0 },
  { threshold: 545500, rate: 0.15 },
  { threshold: Infinity, rate: 0.20 },
];

export function calculateStockTax(
  gainLoss: number,
  saleType: string,
  totalIncomeIncludingGain: number,
  marginalOrdinaryRate: number
): number {
  if (gainLoss <= 0) return 0;

  if (saleType === "short_term") {
    return gainLoss * marginalOrdinaryRate;
  }

  // Long-term
  for (const bracket of LTCG_BRACKETS) {
    if (totalIncomeIncludingGain <= bracket.threshold) {
      return gainLoss * bracket.rate;
    }
  }
  return gainLoss * 0.20;
}
