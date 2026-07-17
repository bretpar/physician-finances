import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";
import type { PersonalIncomeEntry } from "@/hooks/usePersonalIncome";
import {
  excludeLinkedTransactionForIncomeEntry,
  restoreLinkedTransactionForIncomeEntry,
} from "@/lib/plaidTransactionExclusion";

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
 *
 * Detection is based on the row's actual provenance and contents so that
 * legacy Plaid-created rows still saved with the default `origin_type = "manual"`
 * are still recognized. A true user-entered manual payroll row is preserved
 * as accounting by its withholding / retirement / healthcare / HSA / pre-tax
 * fields — those signals defeat this detector.
 */
export function isImportedCashIncomeRow(e: PersonalIncomeEntry): boolean {
  const origin = String((e as any).origin_type || "").toLowerCase();
  // Definitely accounting rows — never treat as imported cash.
  if (origin === "planner_converted" || origin === "ytd_catchup") return false;
  // Definitely imported by explicit tag.
  if (origin === "plaid_import" || origin === "imported") return true;

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
  // Any user-entered payroll detail → this is an accounting row, not imported.
  if (payroll > 0) return false;

  const note = String(e.notes || "").toLowerCase();
  const hasImportNote = note.includes("imported from");
  const linkedTx = Boolean((e as any).linked_transaction_id);
  const gross = Number(e.gross_amount || 0);
  const deposit = Number(e.deposited_amount || 0);
  const grossEqDeposit = gross > 0 && Math.abs(gross - deposit) < 0.01;

  // Sync-created shape: linked Plaid transaction + gross == deposit + no payroll.
  if (linkedTx && grossEqDeposit) return true;
  // Explicit import provenance in notes.
  if (hasImportNote) return true;
  // Legacy Plaid rows w/ default origin_type='manual' that still carry the
  // bank-transaction linkage and no payroll signal.
  if (linkedTx && payroll === 0) return true;
  return false;
}

/**
 * Returns true when the canonical income_entry's current `deposited_amount`
 * is safe to overwrite with an imported Plaid deposit on link. Gross / payroll
 * fields are NEVER touched here.
 */
export function canPlaidOverwriteCanonicalDeposit(e: PersonalIncomeEntry): boolean {
  const dep = Number((e as any).deposited_amount) || 0;
  if (dep <= 0) return true;
  const gross = Number(e.gross_amount) || Number((e as any).paycheck_amount) || 0;
  if (gross > 0 && Math.abs(dep - gross) < 0.01) return true;
  const origin = String((e as any).origin_type || "").toLowerCase();
  const kind = String((e as any).entry_kind || "").toLowerCase();
  if (
    origin === "planner_converted" ||
    kind === "planner_conversion" ||
    (e as any).origin_planner_conversion_id
  ) {
    return true;
  }
  const notes = String(e.notes || "").toLowerCase();
  if (notes.includes("from planner")) return true;
  const fed = Number(e.federal_withholding) || 0;
  const ss = Number((e as any).ss_withholding) || 0;
  const med = Number((e as any).medicare_withholding) || 0;
  const state = Number(e.state_withholding) || 0;
  const preTax = Number(e.pre_tax_deductions) || 0;
  const ret = Number(e.retirement_401k) || 0;
  const hsa = Number(e.hsa_contribution) || 0;
  const health = Number((e as any).healthcare_deduction) || 0;
  const other = Number((e as any).other_deductions) || 0;
  const calcNet = Math.max(0, gross - fed - ss - med - state - preTax - ret - hsa - health - other);
  if (calcNet > 0 && Math.abs(dep - calcNet) < 0.5) return true;
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
      const mergedEntries = (rows as PersonalIncomeEntry[]).filter((r) => r.id !== canonical.id);
      const mergedIds = mergedEntries.map((r) => r.id);

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

      // Backfill canonical deposited_amount from the imported cash sibling.
      // Plaid/imported is the cashflow source of truth for Net Received once
      // linked. We NEVER touch gross_amount/paycheck_amount, withholding,
      // 401(k), HSA, healthcare, pre-tax, company, source, type, or notes.
      try {
        const imported =
          mergedEntries.find((e) => isImportedCashIncomeRow(e)) ?? null;
        if (imported) {
          const importedDeposit =
            Number((imported as any).deposited_amount) ||
            Number(imported.gross_amount) ||
            Number((imported as any).paycheck_amount) ||
            0;
          if (importedDeposit > 0 && canPlaidOverwriteCanonicalDeposit(canonical)) {
            await supabase
              .from("income_entries")
              .update({ deposited_amount: importedDeposit } as any)
              .eq("id", canonical.id);
          }
        }
      } catch (err) {
        console.warn("[LinkIncome] deposited_amount backfill skipped:", err);
      }

      // Soft-merge sibling entries so totals count the group once. Also
      // re-enable include_in_tax_estimate on the (soon-to-be-)merged rows so
      // if the link is dissolved later the shadow rule (set on unlink) is
      // applied cleanly rather than left over from a prior state.
      if (mergedIds.length > 0) {
        const { error: uErr } = await supabase
          .from("income_entries")
          .update({ status: "merged", include_in_tax_estimate: true } as any)
          .in("id", mergedIds);
        if (uErr) throw uErr;
      }

      // For every merged sibling that represents a Plaid deposit, mark the
      // underlying canonical `transactions` row excluded/linked so it does
      // not double-count in Dashboard / Tax Overview / reports. The row is
      // preserved for bank history and unlink support.
      for (const m of mergedEntries) {
        const linkedTxId = (m as any).linked_transaction_id as string | null | undefined;
        if (!linkedTxId) continue;
        try {
          await excludeLinkedTransactionForIncomeEntry(linkedTxId);
        } catch (err) {
          console.warn("[LinkIncome] tx exclusion skipped:", err);
        }
      }
      return groupId;
    },
    onSuccess: async () => {
      // Await personal + transactions refetch so Dashboard / Tax Overview
      // reconcile before the mutation Promise resolves. Transactions must
      // be refetched because excludeLinkedTransactionForIncomeEntry flipped
      // excluded_from_reports on the underlying Plaid row.
      await Promise.all([
        qc.refetchQueries({ queryKey: ["personal_income_entries"] }),
        qc.refetchQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["income_entries"] }),
        qc.invalidateQueries({ queryKey: ["income-match-groups"] }),
        qc.invalidateQueries({ queryKey: ["tax_estimate"] }),
        qc.invalidateQueries({ queryKey: ["dashboard_summary"] }),
      ]);
      toast.success("Income entries linked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not link entries"),
  });
}

export function useUnlinkIncomeMatchGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string }) => {
      // 1. Capture the current group participants BEFORE mutating anything.
      const { data: allLinks } = await supabase
        .from("income_entry_links")
        .select("canonical_entry_id, merged_entry_id, status, created_by_user")
        .eq("linked_group_id", groupId);
      const participantIds = Array.from(
        new Set(
          ((allLinks || []) as any[])
            .filter((l) => l.status === "linked" && l.created_by_user)
            .flatMap((l) => [l.canonical_entry_id, l.merged_entry_id])
            .filter(Boolean),
        ),
      );

      // 2. Mark link rows referencing this entry as unlinked.
      const { error: uErr } = await supabase
        .from("income_entry_links")
        .update({ status: "unlinked" } as any)
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true)
        .or(`canonical_entry_id.eq.${itemId},merged_entry_id.eq.${itemId}`);
      if (uErr) throw uErr;

      // 3. Determine what remains linked. If <2 remain, dissolve group.
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

      let removedIds: string[];
      if (remainingIds.length < 2) {
        // Dissolve: every participant is removed.
        removedIds = participantIds;
        await supabase
          .from("income_entry_links")
          .update({ status: "unlinked" } as any)
          .eq("linked_group_id", groupId)
          .eq("created_by_user", true);
      } else {
        removedIds = [itemId];
      }

      if (removedIds.length === 0) return;

      // 4. Restore ALL removed entries back to visible "received" status so
      //    they reappear in the ledger / linking UI and can be relinked.
      //    IMPORTANT: for imported Plaid cash-confirmation rows we ALSO flip
      //    off include_in_tax_estimate / include_in_cash_flow. Post-unlink
      //    the imported row is still a "shadow" of the same paycheck (its
      //    linked_transaction_id points at the deposit that the canonical
      //    planner/manual row already represents in totals). Reportability
      //    is governed by src/lib/personalIncomeReportability.ts and treats
      //    include_in_tax_estimate=false as "not separately reportable"
      //    while keeping the row visible. Canonical planner/manual/payroll
      //    rows keep include flags = true.
      const { data: removedRows } = await supabase
        .from("income_entries")
        .select("*")
        .in("id", removedIds);
      const removed = (removedRows || []) as any as PersonalIncomeEntry[];
      const importedIds = removed
        .filter((r) => isImportedCashIncomeRow(r))
        .map((r) => r.id);
      const canonicalIds = removed
        .filter((r) => !isImportedCashIncomeRow(r))
        .map((r) => r.id);

      if (canonicalIds.length > 0) {
        await supabase
          .from("income_entries")
          .update({ status: "received", include_in_tax_estimate: true } as any)
          .in("id", canonicalIds);
      }
      if (importedIds.length > 0) {
        await supabase
          .from("income_entries")
          .update({
            status: "received",
            include_in_tax_estimate: false,
            include_in_cash_flow: false,
          } as any)
          .in("id", importedIds);
      }

      // 5. For each removed entry that references a Plaid deposit, restore
      //    the underlying transaction reportability — but only if no OTHER
      //    still-active canonical Personal Income row represents the same
      //    deposit. All removedIds are treated as "in-flight restore" and
      //    excluded from the still-represented check.
      const seenTxKeys = new Set<string>();
      for (const r of removed) {
        const linkedTxId = (r as any).linked_transaction_id as string | null | undefined;
        if (!linkedTxId || seenTxKeys.has(linkedTxId)) continue;
        seenTxKeys.add(linkedTxId);
        try {
          await restoreLinkedTransactionForIncomeEntry(linkedTxId, removedIds);
        } catch (err) {
          console.warn("[UnlinkIncome] tx restore skipped:", err);
        }
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
