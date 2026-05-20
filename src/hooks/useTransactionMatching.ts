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
 * Returns a Map keyed by match_group_id with all items (incl. their
 * transaction rows even if status='merged') for active groups belonging
 * to the current user.
 */
export function useMatchGroups() {
  return useQuery({
    queryKey: ["match-groups"],
    queryFn: async () => {
      const { data: groups, error: gErr } = await supabase
        .from("transaction_match_groups")
        .select("id, status")
        .eq("status", "active");
      if (gErr) throw gErr;
      const groupIds = (groups || []).map((g: any) => g.id as string);
      if (groupIds.length === 0) return new Map<string, MatchGroupItem[]>();

      const { data: items, error: iErr } = await supabase
        .from("transaction_match_group_items")
        .select("id, match_group_id, transaction_id, transaction_source")
        .in("match_group_id", groupIds);
      if (iErr) throw iErr;

      const txIds = Array.from(new Set((items || []).map((i: any) => i.transaction_id)));
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
      for (const it of items || []) {
        const tx = txById.get((it as any).transaction_id);
        if (!tx) continue;
        const arr = map.get((it as any).match_group_id) || [];
        arr.push({
          itemId: (it as any).id,
          transaction: tx,
          source: ((it as any).transaction_source as "manual" | "imported"),
        });
        map.set((it as any).match_group_id, arr);
      }
      return map;
    },
  });
}

const isImportedSource = (s: string | null | undefined) =>
  s === "plaid" || s === "merged";

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
        .select("id, amount, source_type, transaction_type, linked_group_id, match_status")
        .in("id", transactionIds);
      if (fErr) throw fErr;
      if (!rows || rows.length !== transactionIds.length) {
        throw new Error("Some transactions no longer exist. Please refresh.");
      }

      console.log("[LinkTx] selected ids:", transactionIds);

      // Verify "already linked" against the ACTUAL active link records, not
      // stale denormalized flags like linked_group_id / match_status. A tx is
      // only considered linked if it appears in an active match group with
      // ≥2 items, or in a transaction_links row with status='linked'.
      const [activeGroupItemsRes, activeLinksRes] = await Promise.all([
        supabase
          .from("transaction_match_group_items")
          .select("transaction_id, match_group_id, transaction_match_groups!inner(status)")
          .in("transaction_id", transactionIds)
          .eq("transaction_match_groups.status", "active"),
        supabase
          .from("transaction_links")
          .select("manual_transaction_id, plaid_transaction_record_id, linked_group_id, status")
          .or(
            `manual_transaction_id.in.(${transactionIds.join(",")}),plaid_transaction_record_id.in.(${transactionIds.join(",")})`
          )
          .eq("status", "linked"),
      ]);

      const groupCounts = new Map<string, number>();
      for (const it of (activeGroupItemsRes.data || []) as any[]) {
        groupCounts.set(it.match_group_id, (groupCounts.get(it.match_group_id) || 0) + 1);
      }
      const txInValidGroup = new Set<string>();
      for (const it of (activeGroupItemsRes.data || []) as any[]) {
        if ((groupCounts.get(it.match_group_id) || 0) >= 2) {
          txInValidGroup.add(it.transaction_id);
        }
      }
      const txInActiveLink = new Set<string>();
      for (const l of (activeLinksRes.data || []) as any[]) {
        if (l.manual_transaction_id) txInActiveLink.add(l.manual_transaction_id);
        if (l.plaid_transaction_record_id) txInActiveLink.add(l.plaid_transaction_record_id);
      }

      const trulyLinked: string[] = [];
      const stale: string[] = [];
      for (const r of rows as any[]) {
        const isReallyLinked = txInValidGroup.has(r.id) || txInActiveLink.has(r.id);
        console.log("[LinkTx] tx", r.id, {
          linked_group_id: r.linked_group_id,
          match_status: r.match_status,
          inActiveGroup: txInValidGroup.has(r.id),
          inActiveLink: txInActiveLink.has(r.id),
          decision: isReallyLinked ? "linked" : "free",
        });
        if (isReallyLinked) trulyLinked.push(r.id);
        else if (r.linked_group_id || r.match_status === "linked") stale.push(r.id);
      }

      if (trulyLinked.length > 0) {
        console.log("[LinkTx] BLOCK — truly linked ids:", trulyLinked);
        throw new Error("One or more selected transactions are already linked. Unlink them first.");
      }

      // Clear stale denormalized flags so future loads reflect reality.
      if (stale.length > 0) {
        console.log("[LinkTx] clearing stale link flags on:", stale);
        await supabase
          .from("transactions")
          .update({ match_status: "unmatched", linked_group_id: null } as any)
          .in("id", stale);
      }

      console.log("[LinkTx] ALLOW link for:", transactionIds);

      const hasManual = rows.some((r: any) => (r.source_type || "manual") === "manual");
      const hasImported = rows.some((r: any) => isImportedSource(r.source_type));

      const manualTotal = rows
        .filter((r: any) => (r.source_type || "manual") === "manual")
        .reduce((sum: number, r: any) => sum + Math.abs(Number(r.amount) || 0), 0);
      const importedTotal = rows
        .filter((r: any) => isImportedSource(r.source_type))
        .reduce((sum: number, r: any) => sum + Math.abs(Number(r.amount) || 0), 0);

      const { data: groupRow, error: gErr } = await supabase
        .from("transaction_match_groups")
        .insert({
          user_id: user.id,
          organization_id: orgId,
          status: "active",
          manual_total: manualTotal,
          imported_total: importedTotal,
          difference: Math.abs(manualTotal - importedTotal),
        } as any)
        .select("id")
        .single();
      if (gErr || !groupRow) throw gErr || new Error("Could not create match group");
      const groupId = (groupRow as any).id as string;

      const itemRows = rows.map((r: any) => ({
        match_group_id: groupId,
        transaction_id: r.id,
        transaction_source: (r.source_type || "manual") === "manual" ? "manual" : "imported",
        user_id: user.id,
        organization_id: orgId,
      }));
      const { error: iErr } = await supabase
        .from("transaction_match_group_items")
        .insert(itemRows as any);
      if (iErr) throw iErr;

      // Flip imported rows to 'merged' only if a manual row anchors the group.
      const manualIds = rows.filter((r: any) => (r.source_type || "manual") === "manual").map((r: any) => r.id);
      const importedIds = rows.filter((r: any) => isImportedSource(r.source_type)).map((r: any) => r.id);

      if (manualIds.length > 0) {
        const { error: e1 } = await supabase
          .from("transactions")
          .update({ match_status: "linked", linked_group_id: groupId } as any)
          .in("id", manualIds);
        if (e1) throw e1;
      }
      if (importedIds.length > 0) {
        const newStatus = hasManual && hasImported ? "merged" : "active";
        const { error: e2 } = await supabase
          .from("transactions")
          .update({ match_status: "linked", linked_group_id: groupId, status: newStatus } as any)
          .in("id", importedIds);
        if (e2) throw e2;
      }
      return groupId;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
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
      const { data: items } = await supabase
        .from("transaction_match_group_items")
        .select("transaction_id")
        .eq("match_group_id", groupId);
      const ids = (items || []).map((i: any) => i.transaction_id as string);
      await restoreTransactions(ids);
      const { error } = await supabase
        .from("transaction_match_groups")
        .update({ status: "unlinked" } as any)
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
      toast.success("Transactions unlinked.");
    },
    onError: (e: any) => toast.error(e.message || "Could not unlink"),
  });
}

export function useUnlinkMatchGroupItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ itemId, groupId }: { itemId: string; groupId: string }) => {
      const { data: item } = await supabase
        .from("transaction_match_group_items")
        .select("transaction_id")
        .eq("id", itemId)
        .maybeSingle();
      if (!item) throw new Error("Item not found");
      await supabase.from("transaction_match_group_items").delete().eq("id", itemId);
      await restoreTransactions([(item as any).transaction_id]);

      // If the group now has fewer than 2 items, dissolve it entirely.
      const { data: remaining } = await supabase
        .from("transaction_match_group_items")
        .select("id, transaction_id")
        .eq("match_group_id", groupId);
      if ((remaining || []).length < 2) {
        const remainingIds = (remaining || []).map((r: any) => r.transaction_id as string);
        await restoreTransactions(remainingIds);
        if ((remaining || []).length > 0) {
          await supabase.from("transaction_match_group_items").delete().eq("match_group_id", groupId);
        }
        await supabase
          .from("transaction_match_groups")
          .update({ status: "unlinked" } as any)
          .eq("id", groupId);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["match-groups"] });
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
