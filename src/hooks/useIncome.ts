import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export interface IncomeEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  company: string;
  income_type: string;
  income_date: string;
  paycheck_amount: number;
  deposited_amount: number;
  taxes_withheld: number;
  pre_tax_deductions: number;
  retirement_401k: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useIncomeEntries() {
  return useQuery({
    queryKey: ["income_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_entries")
        .select("*")
        .order("income_date", { ascending: false });
      if (error) throw error;
      return (data || []) as IncomeEntry[];
    },
  });
}

export function useAddIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<IncomeEntry>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("income_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        name: entry.name || "",
        company: entry.company || "",
        income_type: entry.income_type || "1099",
        income_date: entry.income_date || new Date().toISOString().split("T")[0],
        paycheck_amount: entry.paycheck_amount || 0,
        deposited_amount: entry.deposited_amount || 0,
        taxes_withheld: entry.taxes_withheld || 0,
        pre_tax_deductions: entry.pre_tax_deductions || 0,
        retirement_401k: entry.retirement_401k || 0,
        notes: entry.notes || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Income entry added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<IncomeEntry> & { id: string }) => {
      const { error } = await supabase
        .from("income_entries")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Income entry updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("income_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Income entry deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}
