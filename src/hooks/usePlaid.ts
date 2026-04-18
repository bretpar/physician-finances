import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ---- Plaid Items ----
export function usePlaidItems() {
  return useQuery({
    queryKey: ["plaid-items"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("plaid_items_safe")
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

// ---- Toggle Account Sync ----
export function useToggleAccountSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, sync_enabled }: { id: string; sync_enabled: boolean }) => {
      const { error } = await supabase
        .from("plaid_accounts")
        .update({ sync_enabled } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ---- Bulk update account preferences after review ----
export function useReviewAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      accounts: Array<{
        id: string;
        sync_enabled: boolean;
        account_business_mode: string;
        default_company_id: string | null;
        account_routing: string;
      }>
    ) => {
      for (const acct of accounts) {
        const { error } = await supabase
          .from("plaid_accounts")
          .update({
            sync_enabled: acct.sync_enabled,
            account_business_mode: acct.account_business_mode,
            default_company_id: acct.default_company_id,
            account_routing: acct.account_routing,
          } as any)
          .eq("id", acct.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
      toast.success("Account preferences saved");
    },
    onError: (e: any) => toast.error(e.message),
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

// ---- Update Account Business Affiliation ----
export function useUpdatePlaidAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      default_company_id,
      account_business_mode,
      account_routing,
    }: {
      id: string;
      default_company_id: string | null;
      account_business_mode: string;
      account_routing?: string;
    }) => {
      const update: any = { default_company_id, account_business_mode };
      if (account_routing) {
        update.account_routing = account_routing;
        // Sync the sync_enabled flag based on routing
        update.sync_enabled = account_routing !== "ignore" && account_routing !== "needs_review";
      }
      const { error } = await supabase
        .from("plaid_accounts")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
      toast.success("Account settings updated");
    },
    onError: (e: any) => toast.error(e.message),
  });
}

// ---- Bulk Apply Default Business ----
export function useBulkApplyAccountBusiness() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ accountId, companyName }: { accountId: string; companyName: string }) => {
      // Get the plaid_account's plaid_account_id to find matching transactions
      const { data: acct, error: acctErr } = await supabase
        .from("plaid_accounts")
        .select("plaid_account_id, account_name")
        .eq("id", accountId)
        .single();
      if (acctErr || !acct) throw acctErr || new Error("Account not found");

      // Find plaid_transactions for this account
      const { data: plaidTxns } = await supabase
        .from("plaid_transactions")
        .select("id")
        .eq("plaid_account_id", acct.plaid_account_id);

      if (!plaidTxns?.length) return { updated: 0 };

      const plaidIds = plaidTxns.map((t) => t.id);
      // Update transactions that are unassigned
      const { error, count } = await supabase
        .from("transactions")
        .update({ entity: companyName, assignment_source: "account_default" } as any)
        .in("plaid_transaction_ref", plaidIds)
        .eq("entity", "Unassigned");
      if (error) throw error;
      return { updated: count || 0 };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast.success(`Applied default business to ${data.updated} transactions`);
    },
    onError: (e: any) => toast.error(e.message),
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
