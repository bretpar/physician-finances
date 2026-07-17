import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { HsaContributionType } from "@/lib/hsaComputation";

/** Legacy source_type union — preserved for backward compatibility on reads. */
export type HsaSourceType = "payroll" | "individual";
export type HsaCreatedFrom = "income" | "manual";
/** Employee vs employer role for paycheck-linked rows (nullable for manual/legacy). */
export type HsaLinkedIncomeEntryRole = "employee" | "employer" | null;

export interface HsaContribution {
  id: string;
  user_id: string;
  organization_id: string | null;
  contribution_date: string;
  amount: number;
  company_id: string | null;
  income_entry_id: string | null;
  /** Legacy — kept for backward compat. Prefer `contribution_type`. */
  source_type: HsaSourceType;
  /** Canonical type. Always present after 2026-08 migration. */
  contribution_type: HsaContributionType;
  /** For paycheck-linked rows only. */
  linked_income_entry_role: HsaLinkedIncomeEntryRole;
  created_from: HsaCreatedFrom;
  notes: string | null;
  tax_year: number;
  created_at: string;
  updated_at: string;
}

const QK = ["hsa_contributions"] as const;

export function useHsaContributions(taxYear?: number) {
  return useQuery({
    queryKey: [...QK, taxYear ?? "all"],
    queryFn: async () => {
      let q = supabase.from("hsa_contributions" as any).select("*").order("contribution_date", { ascending: false });
      if (taxYear) q = q.eq("tax_year", taxYear);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as HsaContribution[];
    },
  });
}

export interface ManualHsaInput {
  contribution_date: string;
  amount: number;
  company_id: string | null;
  notes?: string;
  tax_year?: number;
}

export function useAddManualHsaContribution() {
  const qc = useQueryClient();
  const { user, organizationId } = useAuth();
  return useMutation({
    mutationFn: async (input: ManualHsaInput) => {
      if (!user) throw new Error("Not authenticated");
      const year = input.tax_year ?? new Date(input.contribution_date).getFullYear();
      const payload = {
        user_id: user.id,
        organization_id: organizationId,
        contribution_date: input.contribution_date,
        amount: input.amount,
        company_id: input.company_id,
        income_entry_id: null,
        source_type: "individual" as HsaSourceType,
        contribution_type: "individual" as HsaContributionType,
        linked_income_entry_role: null,
        created_from: "manual" as HsaCreatedFrom,
        notes: input.notes ?? "",
        tax_year: year,
      };
      const { error } = await (supabase.from("hsa_contributions" as any) as any).insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("HSA contribution added", { duration: 1500 });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUpdateHsaContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<HsaContribution> & { id: string }) => {
      const { error } = await (supabase.from("hsa_contributions" as any) as any).update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("HSA contribution updated", { duration: 1500 });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteHsaContribution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("hsa_contributions" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QK });
      toast.success("HSA contribution deleted", { duration: 1500 });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

/**
 * Auto-sync helper used by income-entry save flows for a single role
 * (employee or employer) on a paycheck. Ensures exactly one HSA row of the
 * given role exists for the income_entry:
 *   - amount > 0 + no existing row → INSERT
 *   - amount > 0 + existing row    → UPDATE (preserve id, update amount/date/company/year)
 *   - amount <= 0 + existing row   → DELETE (the field was cleared)
 *
 * Returns the linked row's id (or null if none/deleted) so the caller can
 * persist the appropriate `linked_*_hsa_contribution_id` back onto the entry.
 */
export async function syncPayrollHsaForIncome(opts: {
  userId: string;
  organizationId: string | null;
  incomeEntryId: string;
  existingHsaId: string | null;
  amount: number;
  contributionDate: string;
  companyId: string | null;
  /** "employee" (default — Section 125 payroll HSA) or "employer". */
  role?: "employee" | "employer";
}): Promise<string | null> {
  const {
    userId,
    organizationId,
    incomeEntryId,
    existingHsaId,
    amount,
    contributionDate,
    companyId,
    role = "employee",
  } = opts;
  const year = new Date(contributionDate).getFullYear();
  const contribution_type: HsaContributionType =
    role === "employer" ? "employer" : "employee_payroll";
  // Legacy source_type is not applicable to employer contributions — keep the
  // closest existing value ("payroll") so legacy readers still see it as a
  // payroll-side row and don't misclassify it as an individual deduction.
  const source_type: HsaSourceType = "payroll";

  // Existing row → update or delete
  if (existingHsaId) {
    if (amount > 0) {
      const { error } = await (supabase.from("hsa_contributions" as any) as any)
        .update({
          amount,
          contribution_date: contributionDate,
          company_id: companyId,
          tax_year: year,
          contribution_type,
          linked_income_entry_role: role,
          source_type,
        })
        .eq("id", existingHsaId);
      if (error) throw error;
      return existingHsaId;
    } else {
      const { error } = await (supabase.from("hsa_contributions" as any) as any)
        .delete()
        .eq("id", existingHsaId);
      if (error) throw error;
      return null;
    }
  }

  // No existing row, no amount → no-op
  if (amount <= 0) return null;

  // No existing row, amount > 0 → insert
  const payload = {
    user_id: userId,
    organization_id: organizationId,
    contribution_date: contributionDate,
    amount,
    company_id: companyId,
    income_entry_id: incomeEntryId,
    source_type,
    contribution_type,
    linked_income_entry_role: role,
    created_from: "income" as HsaCreatedFrom,
    notes: "",
    tax_year: year,
  };
  const { data, error } = await (supabase.from("hsa_contributions" as any) as any)
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return (data?.id as string) ?? null;
}
