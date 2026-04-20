import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import { useOrphanIncomeEntries, useDeleteOrphanIncomeEntries } from "@/hooks/useOrphanCleanup";

/**
 * Surface and one-click cleanup for orphaned `income_entries`.
 *
 * Why this exists: The Tax Overview filters orphans out at read time, so
 * the user sees consistent numbers — but the orphan rows still sit in the
 * database. Surfacing + deleting them here keeps the DB tidy and prevents
 * confusion if anyone ever inspects raw tables.
 */
export function OrphanIncomeCleanupCard() {
  const { data: orphans, isLoading } = useOrphanIncomeEntries();
  const cleanup = useDeleteOrphanIncomeEntries();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking for orphaned income entries…
        </CardContent>
      </Card>
    );
  }

  const count = orphans?.length ?? 0;
  if (count === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Orphaned income entries</CardTitle>
          <CardDescription>No orphaned income entries — Tax Overview and Business Ledger agree.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const total = orphans!.reduce((s, o) => s + Number(o.paycheck_amount || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Orphaned income entries ({count})
        </CardTitle>
        <CardDescription>
          These rows reference transactions that no longer exist. They are already excluded from Tax
          Overview totals, but you can delete them to keep the database tidy.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1 max-h-40 overflow-auto">
          {orphans!.slice(0, 10).map((o) => (
            <div key={o.id} className="flex justify-between gap-2">
              <span className="truncate">{o.company || "—"} · {o.income_date}</span>
              <span className="tabular-nums">${Number(o.paycheck_amount).toFixed(2)}</span>
            </div>
          ))}
          {count > 10 && <div className="text-muted-foreground pt-1">…and {count - 10} more</div>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            Total: ${total.toFixed(2)}
          </span>
          <Button
            size="sm"
            variant="destructive"
            disabled={cleanup.isPending}
            onClick={() => cleanup.mutate()}
          >
            {cleanup.isPending ? "Removing…" : `Remove ${count} orphan${count === 1 ? "" : "s"}`}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
