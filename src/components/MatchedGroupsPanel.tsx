import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Layers, ChevronRight } from "lucide-react";
import { useMatchGroups } from "@/hooks/useTransactionMatching";
import MatchGroupDetailDialog from "./MatchGroupDetailDialog";
import type { DbTransaction } from "@/hooks/useTransactions";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  allTransactions: DbTransaction[];
}

export default function MatchedGroupsPanel({ allTransactions }: Props) {
  const { data: groups = [] } = useMatchGroups();
  const [openId, setOpenId] = useState<string | null>(null);

  if (!groups || groups.length === 0) return null;

  return (
    <>
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Matched groups</h2>
          <Badge variant="secondary" className="text-xs">{groups.length}</Badge>
        </div>
        <ul className="divide-y border rounded-lg">
          {groups.map((g: any) => {
            const matches = Math.abs(Number(g.difference)) < 0.01;
            const manualCount = (g.items || []).filter((i: any) => i.transaction_source === "manual").length;
            const importedCount = (g.items || []).filter((i: any) => i.transaction_source === "imported").length;
            return (
              <li key={g.id}>
                <button
                  onClick={() => setOpenId(g.id)}
                  className="w-full flex items-center justify-between gap-3 p-3 hover:bg-muted/40 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {manualCount} manual · {importedCount} imported
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Manual {fmt(Number(g.manual_total))} · Imported {fmt(Number(g.imported_total))}
                    </p>
                  </div>
                  <span
                    className={
                      matches
                        ? "text-xs text-emerald-700 dark:text-emerald-400"
                        : "text-xs text-amber-700 dark:text-amber-400"
                    }
                  >
                    {matches ? "Matched" : `Diff ${fmt(Number(g.difference))}`}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <MatchGroupDetailDialog
        open={!!openId}
        onOpenChange={(o) => !o && setOpenId(null)}
        groupId={openId}
        allTransactions={allTransactions}
      />
    </>
  );
}
