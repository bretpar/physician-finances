import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";
import type { DbTransaction } from "@/hooks/useTransactions";

export interface SuggestedMatch {
  manualTx: DbTransaction;
  plaidTx: DbTransaction;
  confidence: number;
  reasons: string[];
}

// ---- Transaction Links ----
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

// ---- Suggest matches between manual and plaid transactions ----
export function useSuggestedMatches(transactions: DbTransaction[]) {
  const { data: ignores = [] } = useMatchIgnores();

  return useMemo(() => {
    const manual = transactions.filter(
      (t) => t.source_type === "manual" && t.match_status !== "linked" && !t.is_deleted
    );
    const plaid = transactions.filter(
      (t) => t.source_type === "plaid" && t.match_status !== "linked" && !t.is_deleted
    );

    const ignoredPairs = new Set(
      ignores.map((ig) => `${ig.manual_transaction_id}:${ig.plaid_transaction_record_id}`)
    );

    const suggestions: SuggestedMatch[] = [];

    for (const m of manual) {
      for (const p of plaid) {
        if (ignoredPairs.has(`${m.id}:${p.id}`)) continue;
        // Must be same type
        if ((m.transaction_type || "expense") !== (p.transaction_type || "expense")) continue;

        const reasons: string[] = [];
        let score = 0;

        // Amount match
        const amtDiff = Math.abs(m.amount - p.amount);
        if (amtDiff === 0) { score += 50; reasons.push("Exact amount match"); }
        else if (amtDiff <= 1) { score += 30; reasons.push("Amount within $1"); }
        else continue; // skip if amounts differ by more than $1

        // Date match
        const mDate = new Date(m.transaction_date).getTime();
        const pDate = new Date(p.transaction_date).getTime();
        const daysDiff = Math.abs(mDate - pDate) / (1000 * 60 * 60 * 24);
        if (daysDiff === 0) { score += 30; reasons.push("Same date"); }
        else if (daysDiff <= 3) { score += 15; reasons.push(`${Math.round(daysDiff)}d apart`); }
        else continue; // skip if more than 3 days apart

        // Vendor/name similarity bonus
        const mVendor = (m.vendor || "").toLowerCase();
        const pVendor = (p.vendor || "").toLowerCase();
        if (mVendor && pVendor && (mVendor.includes(pVendor) || pVendor.includes(mVendor))) {
          score += 20;
          reasons.push("Similar description");
        }

        if (score >= 50) {
          suggestions.push({ manualTx: m, plaidTx: p, confidence: Math.min(score, 100), reasons });
        }
      }
    }

    // Sort by confidence desc
    suggestions.sort((a, b) => b.confidence - a.confidence);

    // Deduplicate: each tx should only appear in one best suggestion
    const usedManual = new Set<string>();
    const usedPlaid = new Set<string>();
    return suggestions.filter((s) => {
      if (usedManual.has(s.manualTx.id) || usedPlaid.has(s.plaidTx.id)) return false;
      usedManual.add(s.manualTx.id);
      usedPlaid.add(s.plaidTx.id);
      return true;
    });
  }, [transactions, ignores]);
}

// ---- Link two transactions ----
export function useLinkTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      manualTxId,
      plaidTxId,
      confidence,
    }: {
      manualTxId: string;
      plaidTxId: string;
      confidence?: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const groupId = crypto.randomUUID();

      // Create link record
      const { error: linkErr } = await supabase.from("transaction_links").insert({
        user_id: user.id,
        organization_id: orgId,
        linked_group_id: groupId,
        manual_transaction_id: manualTxId,
        plaid_transaction_record_id: plaidTxId,
        status: "linked",
        confidence_score: confidence || null,
        created_by_user: true,
      });
      if (linkErr) throw linkErr;

      // Update manual tx
      const { error: e1 } = await supabase
        .from("transactions")
        .update({ match_status: "linked", linked_group_id: groupId, source_type: "merged" })
        .eq("id", manualTxId);
      if (e1) throw e1;

      // Update plaid tx — mark as linked and hide from main view
      const { error: e2 } = await supabase
        .from("transactions")
        .update({ match_status: "linked", linked_group_id: groupId, is_deleted: true })
        .eq("id", plaidTxId);
      if (e2) throw e2;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Transactions linked");
    },
    onError: (e) => toast.error(e.message),
  });
}

// ---- Unlink transactions ----
export function useUnlinkTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      // Restore both transactions
      const { error: e1 } = await supabase
        .from("transactions")
        .update({ match_status: "unmatched", linked_group_id: null, source_type: "manual" })
        .eq("linked_group_id", groupId)
        .eq("source_type", "merged");

      const { error: e2 } = await supabase
        .from("transactions")
        .update({ match_status: "unmatched", linked_group_id: null, is_deleted: false, source_type: "plaid" })
        .eq("linked_group_id", groupId)
        .eq("is_deleted", true);

      // Remove link record
      const { error: e3 } = await supabase
        .from("transaction_links")
        .update({ status: "unlinked" })
        .eq("linked_group_id", groupId);

      if (e1 || e2 || e3) throw new Error("Failed to unlink");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Transactions unlinked");
    },
    onError: (e) => toast.error(e.message),
  });
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
    onError: (e) => toast.error(e.message),
  });
}
