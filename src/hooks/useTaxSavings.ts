import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export interface TaxSaving {
  id: string;
  user_id: string;
  organization_id: string | null;
  savings_date: string;
  amount: number;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useTaxSavings() {
  return useQuery({
    queryKey: ["tax_savings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_savings")
        .select("*")
        .order("savings_date", { ascending: false });
      if (error) throw error;
      return (data || []) as TaxSaving[];
    },
  });
}

export function useAddTaxSaving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<TaxSaving>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("tax_savings").insert({
        user_id: user.id,
        organization_id: orgId,
        savings_date: entry.savings_date || new Date().toISOString().split("T")[0],
        amount: entry.amount || 0,
        source: entry.source || "manual",
        notes: entry.notes || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_savings"] });
      toast.success("Tax savings entry added");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTaxSaving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TaxSaving> & { id: string }) => {
      const { error } = await supabase
        .from("tax_savings")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_savings"] });
      toast.success("Entry updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteTaxSaving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tax_savings")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_savings"] });
      toast.success("Entry deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
