import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DbTransaction } from "@/hooks/useTransactions";
import { useCreateMatchGroup } from "@/hooks/useTransactionMatching";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  transactions: DbTransaction[];
  /** Optional: preselected ids (e.g. from a clicked suggestion). */
  initialManualIds?: string[];
  initialImportedIds?: string[];
  /** Optional: filter to a single transaction_type for cleaner UX. */
  transactionType?: "income" | "expense";
}

export default function MatchGroupBuilder({
  open,
  onOpenChange,
  transactions,
  initialManualIds = [],
  initialImportedIds = [],
  transactionType,
}: Props) {
  const [manualSel, setManualSel] = useState<Set<string>>(new Set(initialManualIds));
  const [importedSel, setImportedSel] = useState<Set<string>>(new Set(initialImportedIds));

  const create = useCreateMatchGroup();

  const { manualPool, importedPool } = useMemo(() => {
    const filtered = transactions.filter((t) => {
      if (t.match_status === "linked") return false;
      if (transactionType && (t.transaction_type || "expense") !== transactionType) return false;
      return true;
    });
    return {
      manualPool: filtered.filter((t) => t.source_type === "manual"),
      importedPool: filtered.filter((t) => t.source_type === "plaid"),
    };
  }, [transactions, transactionType]);

  const manualTotal = useMemo(
    () =>
      manualPool
        .filter((t) => manualSel.has(t.id))
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [manualPool, manualSel],
  );
  const importedTotal = useMemo(
    () =>
      importedPool
        .filter((t) => importedSel.has(t.id))
        .reduce((s, t) => s + Math.abs(t.amount), 0),
    [importedPool, importedSel],
  );
  const diff = manualTotal - importedTotal;
  const matches = Math.abs(diff) < 0.01;
  const totalCount = manualSel.size + importedSel.size;
  const canSave = totalCount >= 2 && !create.isPending;

  const toggle = (set: Set<string>, id: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const reset = () => {
    setManualSel(new Set());
    setImportedSel(new Set());
  };

  const handleSave = async () => {
    try {
      await create.mutateAsync({
        manualIds: Array.from(manualSel),
        importedIds: Array.from(importedSel),
      });
      reset();
      onOpenChange(false);
    } catch {
      /* toast handled in hook */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create matched group</DialogTitle>
          <DialogDescription>
            Select one or more manual entries and one or more imported transactions
            that represent the same real-world money movement.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
          <Column
            title="Manual entries"
            empty="No unmatched manual entries"
            items={manualPool}
            selected={manualSel}
            onToggle={(id) => toggle(manualSel, id, setManualSel)}
          />
          <Column
            title="Imported transactions"
            empty="No unmatched imported transactions"
            items={importedPool}
            selected={importedSel}
            onToggle={(id) => toggle(importedSel, id, setImportedSel)}
          />
        </div>

        <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              <span className="text-muted-foreground">Manual:</span>{" "}
              <strong>{fmt(manualTotal)}</strong>{" "}
              <span className="text-muted-foreground">({manualSel.size})</span>
            </span>
            <span>
              <span className="text-muted-foreground">Imported:</span>{" "}
              <strong>{fmt(importedTotal)}</strong>{" "}
              <span className="text-muted-foreground">({importedSel.size})</span>
            </span>
            <span>
              <span className="text-muted-foreground">Difference:</span>{" "}
              <strong className={cn(matches ? "text-emerald-600" : "text-amber-600")}>
                {fmt(diff)}
              </strong>
            </span>
          </div>
          {totalCount >= 2 ? (
            matches ? (
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                <span>Totals match.</span>
              </div>
            ) : (
              <div className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  The manual total and imported total do not match. You can still link
                  these if they represent the same real-world transaction.
                </span>
              </div>
            )
          ) : (
            <p className="text-muted-foreground text-xs">
              Select at least 2 transactions across the two columns to create a group.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave} className="gap-2">
            <Link2 className="h-4 w-4" />
            Create matched group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Column({
  title,
  empty,
  items,
  selected,
  onToggle,
}: {
  title: string;
  empty: string;
  items: DbTransaction[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-col min-h-0 border rounded-lg">
      <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <Badge variant="secondary" className="text-xs">{selected.size} selected</Badge>
      </div>
      <ScrollArea className="h-[44vh] md:h-[50vh]">
        {items.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {items.map((t) => {
              const isSel = selected.has(t.id);
              return (
                <li key={t.id}>
                  <label
                    className={cn(
                      "flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/40 transition-colors",
                      isSel && "bg-primary/5",
                    )}
                  >
                    <Checkbox
                      checked={isSel}
                      onCheckedChange={() => onToggle(t.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between gap-2">
                        <p className="text-sm font-medium truncate">{t.vendor || "—"}</p>
                        <p className="text-sm font-medium tabular-nums">{fmt(Math.abs(t.amount))}</p>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {t.transaction_date}
                        {t.entity && t.entity !== "Unassigned" ? ` · ${t.entity}` : ""}
                        {t.account_source ? ` · ${t.account_source}` : ""}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
