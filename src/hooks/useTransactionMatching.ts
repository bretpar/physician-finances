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
 * Score-based matching (no exact-amount requirement):
 *  - Manual income transactions store GROSS in transactions.amount.
 *    The actual bank deposit lives on the linked income_entry as deposited_amount.
 *  - Plaid imported transactions reflect the bank deposit amount.
 *  - We weigh date proximity, amount plausibility (vs deposited / vs net of gross),
 *    vendor similarity, and company context. We never require exact equality.
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
        const mAmount = Math.abs(m.amount); // for income this is GROSS

        // ── Date proximity (required signal) ──
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

        // ── Amount plausibility (no exact match required) ──
        let amountScore = 0;
        if (isIncome) {
          const linkedIncome = incomeByTxId.get(m.id);
          const deposited = Number(linkedIncome?.deposited_amount || 0);
          const gross = Number(linkedIncome?.paycheck_amount || mAmount);
          const taxesWithheld = Number(linkedIncome?.taxes_withheld || 0);
          const preTaxDed = Number(linkedIncome?.pre_tax_deductions || 0);
          const retirement = Number(linkedIncome?.retirement_401k || 0);
          const calcNet = Math.max(0, gross - taxesWithheld - preTaxDed - retirement);

          // Prefer deposited_amount when present
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
            // No deposit info — judge plausibility against gross
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

        // ── Vendor similarity ──
        const mVendor = (m.vendor || "").toLowerCase().trim();
        const pVendor = (p.vendor || "").toLowerCase().trim();
        if (mVendor && pVendor && (mVendor.includes(pVendor) || pVendor.includes(mVendor))) {
          score += 18;
          reasons.push("Similar description");
        }

        // ── Company / entity context ──
        if (m.entity && p.entity && m.entity === p.entity && m.entity !== "Unassigned") {
          score += 10;
          reasons.push("Same company");
        }

        // ── Tiering thresholds (per spec) ──
        // Strong: ≤3d AND amount near deposit (amountScore high)
        // Likely: ≤5d AND amount plausibly < gross
        // Possible: ≤7d AND directionally plausible
        const minScore =
          daysDiff <= 3 && amountScore >= 28 ? 40 :
          daysDiff <= 5 && amountScore >= 12 ? 35 :
          daysDiff <= 7 && amountScore >= 8 ? 30 :
          999; // skip
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
