import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { IncomeEntry } from "@/hooks/useIncome";
import { getTotalFederalPaid } from "@/lib/federalWithholding";

export interface SuggestedMatch {
  manualTx: DbTransaction;
  plaidTx: DbTransaction;
  confidence: number;
  confidenceLabel: "Strong match" | "Possible match" | "Review needed";
  reasons: string[];
}

export interface MatchGroup {
  id: string;
  user_id: string;
  organization_id: string | null;
  status: string;
  manual_total: number;
  imported_total: number;
  difference: number;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface MatchGroupItem {
  id: string;
  match_group_id: string;
  transaction_id: string;
  transaction_source: "manual" | "imported";
  user_id: string;
  organization_id: string | null;
  created_at: string;
}

// ---- Backwards-compat: legacy 1:1 links table reads ----
export function useTransactionLinks() {
  return useQuery({
    queryKey: ["transaction-links"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_links")
        .select("*")
        .eq("status", "linked");
      if (error) throw error;
      return data || [];
    },
  });
}

// ---- New: matched groups + items ----
export function useMatchGroups() {
  return useQuery({
    queryKey: ["match-groups"],
    queryFn: async () => {
      const { data: groups, error: gErr } = await (supabase as any)
        .from("transaction_match_groups")
        .select("*")
        .eq("status", "active");
      if (gErr) throw gErr;
      const { data: items, error: iErr } = await (supabase as any)
        .from("transaction_match_group_items")
        .select("*");
      if (iErr) throw iErr;
      const itemsByGroup = new Map<string, MatchGroupItem[]>();
      for (const it of (items || []) as MatchGroupItem[]) {
        const arr = itemsByGroup.get(it.match_group_id) || [];
        arr.push(it);
        itemsByGroup.set(it.match_group_id, arr);
      }
      return ((groups || []) as MatchGroup[]).map((g) => ({
        ...g,
        items: itemsByGroup.get(g.id) || [],
      }));
    },
  });
}

// ---- Match Ignores ----
export function useMatchIgnores() {
  return useQuery({
    queryKey: ["match-ignores"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transaction_match_ignores")
        .select("*");
      if (error) throw error;
      return data || [];
    },
  });
}

function getConfidenceLabel(score: number): "Strong match" | "Possible match" | "Review needed" {
  if (score >= 75) return "Strong match";
  if (score >= 50) return "Possible match";
  return "Review needed";
}

export function useSuggestedMatches(
  transactions: DbTransaction[],
  incomeEntries?: IncomeEntry[],
) {
  const { data: ignores = [] } = useMatchIgnores();

  return useMemo(() => {
    const manual = transactions.filter(
      (t) => t.source_type === "manual" && t.match_status !== "linked"
    );
    const plaid = transactions.filter(
      (t) => t.source_type === "plaid" && t.match_status !== "linked"
    );

    const incomeByTxId = new Map<string, IncomeEntry>();
    if (incomeEntries) {
      for (const ie of incomeEntries) {
        if (ie.linked_transaction_id) incomeByTxId.set(ie.linked_transaction_id, ie);
      }
    }

    const ignoredPairs = new Set(
      ignores.map((ig) => `${ig.manual_transaction_id}:${ig.plaid_transaction_record_id}`)
    );

    const suggestions: SuggestedMatch[] = [];

    for (const m of manual) {
      for (const p of plaid) {
        if (ignoredPairs.has(`${m.id}:${p.id}`)) continue;
        if ((m.transaction_type || "expense") !== (p.transaction_type || "expense")) continue;

        const reasons: string[] = [];
        let score = 0;

        const isIncome = (m.transaction_type || "expense") === "income";
        const pAmount = Math.abs(p.amount);
        const mAmount = Math.abs(m.amount);

        const mDate = new Date(m.transaction_date).getTime();
        const pDate = new Date(p.transaction_date).getTime();
        const daysDiff = Math.abs(mDate - pDate) / (1000 * 60 * 60 * 24);
        if (daysDiff > 7) continue;
        let dateScore = 0;
        if (daysDiff <= 1) { dateScore = 30; reasons.push(daysDiff === 0 ? "Same date" : "1 day apart"); }
        else if (daysDiff <= 3) { dateScore = 22; reasons.push(`${Math.round(daysDiff)}d apart`); }
        else if (daysDiff <= 5) { dateScore = 14; reasons.push(`${Math.round(daysDiff)}d apart`); }
        else { dateScore = 6; reasons.push(`${Math.round(daysDiff)}d apart`); }
        score += dateScore;

        let amountScore = 0;
        if (isIncome) {
          const linkedIncome = incomeByTxId.get(m.id);
          const deposited = Number(linkedIncome?.deposited_amount || 0);
          const gross = Number(linkedIncome?.paycheck_amount || mAmount);
          const totalFederalPayroll = getTotalFederalPaid(linkedIncome as any);
          const stateW = Number((linkedIncome as any)?.state_withholding || 0);
          const preTaxDed = Number(linkedIncome?.pre_tax_deductions || 0);
          const retirement = Number(linkedIncome?.retirement_401k || 0);
          const healthcare = Number((linkedIncome as any)?.healthcare_deduction || 0);
          const hsa = Number((linkedIncome as any)?.hsa_contribution || 0);
          const calcNet = Math.max(
            0,
            gross - totalFederalPayroll - stateW - preTaxDed - retirement - healthcare - hsa,
          );

          if (deposited > 0) {
            const rel = Math.abs(pAmount - deposited) / Math.max(deposited, 1);
            if (rel <= 0.005) { amountScore = 50; reasons.push("Matches net deposit"); }
            else if (rel <= 0.02) { amountScore = 42; reasons.push("Within 2% of deposit"); }
            else if (rel <= 0.10) { amountScore = 28; reasons.push("Close to deposit"); }
            else if (rel <= 0.25) { amountScore = 14; reasons.push("Near deposit"); }
          } else if (calcNet > 0) {
            const rel = Math.abs(pAmount - calcNet) / Math.max(calcNet, 1);
            if (rel <= 0.02) { amountScore = 38; reasons.push("Matches calculated net"); }
            else if (rel <= 0.10) { amountScore = 26; reasons.push("Close to calculated net"); }
            else if (rel <= 0.25) { amountScore = 12; reasons.push("Plausible net of gross"); }
          } else {
            const rel = Math.abs(pAmount - gross) / Math.max(gross, 1);
            if (rel <= 0.02) { amountScore = 35; reasons.push("Matches gross"); }
            else if (pAmount <= gross && pAmount >= gross * 0.5) {
              amountScore = 18; reasons.push("Plausible deposit vs gross");
            } else if (pAmount <= gross && pAmount >= gross * 0.3) {
              amountScore = 8; reasons.push("Possible deposit vs gross");
            }
          }
        } else {
          const diff = Math.abs(mAmount - pAmount);
          const rel = diff / Math.max(mAmount, 1);
          if (rel <= 0.005) { amountScore = 45; reasons.push("Amount matches"); }
          else if (rel <= 0.02) { amountScore = 32; reasons.push("Within 2%"); }
          else if (rel <= 0.10) { amountScore = 16; reasons.push("Close amount"); }
        }
        score += amountScore;

        const mVendor = (m.vendor || "").toLowerCase().trim();
        const pVendor = (p.vendor || "").toLowerCase().trim();
        if (mVendor && pVendor && (mVendor.includes(pVendor) || pVendor.includes(mVendor))) {
          score += 18;
          reasons.push("Similar description");
        }

        if (m.entity && p.entity && m.entity === p.entity && m.entity !== "Unassigned") {
          score += 10;
          reasons.push("Same company");
        }

        const minScore =
          daysDiff <= 3 && amountScore >= 28 ? 40 :
          daysDiff <= 5 && amountScore >= 12 ? 35 :
          daysDiff <= 7 && amountScore >= 8 ? 30 :
          999;
        if (score < minScore) continue;

        const cappedScore = Math.min(score, 100);
        suggestions.push({
          manualTx: m,
          plaidTx: p,
          confidence: cappedScore,
          confidenceLabel: getConfidenceLabel(cappedScore),
          reasons,
        });
      }
    }

    suggestions.sort((a, b) => b.confidence - a.confidence);

    const usedManual = new Set<string>();
    const usedPlaid = new Set<string>();
    return suggestions.filter((s) => {
      if (usedManual.has(s.manualTx.id) || usedPlaid.has(s.plaidTx.id)) return false;
      usedManual.add(s.manualTx.id);
      usedPlaid.add(s.plaidTx.id);
      return true;
    });
  }, [transactions, incomeEntries, ignores]);
}

/**
 * Create a matched group from N manual + M imported transactions.
 *
 * Behavior: imported rows are flipped to status='merged' ONLY when the group
 * also contains at least one manual row (manual is the tax/ledger source of
 * truth). Imported-only groups leave imports active so they keep counting.
 */
export function useCreateMatchGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualIds,
      importedIds,
      note,
    }: {
      manualIds: string[];
      importedIds: string[];
      note?: string;
    }) => {
      if (manualIds.length + importedIds.length < 2) {
        throw new Error("Select at least 2 transactions to create a matched group");
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      const allIds = [...manualIds, ...importedIds];
      const { data: rows, error: fetchErr } = await supabase
        .from("transactions")
        .select("id, amount, linked_group_id, match_status")
        .in("id", allIds);
      if (fetchErr) throw fetchErr;
      if (!rows || rows.length !== allIds.length) {
        throw new Error("One or more selected transactions could not be found. Please refresh.");
      }
      const already = rows.find((r: any) => r.linked_group_id);
      if (already) {
        throw new Error("One of the selected transactions is already in a matched group. Unlink it first.");
      }

      const amtById = new Map<string, number>();
      rows.forEach((r: any) => amtById.set(r.id, Number(r.amount) || 0));
      const manualTotal = manualIds.reduce((s, id) => s + Math.abs(amtById.get(id) || 0), 0);
      const importedTotal = importedIds.reduce((s, id) => s + Math.abs(amtById.get(id) || 0), 0);
      const difference = manualTotal - importedTotal;

      const groupId = crypto.randomUUID();
      const { error: gErr } = await (supabase as any)
        .from("transaction_match_groups")
        .insert({
          id: groupId,
          user_id: user.id,
          organization_id: orgId,
          status: "active",
          manual_total: manualTotal,
          imported_total: importedTotal,
          difference,
          note: note || null,
        });
      if (gErr) throw gErr;

      const items = [
        ...manualIds.map((id) => ({
          match_group_id: groupId,
          transaction_id: id,
          transaction_source: "manual" as const,
          user_id: user.id,
          organization_id: orgId,
        })),
        ...importedIds.map((id) => ({
          match_group_id: groupId,
          transaction_id: id,
          transaction_source: "imported" as const,
          user_id: user.id,
          organization_id: orgId,
        })),
      ];
      const { error: iErr } = await (supabase as any)
        .from("transaction_match_group_items")
        .insert(items);
      if (iErr) throw iErr;

      // Update transactions: manual stays active+linked; imported is hidden
      // (status='merged') only when at least one manual sibling exists.
      const hasManual = manualIds.length > 0;

      if (manualIds.length > 0) {
        const { error: e1 } = await supabase
          .from("transactions")
          .update({
            match_status: "linked",
            linked_group_id: groupId,
            source_type: "merged",
            status: "active",
          } as any)
          .in("id", manualIds);
        if (e1) throw e1;
      }

      if (importedIds.length > 0) {
        const { error: e2 } = await supabase
          .from("transactions")
          .update({
            match_status: "linked",
            linked_group_id: groupId,
            status: hasManual ? "merged" : "active",
          } as any)
          .in("id", importedIds);
        if (e2) throw e2;
      }

      return groupId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      toast.success("Matched group created");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Backwards-compatible 1:1 link, delegates to useCreateMatchGroup. */
export function useLinkTransactions() {
  const create = useCreateMatchGroup();
  return {
    ...create,
    mutate: ({ manualTxId, plaidTxId }: { manualTxId: string; plaidTxId: string; confidence?: number }) =>
      create.mutate({ manualIds: [manualTxId], importedIds: [plaidTxId] }),
    mutateAsync: async ({ manualTxId, plaidTxId }: { manualTxId: string; plaidTxId: string; confidence?: number }) =>
      create.mutateAsync({ manualIds: [manualTxId], importedIds: [plaidTxId] }),
  } as any;
}

/** Unlink the entire matched group, restoring all member transactions. */
export function useUnlinkMatchGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { data: items, error: itemsErr } = await (supabase as any)
        .from("transaction_match_group_items")
        .select("transaction_id, transaction_source")
        .eq("match_group_id", groupId);
      if (itemsErr) throw itemsErr;
      const ids = (items || []).map((i: any) => i.transaction_id);

      if (ids.length > 0) {
        // Restore to active + unmatched. Manual rows that we previously set to
        // source_type='merged' as a marker need to go back to 'manual'.
        const manualIds = (items as any[])
          .filter((i) => i.transaction_source === "manual")
          .map((i) => i.transaction_id);
        const importedIds = (items as any[])
          .filter((i) => i.transaction_source === "imported")
          .map((i) => i.transaction_id);

        if (manualIds.length > 0) {
          const { error } = await supabase
            .from("transactions")
            .update({
              match_status: "unmatched",
              linked_group_id: null,
              source_type: "manual",
              status: "active",
            } as any)
            .in("id", manualIds);
          if (error) throw error;
        }
        if (importedIds.length > 0) {
          const { error } = await supabase
            .from("transactions")
            .update({
              match_status: "unmatched",
              linked_group_id: null,
              status: "active",
            } as any)
            .in("id", importedIds);
          if (error) throw error;
        }
      }

      const { error: gErr } = await (supabase as any)
        .from("transaction_match_groups")
        .update({ status: "unlinked" })
        .eq("id", groupId);
      if (gErr) throw gErr;

      // Best-effort: also mark legacy transaction_links as unlinked.
      await supabase
        .from("transaction_links")
        .update({ status: "unlinked" })
        .eq("linked_group_id", groupId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Matched group unlinked");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Remove a single item from a group; auto-dissolve group if <2 items remain. */
export function useUnlinkMatchGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ groupId, transactionId }: { groupId: string; transactionId: string }) => {
      const { data: items, error: itemsErr } = await (supabase as any)
        .from("transaction_match_group_items")
        .select("id, transaction_id, transaction_source")
        .eq("match_group_id", groupId);
      if (itemsErr) throw itemsErr;
      const target = (items || []).find((i: any) => i.transaction_id === transactionId);
      if (!target) throw new Error("Item not in group");

      // Restore the removed transaction
      const restore =
        target.transaction_source === "manual"
          ? { match_status: "unmatched", linked_group_id: null, source_type: "manual", status: "active" }
          : { match_status: "unmatched", linked_group_id: null, status: "active" };
      const { error: tErr } = await supabase
        .from("transactions")
        .update(restore as any)
        .eq("id", transactionId);
      if (tErr) throw tErr;

      const { error: dErr } = await (supabase as any)
        .from("transaction_match_group_items")
        .delete()
        .eq("id", target.id);
      if (dErr) throw dErr;

      const remaining = (items as any[]).filter((i) => i.transaction_id !== transactionId);

      // If fewer than 2 remain, dissolve the group entirely.
      if (remaining.length < 2) {
        const restIds = remaining.map((i) => i.transaction_id);
        if (restIds.length > 0) {
          // Restore each remaining item too
          const remManualIds = remaining.filter((i) => i.transaction_source === "manual").map((i) => i.transaction_id);
          const remImportedIds = remaining.filter((i) => i.transaction_source === "imported").map((i) => i.transaction_id);
          if (remManualIds.length > 0) {
            await supabase.from("transactions").update({
              match_status: "unmatched", linked_group_id: null, source_type: "manual", status: "active",
            } as any).in("id", remManualIds);
          }
          if (remImportedIds.length > 0) {
            await supabase.from("transactions").update({
              match_status: "unmatched", linked_group_id: null, status: "active",
            } as any).in("id", remImportedIds);
          }
        }
        await (supabase as any)
          .from("transaction_match_groups")
          .update({ status: "unlinked" })
          .eq("id", groupId);
        return;
      }

      // Recompute totals + re-evaluate "manual present" hiding rule
      const remIds = remaining.map((i) => i.transaction_id);
      const { data: rows } = await supabase
        .from("transactions")
        .select("id, amount")
        .in("id", remIds);
      const amtById = new Map<string, number>();
      (rows || []).forEach((r: any) => amtById.set(r.id, Number(r.amount) || 0));
      const manualTotal = remaining
        .filter((i) => i.transaction_source === "manual")
        .reduce((s, i) => s + Math.abs(amtById.get(i.transaction_id) || 0), 0);
      const importedTotal = remaining
        .filter((i) => i.transaction_source === "imported")
        .reduce((s, i) => s + Math.abs(amtById.get(i.transaction_id) || 0), 0);
      const hasManual = remaining.some((i) => i.transaction_source === "manual");

      // If we just removed the last manual, restore imported rows to active.
      if (!hasManual) {
        const remImportedIds = remaining.map((i) => i.transaction_id);
        if (remImportedIds.length > 0) {
          await supabase.from("transactions").update({ status: "active" } as any).in("id", remImportedIds);
        }
      }

      await (supabase as any)
        .from("transaction_match_groups")
        .update({
          manual_total: manualTotal,
          imported_total: importedTotal,
          difference: manualTotal - importedTotal,
        })
        .eq("id", groupId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      toast.success("Removed from group");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

/** Backwards-compat alias for the legacy 1:1 unlink. */
export function useUnlinkTransactions() {
  return useUnlinkMatchGroup();
}

// ---- Ignore a match suggestion ----
export function useIgnoreMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualTxId,
      plaidTxId,
    }: {
      manualTxId: string;
      plaidTxId: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { error } = await supabase.from("transaction_match_ignores").insert({
        user_id: user.id,
        organization_id: orgId,
        manual_transaction_id: manualTxId,
        plaid_transaction_record_id: plaidTxId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["match-ignores"] });
      toast.success("Match dismissed");
    },
    onError: (e: any) => toast.error(e.message),
  });
}
