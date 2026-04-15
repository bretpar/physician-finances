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
  is_deleted: boolean;
  entity: string;
  company_type: string;
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
  needs_review: boolean;
  excluded_from_reports: boolean;
  transfer_subtype: string | null;
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transactions updated");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: ["transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("is_deleted", false)
        .order("transaction_date", { ascending: false });
      if (error) throw error;
      return (data || []) as DbTransaction[];
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
        transaction_type: (tx.transaction_type as string) || "expense",
      }).select("id").single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transaction added");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useUpdateTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DbTransaction> & { id: string }) => {
      const { error } = await supabase
        .from("transactions")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteTransaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transaction deleted");
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useBulkDeleteTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      // Unlink any income entries that reference these transactions
      const { error: unlinkError } = await supabase
        .from("income_entries")
        .update({ linked_transaction_id: null } as any)
        .in("linked_transaction_id", ids);
      if (unlinkError) console.error("Unlink income entries error:", unlinkError);

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
      qc.invalidateQueries({ queryKey: ["income-entries"] });
      toast.success(`Deleted ${count} transaction${count !== 1 ? "s" : ""}`);
    },
    onError: (e) => toast.error(e.message),
  });
}
