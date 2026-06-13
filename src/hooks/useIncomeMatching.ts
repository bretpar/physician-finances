import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import type { PersonalIncomeEntry } from "@/hooks/usePersonalIncome";

export interface IncomeMatchGroupItem {
  itemId: string;
  entry: PersonalIncomeEntry;
}

/**
 * Returns a Map keyed by linked_group_id of user-created income entry links.
 * Mirrors useMatchGroups() for transactions.
 */
export function useIncomeMatchGroups() {
  return useQuery({
    queryKey: ["income-match-groups"],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from("income_entry_links")
        .select("id, linked_group_id, canonical_entry_id, merged_entry_id")
        .eq("status", "linked")
        .eq("created_by_user", true);
      if (error) throw error;

      const linkRows = (links || []) as any[];
      const ids = Array.from(
        new Set(linkRows.flatMap((l) => [l.canonical_entry_id, l.merged_entry_id]).filter(Boolean)),
      );
      if (ids.length === 0) return new Map<string, IncomeMatchGroupItem[]>();

      const { data: entries, error: eErr } = await supabase
        .from("income_entries")
        .select("*")
        .in("id", ids);
      if (eErr) throw eErr;
      const byId = new Map<string, PersonalIncomeEntry>(
        (entries || []).map((e: any) => [e.id as string, e as PersonalIncomeEntry]),
      );

      const map = new Map<string, IncomeMatchGroupItem[]>();
      for (const link of linkRows) {
        const groupId = link.linked_group_id as string;
        const arr = map.get(groupId) || [];
        const seen = new Set(arr.map((it) => it.entry.id));
        for (const eid of [link.canonical_entry_id, link.merged_entry_id]) {
          if (!eid || seen.has(eid)) continue;
          const entry = byId.get(eid);
          if (!entry) continue;
          arr.push({ itemId: entry.id, entry });
          seen.add(entry.id);
        }
        map.set(groupId, arr);
      }
      return map;
    },
  });
}

/**
 * True when this income_entry looks like a plain Plaid/imported bank deposit
 * with no payroll/tax detail. These rows confirm cash but must never be
 * chosen as canonical when an accounting/payroll row exists in the group.
 */
export function isImportedCashIncomeRow(e: PersonalIncomeEntry): boolean {
  const origin = (e as any).origin_type as string | null | undefined;
  if (origin === "planner_converted" || origin === "ytd_catchup" || origin === "manual") {
    return false;
  }
  const payroll =
    Number(e.federal_withholding || 0) +
    Number(e.state_withholding || 0) +
    Number((e as any).ss_withholding || 0) +
    Number((e as any).medicare_withholding || 0) +
    Number(e.pre_tax_deductions || 0) +
    Number(e.retirement_401k || 0) +
    Number((e as any).healthcare_deduction || 0) +
    Number(e.hsa_contribution || 0) +
    Number((e as any).additional_tax_reserve || 0);
  if (payroll > 0) return false;
  // Heuristic for sync-created rows: linked to a Plaid transaction with
  // gross == deposited and a "Imported from" note.
  const note = String(e.notes || "").toLowerCase();
  const grossEqDeposit =
    Number(e.gross_amount || 0) > 0 &&
    Math.abs(Number(e.gross_amount || 0) - Number(e.deposited_amount || 0)) < 0.01;
  if ((e as any).linked_transaction_id && grossEqDeposit && note.includes("imported from")) {
    return true;
  }
  if (note.includes("imported from")) return true;
  return false;
}

function pickCanonicalIncomeEntry(entries: PersonalIncomeEntry[]): PersonalIncomeEntry {
  // Global hierarchy:
  //  1) Manual / planner / app-created (accounting/payroll source of truth)
  //     ALWAYS beat Plaid/imported cash-confirmation rows.
  //  2) Within the same origin tier, prefer payroll/tax completeness.
  //  3) Tie-breaker: earliest created_at.
  const scored = entries.map((e) => {
    let completeness = 0;
    if (Number(e.gross_amount || 0) > 0) completeness++;
    if (Number(e.federal_withholding || 0) > 0) completeness++;
    if (Number(e.state_withholding || 0) > 0) completeness++;
    if (Number((e as any).ss_withholding || 0) > 0) completeness++;
    if (Number((e as any).medicare_withholding || 0) > 0) completeness++;
    if (Number(e.pre_tax_deductions || 0) > 0) completeness++;
    if (Number(e.retirement_401k || 0) > 0) completeness++;
    if (Number((e as any).healthcare_deduction || 0) > 0) completeness++;
    if (Number(e.hsa_contribution || 0) > 0) completeness++;
    if (Number((e as any).additional_tax_reserve || 0) > 0) completeness++;
    if (e.notes && String(e.notes).trim()) completeness++;
    if (e.company && String(e.company).trim()) completeness++;
    if (e.source_id) completeness++;
    // Origin tier: accounting/payroll row = 1, imported cash row = 0.
    const originRank = isImportedCashIncomeRow(e) ? 0 : 1;
    return { e, completeness, originRank };
  });
  scored.sort((a, b) => {
    if (b.originRank !== a.originRank) return b.originRank - a.originRank;
    if (b.completeness !== a.completeness) return b.completeness - a.completeness;
    return a.e.created_at.localeCompare(b.e.created_at);
  });
  return scored[0].e;
}

export function useCreateIncomeMatchGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ entryIds }: { entryIds: string[] }) => {
      if (entryIds.length < 2) throw new Error("Select at least 2 entries to link");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      const { data: rows, error } = await supabase
        .from("income_entries")
        .select("*")
        .in("id", entryIds);
      if (error) throw error;
      if (!rows || rows.length !== entryIds.length) {
        throw new Error("Some entries no longer exist. Please refresh.");
      }

      // Block if any selected entry is already in an active user-created link.
      const { data: existing } = await supabase
        .from("income_entry_links")
        .select("canonical_entry_id, merged_entry_id")
        .eq("status", "linked")
        .eq("created_by_user", true)
        .or(
          `canonical_entry_id.in.(${entryIds.join(",")}),merged_entry_id.in.(${entryIds.join(",")})`,
        );
      const already = new Set<string>();
      for (const l of (existing || []) as any[]) {
        if (l.canonical_entry_id) already.add(l.canonical_entry_id);
        if (l.merged_entry_id) already.add(l.merged_entry_id);
      }
      if (already.size > 0) {
        throw new Error("One or more entries are already linked. Unlink them first.");
      }

      const canonical = pickCanonicalIncomeEntry(rows as PersonalIncomeEntry[]);
      const mergedIds = (rows as PersonalIncomeEntry[])
        .filter((r) => r.id !== canonical.id)
        .map((r) => r.id);

      const groupId = crypto.randomUUID();
      const linkRows = mergedIds.map((mid) => ({
        user_id: user.id,
        organization_id: orgId,
        linked_group_id: groupId,
        canonical_entry_id: canonical.id,
        merged_entry_id: mid,
        status: "linked",
        created_by_user: true,
      }));
      const { error: iErr } = await supabase.from("income_entry_links").insert(linkRows as any);
      if (iErr) throw iErr;

      // Soft-merge sibling entries so totals count the group once.
      if (mergedIds.length > 0) {
        const { error: uErr } = await supabase
          .from("income_entries")
          .update({ status: "merged" } as any)
          .in("id", mergedIds);
        if (uErr) throw uErr;
      }
      return groupId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["income-match-groups"] });
      toast.success("Income entries linked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not link entries"),
  });
}

export function useUnlinkIncomeMatchGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string }) => {
      // Mark the link row(s) referencing this entry as unlinked.
      const { error: uErr } = await supabase
        .from("income_entry_links")
        .update({ status: "unlinked" } as any)
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true)
        .or(`canonical_entry_id.eq.${itemId},merged_entry_id.eq.${itemId}`);
      if (uErr) throw uErr;

      // Restore the unlinked entry back to active.
      await supabase
        .from("income_entries")
        .update({ status: "received" } as any)
        .eq("id", itemId);

      // If fewer than 2 entries remain in the group, dissolve it.
      const { data: remaining } = await supabase
        .from("income_entry_links")
        .select("canonical_entry_id, merged_entry_id")
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true);
      const remainingIds = Array.from(
        new Set(
          (remaining || []).flatMap((l: any) => [l.canonical_entry_id, l.merged_entry_id]).filter(Boolean),
        ),
      );
      if (remainingIds.length < 2) {
        if (remainingIds.length > 0) {
          await supabase
            .from("income_entries")
            .update({ status: "received" } as any)
            .in("id", remainingIds);
        }
        await supabase
          .from("income_entry_links")
          .update({ status: "unlinked" } as any)
          .eq("linked_group_id", groupId)
          .eq("created_by_user", true);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["income-match-groups"] });
      toast.success("Unlinked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not unlink"),
  });
}

/**
 * Suggest unlinked Personal Income entries that look like the same paycheck as
 * the given entry. Used by the desktop "Link to bank transaction" modal.
 * Score: amount closeness (max 50) + date proximity within ±7d (max 30) +
 *        same source_id/company (15) + same canonical income_type (5).
 */
export interface IncomeLinkSuggestion {
  entry: PersonalIncomeEntry;
  score: number;
  reason: string;
}

export function useSuggestedIncomeLinkCandidates(
  target: PersonalIncomeEntry | null,
  allEntries: PersonalIncomeEntry[],
  linkedEntryIds: Set<string>,
): IncomeLinkSuggestion[] {
  if (!target) return [];
  const tDate = new Date(target.income_date).getTime();
  const tGross = Math.abs(Number(target.gross_amount) || 0);
  const tDeposit = Math.abs(Number(target.deposited_amount) || 0);
  const out: IncomeLinkSuggestion[] = [];
  for (const e of allEntries) {
    if (e.id === target.id) continue;
    if (linkedEntryIds.has(e.id)) continue;
    if ((e as any).status === "merged") continue;
    const eDate = new Date(e.income_date).getTime();
    const days = Math.abs((eDate - tDate) / 86400000);
    if (days > 14) continue;
    const eGross = Math.abs(Number(e.gross_amount) || 0);
    const eDeposit = Math.abs(Number(e.deposited_amount) || 0);
    const amts = [eGross, eDeposit].filter((n) => n > 0);
    const refs = [tGross, tDeposit].filter((n) => n > 0);
    let bestPctDiff = 1;
    for (const a of amts) for (const r of refs) {
      const diff = Math.abs(a - r) / Math.max(r, 1);
      if (diff < bestPctDiff) bestPctDiff = diff;
    }
    if (bestPctDiff > 0.5) continue;
    let score = 0;
    score += Math.max(0, 50 - bestPctDiff * 100);
    score += Math.max(0, 30 - days * 4);
    if (target.source_id && e.source_id && target.source_id === e.source_id) score += 15;
    else if (target.company && e.company && target.company.toLowerCase() === e.company.toLowerCase()) score += 10;
    if (target.income_type && e.income_type && target.income_type === e.income_type) score += 5;
    const reasons: string[] = [];
    if (bestPctDiff < 0.02) reasons.push("amount matches");
    else if (bestPctDiff < 0.1) reasons.push("similar amount");
    if (days < 1) reasons.push("same date");
    else if (days <= 3) reasons.push(`${Math.round(days)}d apart`);
    else reasons.push(`${Math.round(days)}d apart`);
    if (target.source_id && e.source_id && target.source_id === e.source_id) reasons.push("same employer");
    out.push({ entry: e, score, reason: reasons.join(" · ") });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

/**
 * Mark a planner-created Personal Income row as user-reviewed. Clears
 * `needs_review` so it disappears from the Needs Review filter and stamps
 * `reviewed_at` so the UI can show a "Reviewed" badge.
 */
export function useMarkIncomeReviewed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entryId: string) => {
      const { error } = await supabase
        .from("income_entries")
        .update({ needs_review: false, reviewed_at: new Date().toISOString() } as any)
        .eq("id", entryId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Income marked as reviewed.");
    },
    onError: (e: any) => toast.error(e.message || "Could not mark reviewed"),
  });
}
