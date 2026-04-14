import { useState, useCallback } from "react";
import { Landmark, Plus, RefreshCw, Loader2, Unplug, CreditCard, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  usePlaidItems,
  usePlaidAccounts,
  useSyncTransactions,
  useDisconnectPlaidItem,
} from "@/hooks/usePlaid";
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

export default function Accounts() {
  const { data: plaidItems = [], isLoading } = usePlaidItems();
  const { data: plaidAccounts = [] } = usePlaidAccounts();
  const syncMutation = useSyncTransactions();
  const disconnectMutation = useDisconnectPlaidItem();

  const [linkLoading, setLinkLoading] = useState(false);
  const [disconnectItemId, setDisconnectItemId] = useState<string | null>(null);

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

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Bank Connections</h3>
        <Button onClick={handleConnectBank} disabled={linkLoading} className="gap-2">
          {linkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Connect Bank Account
        </Button>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {accounts.map((acct) => (
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
                        {acct.current_balance != null && (
                          <Badge variant="secondary" className="text-xs font-mono">
                            ${Number(acct.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                          </Badge>
                        )}
                      </div>
                    ))}
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
    </div>
  );
}
