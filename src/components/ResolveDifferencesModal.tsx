import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Link2 } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type {
  ConflictChoice,
  ConflictResolution,
  FieldConflict,
} from "@/lib/linkMergeEngine";
import { hasLargeAmountDiff } from "@/lib/linkMergeEngine";
import { formatDateShort } from "@/lib/localDate";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conflicts: FieldConflict[];
  /** Used for the large-diff banner: total amount from each side. */
  currentAmount?: number | null;
  importedAmount?: number | null;
  onConfirm: (resolutions: ConflictResolution[]) => void;
  isSubmitting?: boolean;
}

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function displayValue(kind: FieldConflict["kind"], v: string | number | null): string {
  if (v === null || v === undefined || v === "") return "—";
  if (kind === "money") return fmtMoney(Number(v) || 0);
  if (kind === "date") return formatDateShort(String(v));
  return String(v);
}

interface RowState {
  choice: ConflictChoice;
  custom: string;
}

export function ResolveDifferencesModal({
  open,
  onOpenChange,
  conflicts,
  currentAmount,
  importedAmount,
  onConfirm,
  isSubmitting,
}: Props) {
  const [state, setState] = useState<Record<string, RowState>>({});

  useEffect(() => {
    if (!open) return;
    const initial: Record<string, RowState> = {};
    for (const c of conflicts) initial[c.key] = { choice: c.defaultChoice, custom: "" };
    setState(initial);
  }, [open, conflicts]);

  const showBanner = useMemo(
    () => hasLargeAmountDiff(currentAmount, importedAmount),
    [currentAmount, importedAmount],
  );

  const handleConfirm = () => {
    const resolutions: ConflictResolution[] = conflicts.map((c) => {
      const row = state[c.key] || { choice: c.defaultChoice, custom: "" };
      if (row.choice === "custom") {
        const raw = row.custom;
        const value =
          c.kind === "money"
            ? Number(String(raw).replace(/[^0-9.\-]/g, "")) || 0
            : raw;
        return { key: c.key, choice: "custom", customValue: value };
      }
      return { key: c.key, choice: row.choice };
    });
    onConfirm(resolutions);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" /> Resolve Transaction Differences
          </DialogTitle>
          <DialogDescription>
            We found differences between these two records. Review them before linking.
          </DialogDescription>
        </DialogHeader>

        {showBanner && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              This imported transaction differs significantly from your income entry.
              This may represent a partial payment, split deposit, reimbursement, or an
              incorrect match.
            </span>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Field</th>
                <th className="px-3 py-2 text-left font-medium">Current Income Entry</th>
                <th className="px-3 py-2 text-left font-medium">Imported Bank Transaction</th>
                <th className="px-3 py-2 text-left font-medium w-[220px]">Use</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {conflicts.map((c) => {
                const row = state[c.key] || { choice: c.defaultChoice, custom: "" };
                return (
                  <tr key={c.key}>
                    <td className="px-3 py-2 font-medium">{c.label}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayValue(c.kind, c.currentValue)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {displayValue(c.kind, c.importedValue)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1.5">
                        <Select
                          value={row.choice}
                          onValueChange={(v) =>
                            setState((s) => ({
                              ...s,
                              [c.key]: { ...row, choice: v as ConflictChoice },
                            }))
                          }
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="current">Keep Current Income Entry</SelectItem>
                            <SelectItem value="imported">Use Imported Transaction</SelectItem>
                            {c.allowCustom && (
                              <SelectItem value="custom">Enter Custom Value</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {row.choice === "custom" && (
                          <Input
                            className="h-8 text-xs"
                            placeholder={c.kind === "money" ? "0.00" : "Enter value"}
                            value={row.custom}
                            onChange={(e) =>
                              setState((s) => ({
                                ...s,
                                [c.key]: { ...row, custom: e.target.value },
                              }))
                            }
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isSubmitting} className="gap-1.5">
            <Link2 className="h-4 w-4" /> Link Transactions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
