import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { useMemo, useCallback } from "react";
import { isW2FilingType, isSelfEmployedFilingType, toCanonicalIncomeType } from "@/lib/filingTypes";
import { syncIncomeEntryHsa, deleteLinkedPayrollHsaForIncomeEntry } from "@/lib/incomeEntryHsaSync";

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
  source_id: string | null;
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
      // Prefer a canonical, caller-supplied recommended_withholding when
      // provided (e.g. BusinessActivity passes the visible computed value so
      // the saved row matches what the user saw). Only fall back to the
      // legacy 35%/25% combined-rate estimate when nothing was supplied.
      // Explicit 0 is preserved as 0 — it means "no recommendation needed".
      const taxWithheld = entry.taxes_withheld || 0;
      const preTaxDed = (entry.pre_tax_deductions || 0) + (entry.retirement_401k || 0);
      const taxableForThis = Math.max(0, paycheckAmount - preTaxDed);
      const suppliedRecommended = (entry as any).recommended_withholding;
      const hasSuppliedRecommended =
        suppliedRecommended !== undefined &&
        suppliedRecommended !== null &&
        Number.isFinite(Number(suppliedRecommended));
      const isSelfEmployed = isSelfEmployedFilingType(entry.income_type);
      const estimatedRate = isSelfEmployed ? 0.35 : 0.25; // rough combined rate fallback
      const recommendedWithholding = hasSuppliedRecommended
        ? Number(suppliedRecommended)
        : Math.max(0, (taxableForThis * estimatedRate) - taxWithheld);

      // Source of truth for revenue/tax = gross (paycheck) amount.
      // deposited_amount is stored separately on income_entries for matching/cashflow.
      const { data: txData, error: txError } = await supabase.from("transactions").insert({
        user_id: user.id,
        organization_id: orgId,
        transaction_date: incomeDate,
        vendor: entry.name || entry.company || "",
        amount: paycheckAmount,
        account_source: "",
        category: "Income",
        notes: entry.notes || "",
        entity: entry.company || "Unassigned",
        company_type: entry.income_type || "1099_schedule_c",
        source_id: (entry as any).source_id || null,
        transaction_type: "income",
        // (transactions.company_type accepts free text — keep the descriptive
        // filing type here for tax routing; only income_entries.income_type is
        // constrained to the canonical 4 values.)
        recommended_withholding: Math.round(recommendedWithholding * 100) / 100,
        actual_withholding: Number((entry as any).actual_withholding || 0),
        withholding_saved: Number((entry as any).actual_withholding || 0) > 0,
      } as any).select("id").single();
      if (txError) throw txError;

      // 2. Create the income_entries record (detailed breakdown for tax engine)
      const { data: entryData, error } = await supabase.from("income_entries").insert({
        user_id: user.id,
        organization_id: orgId,
        name: entry.name || "",
        company: entry.company || "",
        income_type: toCanonicalIncomeType(entry.income_type),
        income_date: incomeDate,
        paycheck_amount: paycheckAmount,
        deposited_amount: entry.deposited_amount || 0,
        taxes_withheld: entry.taxes_withheld || 0,
        pre_tax_deductions: entry.pre_tax_deductions || 0,
        retirement_401k: entry.retirement_401k || 0,
        healthcare_deduction: (entry as any).healthcare_deduction || 0,
        hsa_contribution: (entry as any).hsa_contribution || 0,
        employer_hsa_contribution: (entry as any).employer_hsa_contribution || 0,
        source_id: (entry as any).source_id || null,
        notes: entry.notes || "",
        status: (entry.status as string) || "received",
        linked_transaction_id: txData?.id || null,
        base_tax_estimate: (entry as any).base_tax_estimate || 0,
        dynamic_tax_recommendation: (entry as any).dynamic_tax_recommendation || 0,
        quarterly_adjustment_amount: (entry as any).quarterly_adjustment_amount || 0,
        additional_tax_reserve: (entry as any).additional_tax_reserve || 0,
        recommendation_status: (entry as any).recommendation_status || "on_track",
      } as any).select("id").single();
      if (error) throw error;

      const transactionId = (txData as { id: string } | null)?.id || null;
      const incomeEntryId = (entryData as { id: string } | null)?.id || null;

      // 3. Sync payroll HSA into hsa_contributions ledger atomically.
      // If the RPC fails we MUST roll back the just-created income + tx rows
      // so the paycheck save is all-or-nothing from the user's perspective.
      const hsaAmount = Number((entry as any).hsa_contribution || 0);
      const employerHsaAmount = Number((entry as any).employer_hsa_contribution || 0);
      if (incomeEntryId && (hsaAmount > 0 || employerHsaAmount > 0)) {
        try {
          await syncIncomeEntryHsa({
            incomeEntryId,
            amount: hsaAmount,
            employerAmount: employerHsaAmount,
            contributionDate: incomeDate,
            companyId: (entry as any).source_id || null,
          });
        } catch (hsaErr) {
          // CASCADE on the HSA FK will delete any partially-inserted HSA row
          // when we delete the parent income_entry below.
          try {
            await supabase.from("income_entries").delete().eq("id", incomeEntryId);
          } catch (rollbackErr) {
            console.error("[useAddIncome] income rollback failed", rollbackErr);
          }
          if (transactionId) {
            try {
              await supabase.from("transactions").delete().eq("id", transactionId);
            } catch (rollbackErr) {
              console.error("[useAddIncome] transaction rollback failed", rollbackErr);
            }
          }
          throw hsaErr;
        }
      }

      return { transactionId, incomeEntryId };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["hsa_contributions"] });
      qc.invalidateQueries({ queryKey: ["tax_estimate"] });
      toast.success("Income entry added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<IncomeEntry> & { id: string }) => {
      const safe: any = { ...updates };
      if (typeof safe.income_type === "string") {
        safe.income_type = toCanonicalIncomeType(safe.income_type);
      }

      const touchesEmployeeHsa = "hsa_contribution" in updates;
      const touchesEmployerHsa = "employer_hsa_contribution" in updates;

      // Snapshot the pre-update row so we can revert atomically if the HSA
      // sync fails. Only capture the fields we're about to mutate.
      let snapshot: Record<string, unknown> | null = null;
      if (touchesEmployeeHsa || touchesEmployerHsa) {
        const cols = Array.from(new Set([
          ...Object.keys(safe),
          "hsa_contribution",
          "employer_hsa_contribution",
          "income_date",
          "source_id",
          "user_id",
          "organization_id",
        ])).join(", ");
        const { data: before } = await supabase
          .from("income_entries")
          .select(cols)
          .eq("id", id)
          .maybeSingle();
        if (before) snapshot = before as any;
      }

      const { error } = await supabase
        .from("income_entries")
        .update(safe)
        .eq("id", id);
      if (error) throw error;

      if (touchesEmployeeHsa || touchesEmployerHsa) {
        const nextEmployee = touchesEmployeeHsa
          ? Number((updates as any).hsa_contribution || 0)
          : undefined;
        const nextEmployer = touchesEmployerHsa
          ? Number((updates as any).employer_hsa_contribution || 0)
          : undefined;
        try {
          await syncIncomeEntryHsa({
            incomeEntryId: id,
            amount: nextEmployee,
            employerAmount: nextEmployer,
            contributionDate: (updates as any).income_date,
            companyId: (updates as any).source_id ?? null,
          });
        } catch (hsaErr) {
          // Revert the income_entry to its pre-update state so the caller sees
          // a clean rollback. If the revert itself fails we surface the
          // original HSA error and log the revert failure.
          if (snapshot) {
            const revert: Record<string, unknown> = {};
            for (const k of Object.keys(safe)) {
              revert[k] = (snapshot as any)[k];
            }
            try {
              await supabase
                .from("income_entries")
                .update(revert as any)
                .eq("id", id);
            } catch (rollbackErr) {
              console.error("[useUpdateIncome] revert failed", rollbackErr);
            }
          }
          throw hsaErr;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["hsa_contributions"] });
      qc.invalidateQueries({ queryKey: ["tax_estimate"] });
      toast.success("Income entry updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // ON DELETE CASCADE on hsa_contributions.income_entry_id removes any
      // linked payroll/employer HSA rows atomically with the parent delete.
      const { error } = await supabase
        .from("income_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["hsa_contributions"] });
      qc.invalidateQueries({ queryKey: ["tax_estimate"] });
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
        const isW2 = isW2FilingType(e.income_type);

        return {
          total: acc.total + amt,
          w2: acc.w2 + (isW2 ? amt : 0),
          se: acc.se + (!isW2 ? amt : 0),
          withheld: acc.withheld + Number(e.taxes_withheld) * weight,
          preTax: acc.preTax + Number(e.pre_tax_deductions) * weight,
          retirement: acc.retirement + Number(e.retirement_401k) * weight,
        };
      },
      { total: 0, w2: 0, se: 0, withheld: 0, preTax: 0, retirement: 0 }
    );
  }, [entries]);
}
