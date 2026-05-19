import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/localDate";

/**
 * Lists Plaid transactions the user previously deleted (tombstoned).
 * Restoring a tombstone allows the next Plaid sync to re-import that
 * transaction. The plaid_transactions raw row is preserved on delete, so the
 * imported data is still available — we just stop blocking it.
 */
interface TombstoneRow {
  id: string;
  plaid_transaction_id: string;
  deleted_at: string;
  reason: string | null;
  // Joined from plaid_transactions (raw cache) when available
  name?: string | null;
  amount?: number | null;
  date?: string | null;
}

function useTombstones() {
  return useQuery({
    queryKey: ["plaid-tombstones"],
    queryFn: async (): Promise<TombstoneRow[]> => {
      const { data, error } = await supabase
        .from("plaid_deleted_tombstones")
        .select("id, plaid_transaction_id, deleted_at, reason")
        .order("deleted_at", { ascending: false });
      if (error) throw error;
      const tombs = (data || []) as TombstoneRow[];
      if (tombs.length === 0) return [];

      // Best-effort enrich with the cached plaid_transactions row so the user
      // sees what they're about to restore.
      const ids = tombs.map((t) => t.plaid_transaction_id);
      const { data: ptx } = await supabase
        .from("plaid_transactions")
        .select("plaid_transaction_id, name, amount, date")
        .in("plaid_transaction_id", ids);
      const map = new Map(
        (ptx || []).map((p: any) => [p.plaid_transaction_id, p]),
      );
      return tombs.map((t) => ({
        ...t,
        name: map.get(t.plaid_transaction_id)?.name ?? null,
        amount: map.get(t.plaid_transaction_id)?.amount ?? null,
        date: map.get(t.plaid_transaction_id)?.date ?? null,
      }));
    },
  });
}

function useRestoreTombstones() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return 0;
      const { error } = await supabase
        .from("plaid_deleted_tombstones")
        .delete()
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["plaid-tombstones"] });
      toast.success(
        `Restored ${count} transaction${count === 1 ? "" : "s"}. Run a Plaid sync to re-import.`,
      );
    },
    onError: (e) => toast.error((e as Error).message),
  });
}

const fmt = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export function RestoreTombstonesCard() {
  const { data: rows = [], isLoading } = useTombstones();
  const restore = useRestoreTombstones();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)),
    );
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              Restore deleted Plaid transactions
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Imported transactions you deleted are blocked from re-importing on the next sync.
              Restore one to allow it back in.
            </p>
          </div>
          {rows.length > 0 && (
            <Button
              size="sm"
              variant="default"
              disabled={selected.size === 0 || restore.isPending}
              onClick={() => {
                restore.mutate([...selected]);
                setSelected(new Set());
              }}
            >
              {restore.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Restore selected ({selected.size})
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            No deleted Plaid transactions. You're all clear.
          </div>
        ) : (
          <div className="border border-border rounded-md overflow-hidden">
            <div className="flex items-center gap-3 px-3 py-2 bg-muted/40 border-b border-border text-xs font-medium text-muted-foreground">
              <Checkbox
                checked={selected.size === rows.length && rows.length > 0}
                onCheckedChange={toggleAll}
              />
              <span className="flex-1">Transaction</span>
              <span className="w-20 text-right">Amount</span>
              <span className="w-24">Deleted</span>
            </div>
            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {rows.map((r) => (
                <label
                  key={r.id}
                  className="flex items-center gap-3 px-3 py-2 text-xs hover:bg-muted/30 cursor-pointer"
                >
                  <Checkbox
                    checked={selected.has(r.id)}
                    onCheckedChange={() => toggle(r.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {r.name || (
                        <span className="text-muted-foreground italic">
                          Plaid id {r.plaid_transaction_id.slice(0, 12)}…
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground flex items-center gap-2">
                      {r.date && <span>{r.date}</span>}
                      {r.reason && (
                        <Badge variant="outline" className="h-4 text-[10px] px-1">
                          {r.reason}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <span className="w-20 text-right font-mono">{fmt(r.amount)}</span>
                  <span className="w-24 text-muted-foreground">
                    {formatDate(r.deleted_at)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
