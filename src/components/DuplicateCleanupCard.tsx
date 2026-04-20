import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useDuplicateScan, useDeleteDuplicates } from "@/hooks/useDuplicateCleanup";

export function DuplicateCleanupCard() {
  const { data: groups = [], isLoading, refetch, isFetching } = useDuplicateScan();
  const removeMutation = useDeleteDuplicates();
  const [confirming, setConfirming] = useState(false);

  const totalToRemove = groups.reduce((s, g) => s + g.removeIds.length, 0);
  const plaidGroups = groups.filter((g) => g.kind === "plaid");
  const manualGroups = groups.filter((g) => g.kind === "manual");

  const handleCleanup = async () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const allRemove = groups.flatMap((g) => g.removeIds);
    await removeMutation.mutateAsync(allRemove);
    setConfirming(false);
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Duplicate Transactions
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Finds rows that share the same imported source, or same date / amount / vendor / type.
              Cleanup keeps the newest row in each group and removes the rest.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            <span className="ml-1 text-xs">Rescan</span>
          </Button>
        </div>

        {isLoading ? (
          <div className="text-xs text-muted-foreground">Scanning…</div>
        ) : groups.length === 0 ? (
          <div className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" /> No duplicate transactions detected.
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                {groups.length} duplicate group{groups.length === 1 ? "" : "s"}
              </Badge>
              <Badge variant="destructive">{totalToRemove} row{totalToRemove === 1 ? "" : "s"} to remove</Badge>
              {plaidGroups.length > 0 && <Badge variant="outline">{plaidGroups.length} imported</Badge>}
              {manualGroups.length > 0 && <Badge variant="outline">{manualGroups.length} manual</Badge>}
            </div>

            <div className="rounded border border-border max-h-64 overflow-auto divide-y divide-border">
              {groups.slice(0, 50).map((g) => (
                <div key={g.key} className="p-2 text-xs flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground truncate">
                      {g.sample.vendor || "(no vendor)"} · ${g.sample.amount.toFixed(2)}
                    </div>
                    <div className="text-muted-foreground">
                      {g.sample.transaction_date} · {g.kind} · {g.ids.length} copies → keep newest
                    </div>
                  </div>
                  <Badge variant="destructive" className="shrink-0">−{g.removeIds.length}</Badge>
                </div>
              ))}
              {groups.length > 50 && (
                <div className="p-2 text-xs text-muted-foreground">…and {groups.length - 50} more groups</div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={confirming ? "destructive" : "default"}
                size="sm"
                onClick={handleCleanup}
                disabled={removeMutation.isPending}
              >
                {removeMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                ) : (
                  <Trash2 className="h-3 w-3 mr-1" />
                )}
                {confirming ? `Confirm removal of ${totalToRemove} rows` : "Clean up duplicates"}
              </Button>
              {confirming && (
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
