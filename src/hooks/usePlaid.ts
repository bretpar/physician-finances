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
      qc.invalidateQueries({ queryKey: ["plaid-transactions"] });
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

export function usePlaidNeedsReviewTransactions() {
  return useQuery({
    queryKey: ["plaid-transactions", "needs-review"],
    queryFn: async () => {
      const { data: rawRows, error } = await supabase
        .from("plaid_transactions")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;

      const rows = rawRows || [];
      if (rows.length === 0) return [];

      const rawIds = rows.map((r: any) => r.id);
      const plaidAccountIds = Array.from(new Set(rows.map((r: any) => r.plaid_account_id).filter(Boolean)));

      const [{ data: appTxs }, { data: incomeEntries }, { data: accounts }] = await Promise.all([
        supabase.from("transactions").select("plaid_transaction_ref").in("plaid_transaction_ref", rawIds),
        supabase.from("income_entries").select("linked_transaction_id").in("linked_transaction_id", rawIds),
        supabase.from("plaid_accounts").select("plaid_account_id, account_name, account_routing, sync_enabled").in("plaid_account_id", plaidAccountIds),
      ]);

      const routedIds = new Set([
        ...((appTxs || []).map((t: any) => t.plaid_transaction_ref).filter(Boolean)),
        ...((incomeEntries || []).map((t: any) => t.linked_transaction_id).filter(Boolean)),
      ]);
      const accountMap = new Map((accounts || []).map((a: any) => [a.plaid_account_id, a]));

      return rows
        .map((row: any) => ({ ...row, account: accountMap.get(row.plaid_account_id) || null }))
        .filter((row: any) => !routedIds.has(row.id) && (row.account?.account_routing || "needs_review") === "needs_review");
    },
  });
}

function syncSummary(data: any) {
  const added = data?.raw_imported || 0;
  const relinked = data?.relinked_transactions || 0;
  const updated = data?.transactions_modified || 0;
  const review = data?.needs_review_transactions || 0;
  const skipped = data?.skipped_ignored_accounts || data?.transactions_skipped || 0;
  const tomb = data?.tombstoned_transactions || data?.transactions_tombstoned || 0;
  return `Imported ${added} new · Updated ${updated} · Relinked ${relinked} · Needs review ${review} · Skipped ${skipped} · Tombstoned ${tomb}`;
}

// ---- Sync Transactions ----
// Pass { silent: true } for background syncs (no success toast, error toast only).
type SyncArg = string | undefined | { itemId?: string; silent?: boolean };
export function useSyncTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (arg?: SyncArg) => {
      const itemId = typeof arg === "string" ? arg : arg?.itemId;
      const silent = typeof arg === "object" && arg?.silent;
      const { data, error } = await supabase.functions.invoke("plaid-sync-transactions", {
        body: itemId ? { item_id: itemId } : {},
      });
      if (error) throw error;
      return { data, silent };
    },
    onSuccess: ({ data, silent }) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["plaid-transactions"] });
      qc.invalidateQueries({ queryKey: ["plaid-items"] });
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
      if (silent) return;
      toast.success(data?.mode === "backfill" ? "Backfill complete" : "Sync complete", {
        description: syncSummary(data),
      });
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useBackfillPlaidTransactions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (plaidAccountId?: string) => {
      const { data, error } = await supabase.functions.invoke("plaid-sync-transactions", {
        body: { mode: "backfill", ...(plaidAccountId ? { plaid_account_id: plaidAccountId } : {}) },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
      qc.invalidateQueries({ queryKey: ["plaid-transactions"] });
      toast.success("Backfill complete", { description: syncSummary(data) });
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
        update.sync_enabled = account_routing !== "ignore";
      }
      const { error } = await supabase
        .from("plaid_accounts")
        .update(update)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plaid-accounts"] });
      qc.invalidateQueries({ queryKey: ["plaid-transactions"] });
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
