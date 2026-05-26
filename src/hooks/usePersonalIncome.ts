import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toCanonicalIncomeType } from "@/lib/filingTypes";
import { isBusinessIncomeType } from "@/lib/ledgerRouting";

export interface PersonalIncomeEntry {
  id: string;
  user_id: string;
  organization_id: string | null;
  name: string;
  company: string;
  source_id: string | null;
  income_type: string;
  /** Original UI subtype (e.g. "w2_user", "dividend") preserved across edits. */
  ui_income_subtype: string | null;
  income_date: string;
  gross_amount: number;
  paycheck_amount: number;
  deposited_amount: number;
  cost_basis: number | null;
  realized_gain_loss: number | null;
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
  taxes_withheld: number;
  pre_tax_deductions: number;
  retirement_401k: number;
  healthcare_deduction: number;
  hsa_contribution: number;
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

/** Fetch only personal (non-business, actual) income entries.
 *  Entries that have been linked to another entry (status='merged') are
 *  hidden so totals/ledger count the linked group once. */
export function usePersonalIncomeEntries() {
  return useQuery({
    queryKey: ["personal_income_entries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("income_entries")
        .select("*")
        .eq("source_bucket", "personal")
        .eq("is_actual", true)
        .neq("status", "merged")
        .order("income_date", { ascending: false });
      if (error) throw error;
      const rows = (data || []) as PersonalIncomeEntry[];
      return rows.filter((r) => !isBusinessIncomeType(r.income_type));
    },
  });
}

/** Numeric coercion that preserves explicit 0 and rejects NaN.
 *  IMPORTANT: never use `||` for money fields — it turns a legit $0 into a
 *  fallback value and breaks lossless round-tripping of W-2 paychecks. */
function money(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Build the canonical income_entries row from a partial entry. Used by both
 *  add (insert) and update (spread) paths so every W-2 / paycheck field is
 *  guaranteed to persist and round-trip losslessly. */
export function buildIncomeEntryRow(
  entry: Partial<PersonalIncomeEntry> & { ui_income_subtype?: string | null; additional_tax_reserve?: number; base_tax_estimate?: number; dynamic_tax_recommendation?: number; quarterly_adjustment_amount?: number; recommendation_status?: string },
) {
  const gross = money(entry.gross_amount);
  // paycheck_amount mirrors gross when the caller did not provide it
  // explicitly (e.g. older code paths). Use ?? so an explicit 0 is preserved.
  const paycheck = entry.paycheck_amount ?? gross;
  // deposited_amount falls back to paycheck → gross only when undefined.
  const deposited = entry.deposited_amount ?? paycheck ?? gross;
  // taxes_withheld is the canonical "Total Federal Payroll Taxes" total.
  // Preserve explicit values (including 0) — do NOT fall back to a split
  // component, which would double-count or hide the user's intent.
  const taxesWithheld = entry.taxes_withheld ?? 0;
  return {
    name: entry.name ?? "",
    company: entry.company ?? "",
    source_id: entry.source_id ?? null,
    income_type: toCanonicalIncomeType(entry.income_type),
    ui_income_subtype: entry.ui_income_subtype ?? entry.income_type ?? null,
    income_date: entry.income_date || new Date().toISOString().split("T")[0],
    gross_amount: gross,
    paycheck_amount: money(paycheck),
    deposited_amount: money(deposited),
    cost_basis: entry.cost_basis ?? null,
    realized_gain_loss: entry.realized_gain_loss ?? null,
    federal_withholding: money(entry.federal_withholding),
    state_withholding: money(entry.state_withholding),
    ss_withholding: money(entry.ss_withholding),
    medicare_withholding: money(entry.medicare_withholding),
    taxes_withheld: money(taxesWithheld),
    pre_tax_deductions: money(entry.pre_tax_deductions),
    retirement_401k: money(entry.retirement_401k),
    healthcare_deduction: money(entry.healthcare_deduction),
    hsa_contribution: money(entry.hsa_contribution),
    additional_tax_reserve: money(entry.additional_tax_reserve),
    base_tax_estimate: money(entry.base_tax_estimate),
    dynamic_tax_recommendation: money(entry.dynamic_tax_recommendation),
    quarterly_adjustment_amount: money(entry.quarterly_adjustment_amount),
    recommendation_status: entry.recommendation_status ?? "on_track",
    source_bucket: "personal",
    tax_category: entry.tax_category ?? "ordinary",
    is_actual: true,
    include_in_tax_estimate: entry.include_in_tax_estimate ?? true,
    include_in_cash_flow: entry.include_in_cash_flow ?? false,
    notes: entry.notes ?? "",
    status: entry.status ?? "received",
  };
}

export function useAddPersonalIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entry: Partial<PersonalIncomeEntry> & { ui_income_subtype?: string | null }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      if (isBusinessIncomeType(entry.income_type)) {
        throw new Error(
          "1099, K-1, and S-Corp Distribution income belongs in Business Activity, not Personal Income.",
        );
      }
      const orgId = await getUserOrgId();
      const row = buildIncomeEntryRow(entry);
      const { data, error } = await supabase
        .from("income_entries")
        .insert({ user_id: user.id, organization_id: orgId, ...row } as any)
        .select("id")
        .single();
      if (error) throw error;
      return data as { id: string } | null;
    },
    onSuccess: async () => {
      // Await the personal-income refetch so the ledger is guaranteed to be
      // reconciled by the time the mutation Promise resolves. Automated audits
      // (and the post-save success marker on PersonalIncome) rely on this
      // ordering — otherwise the row may not yet be visible when the test
      // queries for it.
      await Promise.all([
        qc.refetchQueries({ queryKey: ["personal_income_entries"] }),
        qc.invalidateQueries({ queryKey: ["income_entries"] }),
      ]);
      toast.success("Personal income added");
    },
    onError: (e) => toast.error(e.message),
  });
}


export function useUpdatePersonalIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<PersonalIncomeEntry> & { id: string; ui_income_subtype?: string | null }) => {
      if (isBusinessIncomeType(updates.income_type)) {
        throw new Error(
          "1099, K-1, and S-Corp Distribution income belongs in Business Activity, not Personal Income.",
        );
      }
      const safe: any = { ...updates };
      if (typeof safe.income_type === "string") {
        // Preserve the UI subtype before canonicalizing (unless caller already set one).
        if (safe.ui_income_subtype === undefined) {
          safe.ui_income_subtype = safe.income_type;
        }
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
