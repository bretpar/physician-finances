import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ---- Plaid Items ----
export function usePlaidItems() {
  return useQuery({
    queryKey: ["plaid-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plaid_items")
        .select("*")
        .eq("status", "active")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ---- Plaid Accounts ----
export function usePlaidAccounts() {
  return useQuery({
    queryKey: ["plaid-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plaid_accounts")
        .select("*")
        .eq("is_active", true)
        .order("account_name");
      if (error) throw error;
      return data || [];
    },
  });
}

// ---- Plaid Transactions (raw) ----
export function usePlaidTransactions() {
  return useQuery({
    queryKey: ["plaid-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plaid_transactions")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
}

// ---- Sync Transactions ----
export function useSyncTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId?: string) => {
      const { data, error } = await supabase.functions.invoke("plaid-sync-transactions", {
        body: itemId ? { item_id: itemId } : {},
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["plaid-transactions"] });
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
      toast.success(`Synced ${data?.transactions_added || 0} new transactions`);
    },
    onError: (e) => toast.error(e.message),
  });
}

// ---- Disconnect Plaid Item ----
export function useDisconnectPlaidItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: string) => {
      // Deactivate item
      const { error: itemErr } = await supabase
        .from("plaid_items")
        .update({ status: "disconnected" })
        .eq("id", itemId);
      if (itemErr) throw itemErr;

      // Deactivate accounts
      const { error: acctErr } = await supabase
        .from("plaid_accounts")
        .update({ is_active: false })
        .eq("plaid_item_id", itemId);
      if (acctErr) throw acctErr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
      toast.success("Bank account disconnected");
    },
    onError: (e) => toast.error(e.message),
  });
}
