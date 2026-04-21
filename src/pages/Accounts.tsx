import { useState, useEffect } from "react";
import { Landmark, Plus, RefreshCw, Loader2, Unplug, CreditCard, Building2, Settings2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  usePlaidItems,
  usePlaidAccounts,
  useSyncTransactions,
  useDisconnectPlaidItem,
  useUpdatePlaidAccount,
  useBulkApplyAccountBusiness,
} from "@/hooks/usePlaid";
import { useCompanies } from "@/contexts/CompanyContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function Accounts() {
  const { data: plaidItems = [], isLoading } = usePlaidItems();
  const { data: plaidAccounts = [] } = usePlaidAccounts();
  const { companies } = useCompanies();
  const syncMutation = useSyncTransactions();
  const disconnectMutation = useDisconnectPlaidItem();
  const updateAccountMutation = useUpdatePlaidAccount();
  const bulkApplyMutation = useBulkApplyAccountBusiness();

  const [linkLoading, setLinkLoading] = useState(false);
  const [disconnectItemId, setDisconnectItemId] = useState<string | null>(null);
  const [editingAccount, setEditingAccount] = useState<any | null>(null);
  const [editMode, setEditMode] = useState<string>("unassigned");
  const [editCompanyId, setEditCompanyId] = useState<string>("");

  const handleConnectBank = async () => {
    setLinkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-create-link-token");
      if (error || !data?.link_token) {
        toast.error("Failed to initialize bank connection");
        return;
      }

      if (!(window as any).Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Plaid"));
          document.head.appendChild(script);
        });
      }

      const handler = (window as any).Plaid.create({
        token: data.link_token,
        onSuccess: async (publicToken: string, metadata: any) => {
          const { error: exchangeError } = await supabase.functions.invoke("plaid-exchange-token", {
            body: {
              public_token: publicToken,
              institution_name: metadata?.institution?.name || "Bank Account",
              institution_id: metadata?.institution?.institution_id || "",
            },
          });
          if (exchangeError) {
            toast.error("Failed to connect account");
          } else {
            toast.success("Bank account connected!");
            syncMutation.mutate(undefined);
          }
        },
        onExit: () => {},
      });
      handler.open();
    } catch (err) {
      console.error(err);
      toast.error("Failed to open bank connection");
    } finally {
      setLinkLoading(false);
    }
  };

  const accountTypeIcon = (type: string) => {
    if (type === "credit") return <CreditCard className="h-4 w-4" />;
    return <Building2 className="h-4 w-4" />;
  };

  const formatDate = (d: string | null) => {
    if (!d) return "Never";
    return new Date(d).toLocaleString();
  };

  const formatRelative = (d: string | null) => {
    if (!d) return "never";
    const diffMs = Date.now() - new Date(d).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const isNeedsReauth = (item: any) =>
    item.status === "needs_reauth" || item.status === "login_required" || item.status === "error";

  const mostRecentSync: string | null = (plaidItems as any[]).reduce((acc: string | null, it: any) => {
    const t = it.last_synced_at;
    if (!t) return acc;
    if (!acc || new Date(t) > new Date(acc)) return t;
    return acc;
  }, null as string | null);

  const getCompanyName = (companyId: string | null) => {
    if (!companyId) return null;
    return companies.find((c) => c.id === companyId)?.name || null;
  };

  const getModeLabel = (mode: string, companyId: string | null) => {
    if (mode === "single_business") {
      const name = getCompanyName(companyId);
      return name || "Business (deleted)";
    }
    if (mode === "shared") return "Shared / Multiple";
    return "Unassigned";
  };

  const getModeColor = (mode: string): "secondary" | "default" | "outline" => {
    if (mode === "single_business") return "default";
    if (mode === "shared") return "secondary";
    return "outline";
  };

  const openEditDialog = (acct: any) => {
    setEditingAccount(acct);
    setEditMode((acct as any).account_business_mode || "unassigned");
    setEditCompanyId((acct as any).default_company_id || "");
  };

  const handleSaveAffiliation = () => {
    if (!editingAccount) return;
    updateAccountMutation.mutate({
      id: editingAccount.id,
      account_business_mode: editMode,
      default_company_id: editMode === "single_business" && editCompanyId ? editCompanyId : null,
    }, {
      onSuccess: () => setEditingAccount(null),
    });
  };

  const handleBulkApply = () => {
    if (!editingAccount || editMode !== "single_business" || !editCompanyId) return;
    const name = getCompanyName(editCompanyId);
    if (!name) return;
    bulkApplyMutation.mutate({ accountId: editingAccount.id, companyName: name });
  };

  // ── Refresh All: sync every healthy Plaid item for this user ──
  const [refreshingAll, setRefreshingAll] = useState(false);
  const handleRefreshAll = async () => {
    const healthy = (plaidItems as any[]).filter((it) => !isNeedsReauth(it));
    if (healthy.length === 0) {
      toast.info("No healthy accounts to refresh");
      return;
    }
    setRefreshingAll(true);
    toast.message(`Refreshing ${healthy.length} account${healthy.length === 1 ? "" : "s"}…`);
    let ok = 0;
    let failed = 0;
    await Promise.all(
      healthy.map(async (it) => {
        try {
          await syncMutation.mutateAsync(it.id);
          ok++;
        } catch {
          failed++;
        }
      })
    );
    setRefreshingAll(false);
    if (failed === 0) toast.success("Refresh complete");
    else toast.warning(`Refreshed ${ok}, ${failed} failed`);
  };

  // ── Auto-refresh on mount: trigger a background sync for healthy items ──
  useEffect(() => {
    if (isLoading) return;
    const healthy = (plaidItems as any[]).filter((it) => !isNeedsReauth(it));
    if (healthy.length === 0) return;
    // Fire one combined sync (server iterates all of the user's active items)
    syncMutation.mutate(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  // ── Reconnect via Plaid update mode ──
  const handleReconnect = async (itemId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("plaid-create-link-token", {
        body: { item_id: itemId, update_mode: true },
      });
      if (error || !data?.link_token) {
        toast.error("Failed to start reconnect flow");
        return;
      }
      if (!(window as any).Plaid) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script");
          script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
          script.onload = () => resolve();
          script.onerror = () => reject(new Error("Failed to load Plaid"));
          document.head.appendChild(script);
        });
      }
      const handler = (window as any).Plaid.create({
        token: data.link_token,
        onSuccess: () => {
          toast.success("Connection restored");
          syncMutation.mutate(itemId);
        },
        onExit: () => {},
      });
      handler.open();
    } catch (err) {
      console.error(err);
      toast.error("Failed to open reconnect flow");
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto w-full min-w-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-foreground">Bank Connections</h3>
          {plaidItems.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">
              Last synced {formatRelative(mostRecentSync)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <Button onClick={handleConnectBank} disabled={linkLoading} className="gap-2">
            {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Connect Account
          </Button>
          {plaidItems.length > 0 && (
            <Button
              variant="outline"
              onClick={handleRefreshAll}
              disabled={refreshingAll || syncMutation.isPending}
              className="gap-2"
            >
              {refreshingAll || syncMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh All
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : plaidItems.length > 0 ? (
        <div className="space-y-4">
          {plaidItems.map((item) => {
            const accounts = plaidAccounts.filter((a) => a.plaid_item_id === item.id);
            return (
              <div key={item.id} className="rounded-xl border border-border bg-card p-5 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary">
                      <Landmark className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-card-foreground">{item.institution_name}</p>
                      <p className="text-xs text-muted-foreground">
                        Last synced: {formatDate(item.last_synced_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncMutation.mutate(item.id)}
                      disabled={syncMutation.isPending}
                      className="gap-1.5"
                    >
                      {syncMutation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      Refresh
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDisconnectItemId(item.id)}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      <Unplug className="h-3.5 w-3.5" />
                      Disconnect
                    </Button>
                  </div>
                </div>

                {accounts.length > 0 && (
                  <div className="grid grid-cols-1 gap-3">
                    {accounts.map((acct) => {
                      const mode = (acct as any).account_business_mode || "unassigned";
                      const companyId = (acct as any).default_company_id || null;
                      return (
                        <div
                          key={acct.id}
                          className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-3"
                        >
                          <div className="text-muted-foreground">
                            {accountTypeIcon(acct.account_type)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-card-foreground truncate">
                              {acct.account_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {acct.account_type}{acct.account_subtype ? ` · ${acct.account_subtype}` : ""}
                              {acct.account_mask ? ` ···${acct.account_mask}` : ""}
                            </p>
                          </div>
                          <Badge variant={getModeColor(mode)} className="text-xs shrink-0">
                            {getModeLabel(mode, companyId)}
                          </Badge>
                          {acct.current_balance != null && (
                            <Badge variant="secondary" className="text-xs font-mono shrink-0">
                              ${Number(acct.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                            </Badge>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 shrink-0"
                            onClick={() => openEditDialog(acct)}
                          >
                            <Settings2 className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Landmark className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">
            Connect your bank accounts to automatically import transactions.
          </p>
          <Button onClick={handleConnectBank} disabled={linkLoading} className="mt-4 gap-2">
            {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Connect Your First Account
          </Button>
        </div>
      )}

      {/* Disconnect dialog */}
      <AlertDialog open={!!disconnectItemId} onOpenChange={() => setDisconnectItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Bank Account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the connection. Your previously imported transactions will be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (disconnectItemId) disconnectMutation.mutate(disconnectItemId);
                setDisconnectItemId(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit business affiliation dialog */}
      <Dialog open={!!editingAccount} onOpenChange={() => setEditingAccount(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Default Business Affiliation</DialogTitle>
            <DialogDescription>
              Choose a default business for this account if it is used primarily for one business. Leave unassigned or mark as shared if transactions may belong to multiple businesses.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Account Mode</label>
              <Select value={editMode} onValueChange={setEditMode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">None / Unassigned</SelectItem>
                  <SelectItem value="single_business">One Specific Business</SelectItem>
                  <SelectItem value="shared">Shared / Multiple Businesses</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editMode === "single_business" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Default Business</label>
                <Select value={editCompanyId} onValueChange={setEditCompanyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a business..." />
                  </SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {editMode === "single_business" && editCompanyId && (
              <div className="rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-2">
                  Optionally apply this business to existing unassigned imported transactions from this account.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkApply}
                  disabled={bulkApplyMutation.isPending}
                >
                  {bulkApplyMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : null}
                  Apply to Existing Transactions
                </Button>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingAccount(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSaveAffiliation}
              disabled={updateAccountMutation.isPending || (editMode === "single_business" && !editCompanyId)}
            >
              {updateAccountMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
