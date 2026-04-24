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
  /** Legacy quarter label kept in sync with applied_quarter. */
  quarter: string;
  /** Tax quarter the payment is intended to satisfy (Q1–Q4). Source of truth. */
  applied_quarter: string;
  /** Tax year the payment is intended to satisfy. Source of truth. */
  applied_tax_year: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function inferAppliedYear(paymentDate: string, appliedQuarter: string): number {
  const d = new Date(paymentDate + "T00:00:00");
  const y = d.getFullYear();
  // Q4 payments are commonly made in January for the prior tax year.
  if (appliedQuarter === "Q4" && d.getMonth() === 0) return y - 1;
  return y;
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
      // Normalize: ensure applied_quarter / applied_tax_year are populated for older rows.
      return ((data || []) as any[]).map((p) => ({
        ...p,
        applied_quarter: p.applied_quarter || p.quarter || "Q1",
        applied_tax_year:
          p.applied_tax_year ?? inferAppliedYear(p.payment_date, p.applied_quarter || p.quarter || "Q1"),
      })) as TaxPayment[];
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
      const paymentDate = entry.payment_date || new Date().toISOString().split("T")[0];
      const appliedQuarter = entry.applied_quarter || entry.quarter || "Q1";
      const appliedYear = entry.applied_tax_year ?? inferAppliedYear(paymentDate, appliedQuarter);
      const { error } = await supabase.from("tax_payments").insert({
        user_id: user.id,
        organization_id: orgId,
        payment_date: paymentDate,
        amount: entry.amount || 0,
        quarter: appliedQuarter,
        applied_quarter: appliedQuarter,
        applied_tax_year: appliedYear,
        notes: entry.notes || "",
      } as any);
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
      // Keep legacy `quarter` mirrored to `applied_quarter` if the latter changes.
      const patch: any = { ...updates };
      if (patch.applied_quarter && !patch.quarter) patch.quarter = patch.applied_quarter;
      const { error } = await supabase.from("tax_payments").update(patch).eq("id", id);
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
