import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export interface TaxPayment {
  id: string;
  user_id: string;
  organization_id: string | null;
  payment_date: string;
  amount: number;
  quarter: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useTaxPayments() {
  return useQuery({
    queryKey: ["tax_payments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_payments")
        .select("*")
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return (data || []) as TaxPayment[];
    },
  });
}

export function useAddTaxPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<TaxPayment>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("tax_payments").insert({
        user_id: user.id,
        organization_id: orgId,
        payment_date: entry.payment_date || new Date().toISOString().split("T")[0],
        amount: entry.amount || 0,
        quarter: entry.quarter || "Q1",
        notes: entry.notes || "",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_payments"] });
      toast.success("Payment logged");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateTaxPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<TaxPayment> & { id: string }) => {
      const { error } = await supabase.from("tax_payments").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_payments"] });
      toast.success("Payment updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteTaxPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tax_payments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tax_payments"] });
      toast.success("Payment deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
