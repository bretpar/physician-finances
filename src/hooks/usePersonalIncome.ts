import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toCanonicalIncomeType } from "@/lib/filingTypes";
import { isBusinessIncomeType } from "@/lib/ledgerRouting";
import { getTodayLocalDateString } from "@/lib/localDate";
import { syncIncomeEntryHsa, deleteLinkedPayrollHsaForIncomeEntry } from "@/lib/incomeEntryHsaSync";

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
    income_date: entry.income_date || getTodayLocalDateString(),
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
      const created = data as { id: string } | null;

      // Canonical payroll HSA sync.
      if (created?.id && Number((row as any).hsa_contribution || 0) > 0) {
        await syncIncomeEntryHsa({
          incomeEntryId: created.id,
          userId: user.id,
          organizationId: orgId,
          amount: Number((row as any).hsa_contribution || 0),
          contributionDate: (row as any).income_date,
          companyId: (row as any).source_id ?? null,
          existingHsaId: null,
        });
      }
      return created;
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
        qc.invalidateQueries({ queryKey: ["hsa_contributions"] }),
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

      // Canonical payroll HSA sync when the update touched hsa_contribution.
      if ("hsa_contribution" in updates) {
        const { data: existing } = await supabase
          .from("income_entries")
          .select("user_id, organization_id, income_date, source_id, linked_hsa_contribution_id")
          .eq("id", id)
          .maybeSingle();
        if (existing) {
          await syncIncomeEntryHsa({
            incomeEntryId: id,
            userId: (existing as any).user_id,
            organizationId: (existing as any).organization_id,
            amount: Number((updates as any).hsa_contribution || 0),
            contributionDate:
              (updates as any).income_date || (existing as any).income_date,
            companyId:
              (updates as any).source_id ?? (existing as any).source_id ?? null,
            existingHsaId: (existing as any).linked_hsa_contribution_id ?? null,
          });
        }
      }
    },
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["personal_income_entries"] }),
        qc.invalidateQueries({ queryKey: ["income_entries"] }),
        qc.invalidateQueries({ queryKey: ["hsa_contributions"] }),
      ]);
      toast.success("Income entry updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeletePersonalIncome() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Capture the linked_transaction_id before deleting so we can decide
      // whether to restore the underlying Plaid transaction's reportability.
      const { data: existing } = await supabase
        .from("income_entries")
        .select("id, linked_transaction_id")
        .eq("id", id)
        .maybeSingle();
      const linkedTxId = (existing as any)?.linked_transaction_id as string | null | undefined;

      // STALE RELATIONSHIP CLEANUP (must run BEFORE the delete so we can
      // still resolve which rows referenced this entry):
      //
      //   1. Any active income_entry_links referencing this entry are
      //      transitioned to 'unlinked' so no active link points at a
      //      deleted row. If dissolving the group leaves fewer than 2
      //      active participants, dissolve the whole group so remaining
      //      canonical siblings are restored to a plain state.
      try {
        const { data: linkRows } = await supabase
          .from("income_entry_links")
          .select("id, linked_group_id, canonical_entry_id, merged_entry_id, status, created_by_user")
          .or(`canonical_entry_id.eq.${id},merged_entry_id.eq.${id}`)
          .eq("status", "linked");
        const affectedGroups = new Set<string>();
        // Sibling participants (any entry id in an affected group other
        // than the one being deleted) — captured BEFORE we start mutating
        // links so we can restore them even if their link row is dissolved.
        const siblingIds = new Set<string>();
        for (const l of (linkRows || []) as any[]) {
          if (l.linked_group_id) affectedGroups.add(l.linked_group_id);
        }
        if (affectedGroups.size > 0) {
          const { data: groupLinks } = await supabase
            .from("income_entry_links")
            .select("canonical_entry_id, merged_entry_id, linked_group_id, status")
            .in("linked_group_id", Array.from(affectedGroups))
            .eq("status", "linked");
          for (const r of (groupLinks || []) as any[]) {
            for (const eid of [r.canonical_entry_id, r.merged_entry_id]) {
              if (eid && eid !== id) siblingIds.add(eid);
            }
          }
        }
        if ((linkRows || []).length > 0) {
          await supabase
            .from("income_entry_links")
            .update({ status: "unlinked" } as any)
            .or(`canonical_entry_id.eq.${id},merged_entry_id.eq.${id}`)
            .eq("status", "linked");
        }
        for (const groupId of affectedGroups) {
          const { data: remaining } = await supabase
            .from("income_entry_links")
            .select("canonical_entry_id, merged_entry_id")
            .eq("linked_group_id", groupId)
            .eq("status", "linked");
          const ids = new Set<string>();
          for (const r of (remaining || []) as any[]) {
            if (r.canonical_entry_id) ids.add(r.canonical_entry_id);
            if (r.merged_entry_id) ids.add(r.merged_entry_id);
          }
          if (ids.size < 2) {
            await supabase
              .from("income_entry_links")
              .update({ status: "unlinked" } as any)
              .eq("linked_group_id", groupId);
          }
        }

        // Restore surviving siblings so they reappear as standalone rows.
        // Imported cash-confirmation rows had their reportability flags
        // flipped off during earlier unlinks (shadow rule). With the
        // canonical row being deleted there is no other representation, so
        // restore full reportability + status='received' for every sibling.
        if (siblingIds.size > 0) {
          const sibArr = Array.from(siblingIds);
          await supabase
            .from("income_entries")
            .update({
              status: "received",
              include_in_tax_estimate: true,
              include_in_cash_flow: true,
            } as any)
            .in("id", sibArr);

          // Recompute Plaid transaction reportability for each sibling
          // that references a deposit — now that the canonical is gone
          // and the sibling is the sole active representation, its
          // underlying tx must stay excluded (still represented).
          try {
            const { data: sibRows } = await supabase
              .from("income_entries")
              .select("id, linked_transaction_id")
              .in("id", sibArr);
            const seen = new Set<string>();
            const { excludeLinkedTransactionForIncomeEntry } = await import(
              "@/lib/plaidTransactionExclusion"
            );
            for (const r of (sibRows || []) as any[]) {
              const ltx = r.linked_transaction_id as string | null | undefined;
              if (!ltx || seen.has(ltx)) continue;
              seen.add(ltx);
              await excludeLinkedTransactionForIncomeEntry(ltx);
            }
          } catch (err) {
            console.warn("[DeletePersonalIncome] sibling tx exclusion skipped:", err);
          }
        }
      } catch (err) {
        console.warn("[DeletePersonalIncome] link cleanup skipped:", err);
      }

      //   2. planner_conversions.income_entry_id must not dangle after the
      //      referenced income row is deleted. Null it so the planner can
      //      re-produce or the user can re-associate a fresh entry.
      try {
        await supabase
          .from("planner_conversions")
          .update({ income_entry_id: null } as any)
          .eq("income_entry_id", id);
      } catch (err) {
        console.warn("[DeletePersonalIncome] planner_conversions cleanup skipped:", err);
      }

      // Remove the payroll HSA row (if any) before deleting the parent so
      // HSA ledger rows tied to payroll income don't dangle.
      await deleteLinkedPayrollHsaForIncomeEntry(id);

      const { error } = await supabase
        .from("income_entries")
        .delete()
        .eq("id", id);
      if (error) throw error;

      // If the deleted row referenced a Plaid deposit, recompute whether
      // any other active Personal Income row still represents it. If not,
      // restore transaction reportability so it doesn't stay permanently
      // excluded.
      if (linkedTxId) {
        try {
          const { restoreLinkedTransactionForIncomeEntry } = await import(
            "@/lib/plaidTransactionExclusion"
          );
          await restoreLinkedTransactionForIncomeEntry(linkedTxId, id);
        } catch (err) {
          console.warn("[DeletePersonalIncome] tx restore skipped:", err);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["hsa_contributions"] });
      toast.success("Income entry deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}
