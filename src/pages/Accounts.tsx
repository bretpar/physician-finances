import { useState, useEffect, useCallback } from "react";
import { Landmark, CreditCard, PiggyBank, Plus, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PlaidItem {
  id: string;
  institution_name: string;
  created_at: string;
}

export default function Accounts() {
  const [plaidItems, setPlaidItems] = useState<PlaidItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);

  const fetchPlaidItems = useCallback(async () => {
    const { data } = await supabase
      .from("plaid_items")
      .select("id, institution_name, created_at")
      .order("created_at", { ascending: false });
    if (data) setPlaidItems(data);
  }, []);

  useEffect(() => {
    fetchPlaidItems();
  }, [fetchPlaidItems]);

  const handleConnectBank = async () => {
    setLinkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-create-link-token");
      if (error || !data?.link_token) {
        toast.error("Failed to initialize bank connection");
        return;
      }

      // Load Plaid Link script dynamically
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
          setLoading(true);
          const { error: exchangeError } = await supabase.functions.invoke("plaid-exchange-token", {
            body: {
              public_token: publicToken,
              institution_name: metadata?.institution?.name || "Bank Account",
            },
          });
          if (exchangeError) {
            toast.error("Failed to connect account");
          } else {
            toast.success("Bank account connected!");
            await fetchPlaidItems();
            handleSyncTransactions();
          }
          setLoading(false);
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

  const handleSyncTransactions = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke("plaid-sync-transactions");
      if (error) {
        toast.error("Failed to sync transactions");
      } else {
        toast.success(`Synced ${data?.transactions_added || 0} new transactions`);
      }
    } catch {
      toast.error("Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-foreground">Linked Accounts</h3>
        <div className="flex gap-2">
          {plaidItems.length > 0 && (
            <Button variant="outline" onClick={handleSyncTransactions} disabled={syncing} className="gap-2">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Sync Transactions
            </Button>
          )}
          <Button onClick={handleConnectBank} disabled={linkLoading || loading} className="gap-2">
            {linkLoading || loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Connect Bank Account
          </Button>
        </div>
      </div>

      {plaidItems.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {plaidItems.map((item) => (
            <div key={item.id} className="stat-card flex items-start gap-4">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-primary shrink-0">
                <Landmark className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-card-foreground">{item.institution_name}</p>
                <p className="text-xs text-muted-foreground">
                  Connected {new Date(item.created_at).toLocaleDateString()}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card rounded-xl p-8 text-center">
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
    </div>
  );
}
