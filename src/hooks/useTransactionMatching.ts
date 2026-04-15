import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getUserOrgId } from "@/hooks/useOrgId";
import { toast } from "sonner";
import type { DbTransaction } from "@/hooks/useTransactions";
import type { IncomeEntry } from "@/hooks/useIncome";

export interface SuggestedMatch {
  manualTx: DbTransaction;
  plaidTx: DbTransaction;
  confidence: number;
  confidenceLabel: "Strong match" | "Possible match" | "Review needed";
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

function getConfidenceLabel(score: number): "Strong match" | "Possible match" | "Review needed" {
  if (score >= 75) return "Strong match";
  if (score >= 50) return "Possible match";
  return "Review needed";
}

/**
 * Enhanced matching logic:
 * - For income transactions, compare imported amount against:
 *   1. Manual tx's net received (deposited_amount from linked income entry)
 *   2. Calculated net = gross - taxes_withheld - pre_tax_deductions - retirement
 *   3. Gross amount as fallback
 * - Date tolerance: 0-3 days
 * - Vendor similarity bonus
 */
export function useSuggestedMatches(
  transactions: DbTransaction[],
  incomeEntries?: IncomeEntry[],
) {
  const { data: ignores = [] } = useMatchIgnores();

  return useMemo(() => {
    const manual = transactions.filter(
      (t) => t.source_type === "manual" && t.match_status !== "linked" && !t.is_deleted
    );
    const plaid = transactions.filter(
      (t) => t.source_type === "plaid" && t.match_status !== "linked" && !t.is_deleted
    );

    // Build a map from transaction id to linked income entry for net amount lookups
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
        // Must be same type
        if ((m.transaction_type || "expense") !== (p.transaction_type || "expense")) continue;

        const reasons: string[] = [];
        let score = 0;

        const isIncome = (m.transaction_type || "expense") === "income";
        const pAmount = Math.abs(p.amount);
        const mAmount = Math.abs(m.amount);

        // For income, try matching against net received or calculated net
        let amountMatched = false;
        if (isIncome) {
          const linkedIncome = incomeByTxId.get(m.id);
          const netReceived = linkedIncome?.deposited_amount;
          const gross = linkedIncome?.paycheck_amount ?? mAmount;
          const taxesWithheld = linkedIncome?.taxes_withheld ?? 0;
          const preTaxDed = linkedIncome?.pre_tax_deductions ?? 0;
          const retirement = linkedIncome?.retirement_401k ?? 0;
          const calculatedNet = Math.max(0, gross - taxesWithheld - preTaxDed - retirement);

          // Priority 1: match against net received
          if (netReceived && netReceived > 0) {
            const diff = Math.abs(pAmount - netReceived);
            if (diff === 0) { score += 50; reasons.push("Exact match to net received"); amountMatched = true; }
            else if (diff <= 1) { score += 40; reasons.push("Net received within $1"); amountMatched = true; }
            else if (diff / netReceived <= 0.02) { score += 25; reasons.push("Net received within 2%"); amountMatched = true; }
          }

          // Priority 2: match against calculated net
          if (!amountMatched && calculatedNet > 0) {
            const diff = Math.abs(pAmount - calculatedNet);
            if (diff === 0) { score += 45; reasons.push("Exact match to calculated net"); amountMatched = true; }
            else if (diff <= 1) { score += 35; reasons.push("Calculated net within $1"); amountMatched = true; }
            else if (diff / calculatedNet <= 0.02) { score += 20; reasons.push("Calculated net within 2%"); amountMatched = true; }
          }

          // Priority 3: gross amount fallback
          if (!amountMatched) {
            const diff = Math.abs(pAmount - mAmount);
            if (diff === 0) { score += 40; reasons.push("Exact gross amount match"); amountMatched = true; }
            else if (diff <= 1) { score += 25; reasons.push("Gross amount within $1"); amountMatched = true; }
          }
        } else {
          // Non-income: simple amount match
          const amtDiff = Math.abs(mAmount - pAmount);
          if (amtDiff === 0) { score += 50; reasons.push("Exact amount match"); amountMatched = true; }
          else if (amtDiff <= 1) { score += 30; reasons.push("Amount within $1"); amountMatched = true; }
        }

        if (!amountMatched) continue;

        // Date match (0-3 business days)
        const mDate = new Date(m.transaction_date).getTime();
        const pDate = new Date(p.transaction_date).getTime();
        const daysDiff = Math.abs(mDate - pDate) / (1000 * 60 * 60 * 24);
        if (daysDiff === 0) { score += 30; reasons.push("Same date"); }
        else if (daysDiff <= 1) { score += 25; reasons.push("1 day apart"); }
        else if (daysDiff <= 3) { score += 15; reasons.push(`${Math.round(daysDiff)}d apart`); }
        else continue; // skip if more than 3 days apart

        // Vendor/name similarity bonus
        const mVendor = (m.vendor || "").toLowerCase();
        const pVendor = (p.vendor || "").toLowerCase();
        if (mVendor && pVendor && (mVendor.includes(pVendor) || pVendor.includes(mVendor))) {
          score += 20;
          reasons.push("Similar description");
        }

        // Company match bonus
        if (m.entity && p.entity && m.entity === p.entity && m.entity !== "Unassigned") {
          score += 10;
          reasons.push("Same company");
        }

        if (score >= 40) {
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
  }, [transactions, incomeEntries, ignores]);
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

      // Validate both records exist before linking
      const { data: manualRow } = await supabase
        .from("transactions")
        .select("id")
        .eq("id", manualTxId)
        .maybeSingle();
      const { data: plaidRow } = await supabase
        .from("transactions")
        .select("id")
        .eq("id", plaidTxId)
        .maybeSingle();

      console.log("[LinkTx] manual:", manualTxId, "exists:", !!manualRow, "| plaid:", plaidTxId, "exists:", !!plaidRow);

      if (!manualRow || !plaidRow) {
        throw new Error(
          !manualRow && !plaidRow
            ? "Both transactions no longer exist. Please refresh."
            : !manualRow
              ? "Manual transaction no longer exists. Please refresh."
              : "Imported transaction no longer exists. Please refresh."
        );
      }

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
