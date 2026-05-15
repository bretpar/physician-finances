import { useMemo } from "react";
import { useYtdCatchupEntries, useDeleteYtdCatchup, type YtdCatchupEntry } from "@/hooks/useYtdCatchup";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";

const fmt = (n: number) => `$${(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

interface Props {
  onEdit?: (entry: YtdCatchupEntry) => void;
  editingId?: string | null;
  defaultOpen?: boolean;
}

export function YtdCatchupRecap({ onEdit, editingId, defaultOpen }: Props = {}) {
  const { data: entries = [] } = useYtdCatchupEntries();
  const del = useDeleteYtdCatchup();
  const taxYear = new Date().getFullYear();

  const rows = useMemo(() => entries.filter((e) => e.tax_year === taxYear), [entries, taxYear]);

  const groups = useMemo(() => {
    const buckets: Record<string, { label: string; gross: number; fed: number; state: number; count: number }> = {};
    for (const e of rows) {
      const key = e.source_type;
      const label = key === "w2" ? "W-2 income" : key === "1099_k1" ? "1099 / K-1 income" : "Other income";
      if (!buckets[key]) buckets[key] = { label, gross: 0, fed: 0, state: 0, count: 0 };
      buckets[key].gross += Number(e.gross_income) || 0;
      buckets[key].fed += Number(e.federal_withholding) || 0;
      buckets[key].state += Number(e.state_withholding) || 0;
      buckets[key].count += 1;
    }
    return Object.values(buckets);
  }, [rows]);

  if (rows.length === 0) return null;

  const totalGross = groups.reduce((s, g) => s + g.gross, 0);
  const totalFed = groups.reduce((s, g) => s + g.fed, 0);
  const totalState = groups.reduce((s, g) => s + g.state, 0);

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">YTD recap</h3>
        <span className="text-xs text-muted-foreground">{rows.length} {rows.length === 1 ? "entry" : "entries"} saved</span>
      </div>

      <div className="space-y-2">
        {groups.map((g) => (
          <div key={g.label} className="rounded-lg bg-card border border-border p-3">
            <div className="flex items-center justify-between text-sm font-medium text-card-foreground">
              <span>{g.label}</span>
              <span>{fmt(g.gross)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <span>{g.count} {g.count === 1 ? "source" : "sources"}</span>
              <span>Federal: {fmt(g.fed)}</span>
              <span>State: {fmt(g.state)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border pt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="font-semibold text-foreground">Total gross: {fmt(totalGross)}</span>
        <span className="text-muted-foreground">Federal: {fmt(totalFed)}</span>
        <span className="text-muted-foreground">State: {fmt(totalState)}</span>
      </div>

      <details className="text-xs" open={defaultOpen || !!editingId || undefined}>
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Review individual entries</summary>
        <ul className="mt-2 space-y-1">
          {rows.map((e) => {
            const isEditing = editingId === e.id;
            return (
              <li key={e.id} className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 ${isEditing ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                <div className="min-w-0">
                  <p className="truncate text-card-foreground">{e.company_name}{isEditing && <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">Editing</span>}</p>
                  <p className="truncate text-muted-foreground">{e.period_start} → {e.period_end} · {fmt(Number(e.gross_income) || 0)}</p>
                </div>
                <div className="flex items-center gap-1">
                  {onEdit && (
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onEdit(e)} disabled={del.isPending} aria-label={`Edit ${e.company_name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => del.mutate(e.id)} disabled={del.isPending} aria-label={`Delete ${e.company_name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      </details>
    </div>
  );
}
