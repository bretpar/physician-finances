import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { useMemo, useCallback } from "react";

export type IncomeStatus = "projected" | "expected" | "received";

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
  status: IncomeStatus;
  linked_transaction_id: string | null;
  created_at: string;
  updated_at: string;
}

// Confidence weights for tax estimation
export const CONFIDENCE_WEIGHTS: Record<IncomeStatus, number> = {
  received: 1.0,
  expected: 0.9,
  projected: 0.75,
};

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
      const incomeDate = entry.income_date || new Date().toISOString().split("T")[0];
      const paycheckAmount = entry.paycheck_amount || 0;

      // 1. Create the transaction record (source of truth for ledger)
      // Calculate recommended withholding for this income
      const taxWithheld = entry.taxes_withheld || 0;
      const preTaxDed = (entry.pre_tax_deductions || 0) + (entry.retirement_401k || 0);
      const taxableForThis = Math.max(0, paycheckAmount - preTaxDed);
      // Use a simple combined rate estimate (federal + SE if 1099)
      const isSelfEmployed = entry.income_type === "1099" || entry.income_type === "K1";
      const estimatedRate = isSelfEmployed ? 0.35 : 0.25; // rough combined rate
      const recommendedWithholding = Math.max(0, (taxableForThis * estimatedRate) - taxWithheld);

      const { data: txData, error: txError } = await supabase.from("transactions").insert({
        user_id: user.id,
        organization_id: orgId,
        transaction_date: incomeDate,
        vendor: entry.name || entry.company || "",
        amount: entry.deposited_amount || paycheckAmount,
        account_source: "",
        category: "Income",
        notes: entry.notes || "",
        entity: entry.company || "Unassigned",
        company_type: entry.income_type || "1099",
        transaction_type: "income",
        recommended_withholding: Math.round(recommendedWithholding * 100) / 100,
        withholding_saved: false,
      } as any).select("id").single();
      if (txError) throw txError;

      // 2. Create the income_entries record (detailed breakdown for tax engine)
      const { error } = await supabase.from("income_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        name: entry.name || "",
        company: entry.company || "",
        income_type: entry.income_type || "1099",
        income_date: incomeDate,
        paycheck_amount: paycheckAmount,
        deposited_amount: entry.deposited_amount || 0,
        taxes_withheld: entry.taxes_withheld || 0,
        pre_tax_deductions: entry.pre_tax_deductions || 0,
        retirement_401k: entry.retirement_401k || 0,
        notes: entry.notes || "",
        status: (entry.status as string) || "received",
        linked_transaction_id: txData?.id || null,
        base_tax_estimate: (entry as any).base_tax_estimate || 0,
        dynamic_tax_recommendation: (entry as any).dynamic_tax_recommendation || 0,
        quarterly_adjustment_amount: (entry as any).quarterly_adjustment_amount || 0,
        additional_tax_reserve: (entry as any).additional_tax_reserve || 0,
        recommendation_status: (entry as any).recommendation_status || "on_track",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
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
        .update(updates as any)
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

// Mark a projected/expected entry as received
export function useMarkReceived() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("income_entries")
        .update({ status: "received" } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Marked as received");
    },
    onError: (e) => toast.error(e.message),
  });
}

// Auto-transition past-date projected entries to expected
export function useAutoTransitionEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      // Move projected → expected for past dates
      const { error } = await supabase
        .from("income_entries")
        .update({ status: "expected" } as any)
        .eq("status", "projected")
        .lt("income_date", today);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
    },
  });
}

// Transaction matching: find projected/expected entries that match a transaction
export function useMatchTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      incomeId,
      transactionId,
      actualAmount,
    }: {
      incomeId: string;
      transactionId: string;
      actualAmount?: number;
    }) => {
      const updates: any = {
        status: "received",
        linked_transaction_id: transactionId,
      };
      if (actualAmount !== undefined) {
        updates.paycheck_amount = actualAmount;
      }
      const { error } = await supabase
        .from("income_entries")
        .update(updates)
        .eq("id", incomeId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Transaction matched to income entry");
    },
    onError: (e) => toast.error(e.message),
  });
}

// Drift detection: compare projected vs received
export function useIncomeDrift(entries: IncomeEntry[] | undefined) {
  return useMemo(() => {
    if (!entries || entries.length === 0) return null;

    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);
    const threeMonthsAgoStr = threeMonthsAgo.toISOString().split("T")[0];

    // Received entries in the last 3 months
    const recentReceived = entries.filter(
      (e) => e.status === "received" && e.income_date >= threeMonthsAgoStr
    );
    const totalReceived = recentReceived.reduce(
      (s, e) => s + Number(e.paycheck_amount),
      0
    );

    // All projected entries that were for this period
    const projected = entries.filter(
      (e) =>
        (e.status === "projected" || e.status === "expected") &&
        e.income_date >= threeMonthsAgoStr
    );
    const totalProjected = projected.reduce(
      (s, e) => s + Number(e.paycheck_amount),
      0
    );

    if (totalProjected === 0) return null;

    const driftPct = ((totalReceived - totalProjected) / totalProjected) * 100;

    if (Math.abs(driftPct) < 15) return null; // within acceptable range

    return {
      driftPct,
      totalReceived,
      totalProjected,
      isUnder: driftPct < 0,
      message:
        driftPct < 0
          ? `You are earning ${Math.abs(driftPct).toFixed(0)}% less than projected. Consider adjusting future income.`
          : `You are earning ${driftPct.toFixed(0)}% more than projected. Your tax liability may be higher.`,
    };
  }, [entries]);
}

// Entries that need attention (past-date projected/expected)
export function useStaleEntries(entries: IncomeEntry[] | undefined) {
  return useMemo(() => {
    if (!entries) return [];
    const today = new Date().toISOString().split("T")[0];
    return entries.filter(
      (e) =>
        (e.status === "projected" || e.status === "expected") &&
        e.income_date < today
    );
  }, [entries]);
}

// Weighted income for tax calculations
export function useWeightedIncome(entries: IncomeEntry[] | undefined) {
  return useMemo(() => {
    if (!entries) return { total: 0, w2: 0, se: 0, withheld: 0, preTax: 0, retirement: 0 };

    const today = new Date().toISOString().split("T")[0];

    return entries.reduce(
      (acc, e) => {
        // Skip past-date projected/expected (stale) — they shouldn't count
        if (
          (e.status === "projected" || e.status === "expected") &&
          e.income_date < today
        ) {
          return acc;
        }

        const weight = CONFIDENCE_WEIGHTS[e.status] ?? 1;
        const amt = Number(e.paycheck_amount) * weight;

        return {
          total: acc.total + amt,
          w2: acc.w2 + (e.income_type === "W2" ? amt : 0),
          se: acc.se + (e.income_type !== "W2" ? amt : 0),
          withheld: acc.withheld + Number(e.taxes_withheld) * weight,
          preTax: acc.preTax + Number(e.pre_tax_deductions) * weight,
          retirement: acc.retirement + Number(e.retirement_401k) * weight,
        };
      },
      { total: 0, w2: 0, se: 0, withheld: 0, preTax: 0, retirement: 0 }
    );
  }, [entries]);
}
