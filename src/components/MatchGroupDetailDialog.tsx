import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, X, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";
import type { DbTransaction } from "@/hooks/useTransactions";
import { supabase } from "@/integrations/supabase/client";
import {
  useMatchGroups,
  useUnlinkMatchGroup,
  useUnlinkMatchGroupItem,
} from "@/hooks/useTransactionMatching";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string | null;
  /** All transactions (active + merged) — used to render group members. */
  allTransactions: DbTransaction[];
}

export default function MatchGroupDetailDialog({
  open,
  onOpenChange,
  groupId,
  allTransactions,
}: Props) {
  const { data: groups } = useMatchGroups();
  const unlinkAll = useUnlinkMatchGroup();
  const unlinkOne = useUnlinkMatchGroupItem();

  const group = useMemo(
    () => (groups || []).find((g: any) => g.id === groupId),
    [groups, groupId],
  );

  const txById = useMemo(() => {
    const m = new Map<string, DbTransaction>();
    allTransactions.forEach((t) => m.set(t.id, t));
    return m;
  }, [allTransactions]);

  const items = (group as any)?.items || [];
  const manualItems = items.filter((i: any) => i.transaction_source === "manual");
  const importedItems = items.filter((i: any) => i.transaction_source === "imported");
  const matches = group ? Math.abs(Number(group.difference)) < 0.01 : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Matched group</DialogTitle>
          <DialogDescription>
            {items.length} item{items.length === 1 ? "" : "s"} linked together.
          </DialogDescription>
        </DialogHeader>

        {!group ? (
          <p className="text-sm text-muted-foreground py-6">Group not found.</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <span><span className="text-muted-foreground">Manual:</span> <strong>{fmt(Number(group.manual_total))}</strong> ({manualItems.length})</span>
                <span><span className="text-muted-foreground">Imported:</span> <strong>{fmt(Number(group.imported_total))}</strong> ({importedItems.length})</span>
                <span>
                  <span className="text-muted-foreground">Diff:</span>{" "}
                  <strong className={cn(matches ? "text-emerald-600" : "text-amber-600")}>
                    {fmt(Number(group.difference))}
                  </strong>
                </span>
              </div>
              {matches ? (
                <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Totals match
                </div>
              ) : (
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5" /> Totals don't match
                </div>
              )}
            </div>

            <Section
              title="Manual"
              items={manualItems}
              txById={txById}
              onUnlink={(txId) =>
                unlinkOne.mutate({ groupId: group.id, transactionId: txId })
              }
            />
            <Section
              title="Imported"
              items={importedItems}
              txById={txById}
              onUnlink={(txId) =>
                unlinkOne.mutate({ groupId: group.id, transactionId: txId })
              }
            />
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          {group && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={async () => {
                await unlinkAll.mutateAsync(group.id);
                onOpenChange(false);
              }}
              disabled={unlinkAll.isPending}
            >
              <Unlink className="h-4 w-4" />
              Unlink entire group
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  title,
  items,
  txById,
  onUnlink,
}: {
  title: string;
  items: any[];
  txById: Map<string, DbTransaction>;
  onUnlink: (txId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
        <Badge variant="secondary" className="text-xs">{items.length}</Badge>
      </div>
      <ul className="divide-y border rounded-lg">
        {items.map((it) => {
          const t = txById.get(it.transaction_id);
          return (
            <li key={it.id} className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{t?.vendor || "—"}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {t?.transaction_date}
                  {t?.entity && t.entity !== "Unassigned" ? ` · ${t.entity}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium tabular-nums">
                  {t ? fmt(Math.abs(t.amount)) : "—"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onUnlink(it.transaction_id)}
                  title="Remove from group"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
