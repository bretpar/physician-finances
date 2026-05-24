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

/**
 * Pure helper for the linking eligibility check. Determines which selected
 * transactions are truly already linked (and thus must be unlinked before
 * being re-linked) versus which link rows are stale (single-sided / orphan
 * group with no live partner) and can be cleaned up silently.
 *
 * A link group counts as "active" only when ≥2 distinct partner transactions
 * referenced by the group still exist. Review status, possible-match status,
 * duplicate flags, Plaid metadata, and stale denormalized
 * `transactions.linked_group_id` are NOT considered "linked".
 */
export function computeLinkEligibility(args: {
  selectedTxIds: string[];
  directLinks: Array<{
    id: string;
    manual_transaction_id: string | null;
    plaid_transaction_record_id: string | null;
    linked_group_id: string;
  }>;
  groupRows: Array<{
    id: string;
    manual_transaction_id: string | null;
    plaid_transaction_record_id: string | null;
    linked_group_id: string;
  }>;
  liveTxIds: Set<string>;
}): {
  trulyLinked: Array<{ txId: string; groupId: string; reason: string }>;
  staleLinkIds: string[];
  activeGroupIds: Set<string>;
} {
  const groupPartnerIds = new Map<string, Set<string>>();
  for (const l of args.groupRows) {
    const set = groupPartnerIds.get(l.linked_group_id) || new Set<string>();
    if (l.manual_transaction_id) set.add(l.manual_transaction_id);
    if (l.plaid_transaction_record_id) set.add(l.plaid_transaction_record_id);
    groupPartnerIds.set(l.linked_group_id, set);
  }
  const activeGroupIds = new Set<string>();
  for (const [gid, partners] of groupPartnerIds.entries()) {
    const liveCount = [...partners].filter((p) => args.liveTxIds.has(p)).length;
    if (liveCount >= 2) activeGroupIds.add(gid);
  }
  const trulyLinked: Array<{ txId: string; groupId: string; reason: string }> = [];
  const staleLinkIds: string[] = [];
  for (const l of args.directLinks) {
    const selectedSide =
      (l.manual_transaction_id && args.selectedTxIds.includes(l.manual_transaction_id) && l.manual_transaction_id) ||
      (l.plaid_transaction_record_id && args.selectedTxIds.includes(l.plaid_transaction_record_id) && l.plaid_transaction_record_id) ||
      null;
    if (!selectedSide) continue;
    if (activeGroupIds.has(l.linked_group_id)) {
      trulyLinked.push({
        txId: selectedSide,
        groupId: l.linked_group_id,
        reason: "active_link_group_with_live_partners",
      });
    } else {
      staleLinkIds.push(l.id);
    }
  }
  return { trulyLinked, staleLinkIds, activeGroupIds };
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
          // Canonical "Total Federal Payroll Taxes" via shared helper
          // (federal income tax + Social Security + Medicare). State is
          // intentionally separate.
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

      // Validate both records exist before linking and pull the Plaid net
      // deposit metadata so we can denormalize it onto the manual row. The
      // manual row remains the source of truth — we never copy planned fields
      // (amount/vendor/entity/category/etc.) from the Plaid row.
      const { data: manualRow } = await supabase
        .from("transactions")
        .select("id")
        .eq("id", manualTxId)
        .maybeSingle();
      const { data: plaidRow } = await supabase
        .from("transactions")
        .select("id, amount, transaction_date, vendor, account_source")
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

      // Update manual tx — it stays the canonical (active) row. We mutate
      // ONLY link bookkeeping fields and the denormalized Plaid net deposit
      // metadata. Planned/ledger fields (amount, vendor, entity, category,
      // tax fields, healthcare/retirement deductions, etc.) are never
      // touched here.
      const { error: e1 } = await supabase
        .from("transactions")
        .update({
          match_status: "linked",
          linked_group_id: groupId,
          source_type: "merged",
          status: "active",
          linked_plaid_transaction_id: plaidTxId,
          linked_plaid_amount: (plaidRow as any).amount ?? null,
          linked_plaid_posted_date: (plaidRow as any).transaction_date ?? null,
          linked_plaid_account: (plaidRow as any).account_source ?? null,
        } as any)
        .eq("id", manualTxId);
      if (e1) throw e1;

      // SOFT-MARK the Plaid duplicate as 'merged'. The row is preserved for
      // audit / unlink, but business-ledger and global queries filter
      // status='active', so it disappears from the UI and totals.
      const { error: e2 } = await supabase
        .from("transactions")
        .update({
          status: "merged",
          match_status: "linked",
          linked_group_id: groupId,
        })
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
      // Restore the manual side back to "unmatched / manual" and re-activate
      // the Plaid side that was soft-marked as 'merged' at link time.
      const { error: e1 } = await supabase
        .from("transactions")
        .update({
          match_status: "unmatched",
          linked_group_id: null,
          source_type: "manual",
          linked_plaid_transaction_id: null,
          linked_plaid_amount: null,
          linked_plaid_posted_date: null,
          linked_plaid_account: null,
        } as any)
        .eq("linked_group_id", groupId)
        .eq("source_type", "merged")
        .eq("status", "active");

      const { error: e2 } = await supabase
        .from("transactions")
        .update({ match_status: "unmatched", linked_group_id: null, status: "active" })
        .eq("linked_group_id", groupId)
        .eq("status", "merged");

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

// ============================================================
// New many-to-many match groups (long-press multi-select model)
// ============================================================

export interface MatchGroupItem {
  itemId: string;
  transaction: DbTransaction;
  source: "manual" | "imported";
}

/**
 * Returns a Map keyed by linked_group_id with only real user-created links.
 * Suggested/import/planner match groups are intentionally ignored here so they
 * never show as linked transactions in the ledger or detail sheet.
 */
export function useMatchGroups() {
  return useQuery({
    queryKey: ["match-groups"],
    queryFn: async () => {
      const { data: links, error: lErr } = await supabase
        .from("transaction_links")
        .select("id, linked_group_id, manual_transaction_id, plaid_transaction_record_id")
        .eq("status", "linked")
        .eq("created_by_user", true);
      if (lErr) throw lErr;

      const groupIds = Array.from(new Set((links || []).map((l: any) => l.linked_group_id as string)));
      const txIds = Array.from(new Set((links || []).flatMap((l: any) => [l.manual_transaction_id, l.plaid_transaction_record_id]).filter(Boolean)));
      if (groupIds.length === 0 || txIds.length === 0) return new Map<string, MatchGroupItem[]>();

      let txById = new Map<string, DbTransaction>();
      if (txIds.length > 0) {
        // Need merged rows too — bypass the status='active' filter used by useTransactions().
        const { data: txs, error: tErr } = await supabase
          .from("transactions")
          .select("*")
          .in("id", txIds);
        if (tErr) throw tErr;
        txById = new Map((txs || []).map((t: any) => [t.id as string, t as DbTransaction]));
      }

      const map = new Map<string, MatchGroupItem[]>();
      for (const link of links || []) {
        const groupId = (link as any).linked_group_id as string;
        const arr = map.get(groupId) || [];
        const seen = new Set(arr.map((it) => it.transaction.id));
        for (const txId of [(link as any).manual_transaction_id, (link as any).plaid_transaction_record_id].filter(Boolean)) {
          if (seen.has(txId)) continue;
          const tx = txById.get(txId);
          if (!tx) continue;
          arr.push({
            itemId: tx.id,
            transaction: tx,
            source: isImportedSource(tx.source_type) ? "imported" : "manual",
          });
          seen.add(tx.id);
        }
        map.set(groupId, arr);
      }
      return map;
    },
  });
}

const isImportedSource = (s: string | null | undefined) =>
  s === "plaid" || s === "merged";

const isManualLikeSource = (s: string | null | undefined) =>
  !s || s === "manual" || s === "planner";

/**
 * Canonical row selector for a linked group.
 *
 * Rule order (highest wins):
 *  A) Most-complete tax/accounting data: counts non-empty enrichment fields
 *     on the transaction row itself AND on its linked income_entry (if any).
 *  B) Origin: manual/planner beats imported (plaid).
 *  C) Earliest created_at.
 *
 * Exported for unit testing.
 */
export interface CanonicalCandidate {
  id: string;
  source_type: string | null;
  created_at: string;
  category?: string | null;
  source_id?: string | null;
  vendor?: string | null;
  notes?: string | null;
  recommended_withholding?: number | null;
  actual_withholding?: number | null;
  receipt_url?: string | null;
  /** Optional enrichment from a linked income_entry (gross/withholding/etc). */
  incomeEnrichmentScore?: number;
}

export function pickCanonicalLinkedRow<T extends CanonicalCandidate>(rows: T[]): T {
  if (rows.length === 0) throw new Error("pickCanonicalLinkedRow: empty rows");
  const scored = rows.map((r) => {
    let completeness = 0;
    if (r.category && r.category !== "Uncategorized") completeness++;
    if (r.source_id) completeness++;
    if (r.vendor && r.vendor.trim()) completeness++;
    if (r.notes && r.notes.trim()) completeness++;
    if (Number(r.recommended_withholding || 0) > 0) completeness++;
    if (Number(r.actual_withholding || 0) > 0) completeness++;
    if (r.receipt_url) completeness++;
    completeness += Math.max(0, Number(r.incomeEnrichmentScore || 0));
    const originRank = isManualLikeSource(r.source_type) ? 1 : 0;
    return { row: r, completeness, originRank, createdAt: r.created_at };
  });
  scored.sort((a, b) => {
    if (b.completeness !== a.completeness) return b.completeness - a.completeness;
    if (b.originRank !== a.originRank) return b.originRank - a.originRank;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return scored[0].row;
}

/**
 * Create a many-to-many match group from a free-form selection of
 * transactions. Rules:
 *  - Requires ≥2 transactions
 *  - Refuses if any selected tx is already in another active group
 *  - If the group contains ≥1 manual AND ≥1 imported, the imported rows
 *    are flipped to status='merged' so they no longer contribute to
 *    dashboard/tax/ledger totals (manual is the source of truth).
 *  - Otherwise (manual-only or imported-only) all rows stay active.
 */
export function useCreateMatchGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ transactionIds }: { transactionIds: string[] }) => {
      if (transactionIds.length < 2) {
        throw new Error("Select at least 2 transactions to link");
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();

      const { data: rows, error: fErr } = await supabase
        .from("transactions")
        .select(
          "id, amount, source_type, transaction_type, linked_group_id, match_status, created_at, category, source_id, vendor, notes, recommended_withholding, actual_withholding, receipt_url"
        )
        .in("id", transactionIds);
      if (fErr) throw fErr;
      if (!rows || rows.length !== transactionIds.length) {
        throw new Error("Some transactions no longer exist. Please refresh.");
      }

      console.log("[LinkTx] selected ids:", transactionIds);

      // Verify "already linked" against real user-created transaction_links
      // only. A transaction is "truly linked" ONLY if it belongs to an
      // active linked_group_id that still references ≥2 live partner
      // transactions. Single-sided / orphan link rows (where the other
      // side was deleted) are stale and must NOT block re-linking.
      const { data: directLinks } = await supabase
        .from("transaction_links")
        .select("id, manual_transaction_id, plaid_transaction_record_id, linked_group_id, status, created_by_user")
        .or(
          `manual_transaction_id.in.(${transactionIds.join(",")}),plaid_transaction_record_id.in.(${transactionIds.join(",")})`
        )
        .eq("status", "linked")
        .eq("created_by_user", true);

      const touchedGroupIds = Array.from(
        new Set(((directLinks || []) as any[]).map((l) => l.linked_group_id).filter(Boolean))
      );

      let groupRows: any[] = [];
      if (touchedGroupIds.length > 0) {
        const { data: allGroupLinks } = await supabase
          .from("transaction_links")
          .select("id, manual_transaction_id, plaid_transaction_record_id, linked_group_id")
          .in("linked_group_id", touchedGroupIds)
          .eq("status", "linked")
          .eq("created_by_user", true);
        groupRows = (allGroupLinks || []) as any[];
      }

      const allPartnerIds = Array.from(
        new Set(groupRows.flatMap((l) => [l.manual_transaction_id, l.plaid_transaction_record_id]).filter(Boolean) as string[])
      );
      let livePartnerIds = new Set<string>();
      if (allPartnerIds.length > 0) {
        const { data: liveTxs } = await supabase
          .from("transactions")
          .select("id")
          .in("id", allPartnerIds);
        livePartnerIds = new Set(((liveTxs || []) as any[]).map((r) => r.id));
      }

      const { trulyLinked, staleLinkIds } = computeLinkEligibility({
        selectedTxIds: transactionIds,
        directLinks: (directLinks || []) as any[],
        groupRows,
        liveTxIds: livePartnerIds,
      });

      const staleTxIds: string[] = [];
      for (const r of rows as any[]) {
        const isActive = trulyLinked.some((t) => t.txId === r.id);
        if (!isActive && (r.linked_group_id || r.match_status === "linked")) {
          staleTxIds.push(r.id);
        }
      }

      if (trulyLinked.length > 0) {
        console.warn("[LinkTx] BLOCKED — truly linked:", trulyLinked);
        throw new Error("One or more selected transactions are already linked. Unlink them first.");
      }

      // Clean up stale single-sided link rows so they never block again.
      if (staleLinkIds.length > 0) {
        console.log("[LinkTx] cleaning stale link rows:", staleLinkIds);
        await supabase
          .from("transaction_links")
          .update({ status: "unlinked" } as any)
          .in("id", staleLinkIds);
      }

      // Clear stale denormalized flags so future loads reflect reality.
      if (staleTxIds.length > 0) {
        console.log("[LinkTx] clearing stale tx link flags:", staleTxIds);
        await supabase
          .from("transactions")
          .update({ match_status: "unmatched", linked_group_id: null } as any)
          .in("id", staleTxIds);
      }

      // Pull income_entry enrichment for any rows that have one — used to
      // boost completeness score of the canonical candidate.
      const { data: incomeRows } = await supabase
        .from("income_entries")
        .select(
          "linked_transaction_id, paycheck_amount, federal_withholding, state_withholding, retirement_401k, hsa_contribution, healthcare_deduction, notes, company"
        )
        .in("linked_transaction_id", transactionIds);
      const enrichmentByTx = new Map<string, number>();
      for (const ie of (incomeRows || []) as any[]) {
        let score = 0;
        if (Number(ie.paycheck_amount || 0) > 0) score++;
        if (Number(ie.federal_withholding || 0) > 0) score++;
        if (Number(ie.state_withholding || 0) > 0) score++;
        if (Number(ie.retirement_401k || 0) > 0) score++;
        if (Number(ie.hsa_contribution || 0) > 0) score++;
        if (Number(ie.healthcare_deduction || 0) > 0) score++;
        if (ie.notes && String(ie.notes).trim()) score++;
        if (ie.company && String(ie.company).trim()) score++;
        enrichmentByTx.set(ie.linked_transaction_id, (enrichmentByTx.get(ie.linked_transaction_id) || 0) + score);
      }

      const candidates: CanonicalCandidate[] = (rows as any[]).map((r) => ({
        id: r.id,
        source_type: r.source_type,
        created_at: r.created_at,
        category: r.category,
        source_id: r.source_id,
        vendor: r.vendor,
        notes: r.notes,
        recommended_withholding: r.recommended_withholding,
        actual_withholding: r.actual_withholding,
        receipt_url: r.receipt_url,
        incomeEnrichmentScore: enrichmentByTx.get(r.id) || 0,
      }));
      const canonical = pickCanonicalLinkedRow(candidates);
      const mergedIds = candidates.filter((c) => c.id !== canonical.id).map((c) => c.id);

      console.log("[LinkTx] canonical:", canonical.id, "merged:", mergedIds);

      const groupId = crypto.randomUUID();
      const linkRows = mergedIds.map((txId) => ({
        user_id: user.id,
        organization_id: orgId,
        linked_group_id: groupId,
        manual_transaction_id: canonical.id,
        plaid_transaction_record_id: txId,
        status: "linked",
        created_by_user: true,
      }));
      const { error: iErr } = await supabase.from("transaction_links").insert(linkRows as any);
      if (iErr) throw iErr;

      // Canonical row stays active and owns the link metadata; every other
      // row in the group becomes status='merged' so all downstream totals
      // (ledger, dashboard, tax, reports, exports) count the group once.
      const { error: e1 } = await supabase
        .from("transactions")
        .update({ match_status: "linked", linked_group_id: groupId } as any)
        .eq("id", canonical.id);
      if (e1) throw e1;

      if (mergedIds.length > 0) {
        const { error: e2 } = await supabase
          .from("transactions")
          .update({ match_status: "linked", linked_group_id: groupId, status: "merged" } as any)
          .in("id", mergedIds);
        if (e2) throw e2;
      }
      return groupId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Transactions linked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not link transactions"),
  });
}

async function restoreTransactions(transactionIds: string[]) {
  if (transactionIds.length === 0) return;
  const { error } = await supabase
    .from("transactions")
    .update({ match_status: "unmatched", linked_group_id: null, status: "active" } as any)
    .in("id", transactionIds);
  if (error) throw error;
}

export function useUnlinkMatchGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (groupId: string) => {
      const { data: links } = await supabase
        .from("transaction_links")
        .select("manual_transaction_id, plaid_transaction_record_id")
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true);
      const ids = Array.from(new Set((links || []).flatMap((l: any) => [l.manual_transaction_id, l.plaid_transaction_record_id]).filter(Boolean)));
      await restoreTransactions(ids);
      const { error } = await supabase
        .from("transaction_links")
        .update({ status: "unlinked" } as any)
        .eq("linked_group_id", groupId)
        .eq("created_by_user", true);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Transactions unlinked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not unlink"),
  });
}

export function useUnlinkMatchGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string }) => {
      const { error } = await supabase
        .from("transaction_links")
        .update({ status: "unlinked" } as any)
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true)
        .or(`manual_transaction_id.eq.${itemId},plaid_transaction_record_id.eq.${itemId}`);
      if (error) throw error;
      await restoreTransactions([itemId]);

      const { data: remainingLinks } = await supabase
        .from("transaction_links")
        .select("manual_transaction_id, plaid_transaction_record_id")
        .eq("linked_group_id", groupId)
        .eq("status", "linked")
        .eq("created_by_user", true);
      const remainingIds = Array.from(new Set((remainingLinks || []).flatMap((l: any) => [l.manual_transaction_id, l.plaid_transaction_record_id]).filter(Boolean)));
      if (remainingIds.length < 2) {
        await restoreTransactions(remainingIds);
        await supabase
          .from("transaction_links")
          .update({ status: "unlinked" } as any)
          .eq("linked_group_id", groupId)
          .eq("created_by_user", true);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      qc.invalidateQueries({ queryKey: ["transaction-links"] });
      toast.success("Unlinked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not unlink"),
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
