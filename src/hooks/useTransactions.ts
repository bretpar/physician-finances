import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getUserOrgId } from "@/hooks/useOrgId";

export type TransactionType = "income" | "expense" | "transfer" | "deduction" | "stock" | "capital_gain" | "other";

export type TransferSubtype =
  | "credit_card_payment"
  | "account_transfer"
  | "owner_draw"
  | "owner_contribution"
  | null;

export const TRANSFER_SUBTYPES = [
  { value: "credit_card_payment", label: "Credit Card Payment" },
  { value: "account_transfer", label: "Account Transfer" },
  { value: "owner_draw", label: "Owner Draw" },
  { value: "owner_contribution", label: "Owner Contribution" },
  { value: "other", label: "Other Transfer" },
] as const;

export interface DbTransaction {
  id: string;
  user_id: string;
  transaction_date: string;
  vendor: string;
  amount: number;
  account_source: string;
  category: string;
  notes: string | null;
  receipt_url: string | null;
  entity: string;
  company_type: string;
  /** Canonical FK → companies.id. Source of truth for which business the row belongs to. */
  source_id: string | null;
  parent_transaction_id: string | null;
  recurring_frequency: string | null;
  is_recurring: boolean;
  transaction_type: TransactionType;
  recommended_withholding: number;
  withholding_saved: boolean;
  actual_withholding: number;
  source_type: string;
  plaid_transaction_ref: string | null;
  linked_group_id: string | null;
  match_status: string;
  /** 'active' = visible in ledger. 'duplicate' | 'merged' | 'archived' = hidden. */
  status: string;
  needs_review: boolean;
  excluded_from_reports: boolean;
  transfer_subtype: string | null;
  user_edited: boolean;
  created_at: string;
  updated_at: string;
}

// Bulk update multiple transactions at once
export function useBulkUpdateTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, updates }: { ids: string[]; updates: Partial<DbTransaction> }) => {
      const { error } = await supabase
        .from("transactions")
        .update(updates as any)
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["dashboard_summary"] }),
        qc.invalidateQueries({ queryKey: ["tax_estimate"] }),
      ]);
      toast.success("Transactions updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

/**
 * Global transactions feed (all of the user's active rows across companies).
 * Hard-delete model: deletion removes the row. We additionally filter by
 * `status = 'active'` so rows soft-marked as 'merged' / 'duplicate' / 'archived'
 * (e.g. the non-canonical side of a manual↔Plaid match) never appear in the
 * ledger or in totals.
 */
export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("status", "active")
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DbTransaction[];
    },
  });
}

/**
 * Strict business-ledger query. Reads the canonical `transactions` table as
 * the single source of truth. Returns ONLY rows that:
 *   - belong to the current authenticated user (enforced by RLS, repeated for safety)
 *   - belong to the requested business (`source_id = sourceId`)
 *   - are still active (not duplicate / merged / archived)
 *   - are not excluded from reports (treated as `is_hidden`)
 *
 * Account → business mapping is only a default at import time; this query
 * trusts `source_id` as the final assignment.
 */
export function useBusinessLedger(sourceId: string | null) {
  return useQuery({
    queryKey: ["transactions", "business-ledger", sourceId],
    enabled: !!sourceId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !sourceId) return [] as DbTransaction[];
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("user_id", user.id)
        .eq("source_id", sourceId)
        .eq("status", "active")
        .eq("excluded_from_reports", false)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DbTransaction[];
    },
  });
}

export function useAddTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (tx: Partial<DbTransaction>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");
      const orgId = await getUserOrgId();
      const { data, error } = await supabase.from("transactions").insert({
        user_id: user.id,
        organization_id: orgId,
        transaction_date: tx.transaction_date || new Date().toISOString().split("T")[0],
        vendor: tx.vendor || "",
        amount: tx.amount || 0,
        account_source: tx.account_source || "",
        category: tx.category || "Uncategorized",
        notes: tx.notes || "",
        entity: tx.entity || "Unassigned",
        company_type: tx.company_type || "",
        source_id: tx.source_id || null,
        schedule_c_category: (tx as any).schedule_c_category || null,
        needs_review: tx.needs_review ?? false,
        excluded_from_reports: tx.excluded_from_reports ?? false,
        transfer_subtype: tx.transfer_subtype || null,
        transaction_type: (tx.transaction_type as string) || "expense",
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.refetchQueries({ queryKey: ["transactions"] }),
        qc.invalidateQueries({ queryKey: ["dashboard_summary"] }),
        qc.invalidateQueries({ queryKey: ["tax_estimate"] }),
      ]);
      toast.success("Transaction added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbTransaction> & { id: string }) => {
      // Mark as user-edited if this is an imported transaction being changed
      const { data, error } = await supabase
        .from("transactions")
        .update({ ...updates, user_edited: true } as any)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      if (!data) throw new Error("No rows updated — transaction may have been deleted.");
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transaction updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // Look up the row first so we can:
      //   1. Clean up linked income_entries (avoid orphan tax inflation)
      //   2. If this was an imported Plaid row, write a tombstone so the next
      //      Plaid sync does NOT silently re-create it.
      const { data: tx } = await supabase
        .from("transactions")
        .select("id, transaction_type, plaid_transaction_ref, user_id, organization_id")
        .eq("id", id)
        .maybeSingle();

      if (tx && (tx as any).transaction_type === "income") {
        const { error: ieErr } = await supabase
          .from("income_entries")
          .delete()
          .eq("linked_transaction_id", id);
        if (ieErr) console.error("Delete linked income_entries error:", ieErr);
      }

      // Tombstone Plaid imports so they aren't resurrected on resync.
      if (tx && (tx as any).plaid_transaction_ref) {
        const { data: plaidRow } = await supabase
          .from("plaid_transactions")
          .select("plaid_transaction_id")
          .eq("id", (tx as any).plaid_transaction_ref)
          .maybeSingle();
        if (plaidRow?.plaid_transaction_id) {
          await supabase.from("plaid_deleted_tombstones").insert({
            user_id: (tx as any).user_id,
            organization_id: (tx as any).organization_id ?? null,
            plaid_transaction_id: plaidRow.plaid_transaction_id,
            reason: "user_deleted",
          } as any);
        }
      }

      // Clean up any link/match records pointing at this transaction.
      await supabase.from("transaction_links").delete()
        .or(`manual_transaction_id.eq.${id},plaid_transaction_record_id.eq.${id}`);

      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success("Transaction deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useBulkDeleteTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // Find which of these are income transactions — for those, delete the
      // linked income_entries rows (don't just unlink) so they no longer
      // contribute to tax totals as orphans.
      const { data: incomeTxs } = await supabase
        .from("transactions")
        .select("id")
        .in("id", ids)
        .eq("transaction_type", "income");
      const incomeTxIds = (incomeTxs || []).map((t: any) => t.id);

      if (incomeTxIds.length > 0) {
        const { error: delIeError } = await supabase
          .from("income_entries")
          .delete()
          .in("linked_transaction_id", incomeTxIds);
        if (delIeError) console.error("Delete linked income_entries error:", delIeError);
      }

      // Delete the transactions
      const { error } = await supabase
        .from("transactions")
        .delete()
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      toast.success(`Deleted ${count} transaction${count !== 1 ? "s" : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });
}
