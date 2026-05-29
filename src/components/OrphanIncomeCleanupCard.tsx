import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, AlertTriangle } from "lucide-react";
import {
  useOrphanIncomeEntries,
  useDeleteOrphanIncomeEntries,
  useOrphanPlannerEntries,
  useDeleteOrphanPlannerEntries,
} from "@/hooks/useOrphanCleanup";

/**
 * Surface and one-click cleanup for orphaned `income_entries`.
 *
 * Two flavors of orphans:
 * 1. Rows whose linked_transaction_id points at a deleted transaction.
 * 2. Planner-created rows ("From planner") whose origin_planner_conversion_id
 *    is null or dangling — these used to be left behind when a projected
 *    stream/bonus was deleted (FK SET NULL on cascade).
 *
 * Tax Overview filters orphans out at read time, so user-facing totals stay
 * consistent — but cleaning up the DB rows prevents confusion when anyone
 * inspects raw data and avoids planner-converted false income lingering.
 */
export function OrphanIncomeCleanupCard() {
  const { data: orphans, isLoading } = useOrphanIncomeEntries();
  const cleanup = useDeleteOrphanIncomeEntries();
  const { data: plannerOrphans, isLoading: plannerLoading } = useOrphanPlannerEntries();
  const plannerCleanup = useDeleteOrphanPlannerEntries();

  if (isLoading || plannerLoading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking for orphaned income entries…
        </CardContent>
      </Card>
    );
  }

  const count = orphans?.length ?? 0;
  const plannerCount = plannerOrphans?.length ?? 0;

  if (count === 0 && plannerCount === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Orphaned income entries</CardTitle>
          <CardDescription>No orphaned income entries — Tax Overview and Business Ledger agree.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const total = (orphans || []).reduce((s, o) => s + Number(o.paycheck_amount || 0), 0);
  const plannerTotal = (plannerOrphans || []).reduce((s, o) => s + Number(o.paycheck_amount || 0), 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          Orphaned income entries ({count + plannerCount})
        </CardTitle>
        <CardDescription>
          These rows reference deleted transactions or deleted planner occurrences. They are
          already excluded from Tax Overview totals, but you can remove them to keep the database
          tidy and prevent stale "From planner" rows from resurfacing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {count > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              Linked to deleted transactions ({count})
            </div>
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
          </div>
        )}

        {plannerCount > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">
              From deleted planner occurrences ({plannerCount})
            </div>
            <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-1 max-h-40 overflow-auto">
              {plannerOrphans!.slice(0, 10).map((o) => (
                <div key={o.id} className="flex justify-between gap-2">
                  <span className="truncate">{o.company || "—"} · {o.income_date}</span>
                  <span className="tabular-nums">${Number(o.paycheck_amount).toFixed(2)}</span>
                </div>
              ))}
              {plannerCount > 10 && (
                <div className="text-muted-foreground pt-1">…and {plannerCount - 10} more</div>
              )}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground tabular-nums">
                Total: ${plannerTotal.toFixed(2)}
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={plannerCleanup.isPending}
                onClick={() => plannerCleanup.mutate(plannerOrphans!.map((o) => o.id))}
              >
                {plannerCleanup.isPending
                  ? "Removing…"
                  : `Remove ${plannerCount} planner orphan${plannerCount === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
