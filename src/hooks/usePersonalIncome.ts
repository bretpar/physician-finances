import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toCanonicalIncomeType } from "@/lib/filingTypes";

export interface PersonalIncomeEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  company: string;
  income_type: string;
  income_date: string;
  gross_amount: number;
  paycheck_amount: number;
  cost_basis: number | null;
  realized_gain_loss: number | null;
  federal_withholding: number;
  state_withholding: number;
  taxes_withheld: number;
  pre_tax_deductions: number;
  retirement_401k: number;
  source_bucket: string;
  tax_category: string;
  is_actual: boolean;
  include_in_tax_estimate: boolean;
  include_in_cash_flow: boolean;
  notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Fetch only personal (non-business, actual) income entries */
export function usePersonalIncomeEntries() {
  return useQuery({
    queryKey: ["personal_income_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_entries")
        .select("*")
        .eq("source_bucket", "personal")
        .eq("is_actual", true)
        .order("income_date", { ascending: false });
      if (error) throw error;
      return (data || []) as PersonalIncomeEntry[];
    },
  });
}

export function useAddPersonalIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<PersonalIncomeEntry>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("income_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        name: entry.name || "",
        company: entry.company || "",
        income_type: toCanonicalIncomeType(entry.income_type),
        income_date: entry.income_date || new Date().toISOString().split("T")[0],
        gross_amount: entry.gross_amount || 0,
        paycheck_amount: entry.paycheck_amount || entry.gross_amount || 0,
        cost_basis: entry.cost_basis ?? null,
        realized_gain_loss: entry.realized_gain_loss ?? null,
        federal_withholding: entry.federal_withholding || 0,
        state_withholding: entry.state_withholding || 0,
        taxes_withheld: entry.taxes_withheld || entry.federal_withholding || 0,
        pre_tax_deductions: entry.pre_tax_deductions || 0,
        retirement_401k: entry.retirement_401k || 0,
        source_bucket: "personal",
        tax_category: entry.tax_category || "ordinary",
        is_actual: true,
        include_in_tax_estimate: true,
        include_in_cash_flow: false,
        notes: entry.notes || "",
        status: "received",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Personal income added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdatePersonalIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PersonalIncomeEntry> & { id: string }) => {
      const safe: any = { ...updates };
      if (typeof safe.income_type === "string") {
        safe.income_type = toCanonicalIncomeType(safe.income_type);
      }
      const { error } = await supabase
        .from("income_entries")
        .update(safe)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Income entry updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeletePersonalIncome() {
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
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Income entry deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}
