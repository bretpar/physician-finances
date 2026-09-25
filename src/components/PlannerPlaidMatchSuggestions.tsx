import { useMemo, useState } from "react";
import { Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { PersonalIncomeEntry } from "@/hooks/usePersonalIncome";
import {
  isImportedCashIncomeRow,
  useCreateIncomeMatchGroup,
  useSuggestedIncomeLinkCandidates,
} from "@/hooks/useIncomeMatching";
import { formatDateShort } from "@/lib/localDate";
import { supabase } from "@/integrations/supabase/client";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const DISMISS_KEY = "pi_match_suggestion_dismissed";
const loadDismissed = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); } catch { return new Set(); }
};

interface Props {
  entries: PersonalIncomeEntry[];
  linkedEntryIds: Set<string>;
}

/**
 * Suggests (never auto-applies) links between unlinked planner-converted
 * paychecks and unlinked Plaid-imported deposits. The user must confirm.
 */
export function PlannerPlaidMatchSuggestions({ entries, linkedEntryIds }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed);
  const createLink = useCreateIncomeMatchGroup();

  const imported = useMemo(
    () => entries.filter((e) => isImportedCashIncomeRow(e as any) && !linkedEntryIds.has(e.id) && (e as any).status !== "merged"),
    [entries, linkedEntryIds],
  );
  const planners = useMemo(
    () => entries.filter((e) => (e as any).origin_type === "planner_converted" && !linkedEntryIds.has(e.id) && (e as any).status !== "merged"),
    [entries, linkedEntryIds],
  );

  const pairs = useMemo(() => {
    const out: { planner: PersonalIncomeEntry; bank: PersonalIncomeEntry; reason: string }[] = [];
    const usedBank = new Set<string>();
    for (const p of planners) {
      const cands = useSuggestedIncomeLinkCandidates(p, imported, linkedEntryIds)
        .filter((c) => !usedBank.has(c.entry.id) && !dismissed.has(`${p.id}:${c.entry.id}`));
      if (cands.length === 0) continue;
      // Ambiguous: two near-equal candidates → don't present as a match.
      if (cands.length > 1 && cands[0].score - cands[1].score < 5) continue;
      usedBank.add(cands[0].entry.id);
      out.push({ planner: p, bank: cands[0].entry, reason: cands[0].reason });
    }
    return out;
  }, [planners, imported, linkedEntryIds, dismissed]);

  if (pairs.length === 0) return null;

  const dismiss = (key: string) => {
    const next = new Set(dismissed); next.add(key);
    localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    setDismissed(next);
  };

  const confirm = (planner: PersonalIncomeEntry, bank: PersonalIncomeEntry) => {
    createLink.mutate(
      { entryIds: [planner.id, bank.id] },
      {
        onSuccess: async () => {
          try {
            await supabase
              .from("income_entries")
              .update({ needs_review: false, reviewed_at: new Date().toISOString() } as any)
              .in("id", [planner.id, bank.id]);
          } catch { /* non-fatal */ }
          toast.success("Income linked. This paycheck will only be counted once.");
        },
      },
    );
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="text-sm font-medium text-foreground">Possible matches</div>
      {pairs.map(({ planner, bank, reason }) => {
        const gross = Math.abs(Number(planner.gross_amount) || 0);
        const deposit = Math.abs(Number(bank.deposited_amount || bank.gross_amount) || 0);
        const key = `${planner.id}:${bank.id}`;
        return (
          <div key={key} className="rounded-md border border-border bg-card p-3 text-sm space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Planner</div>
                <div className="font-medium truncate">{planner.company || planner.name}</div>
                <div className="text-xs text-muted-foreground">{formatDateShort(planner.income_date)} · Gross {fmt(gross)}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Bank deposit</div>
                <div className="font-medium truncate">{bank.name || bank.company}</div>
                <div className="text-xs text-muted-foreground">{formatDateShort(bank.income_date)} · {fmt(deposit)}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Difference {fmt(Math.abs(gross - deposit))} · {reason}
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" className="h-8 text-xs gap-1" onClick={() => dismiss(key)}>
                <X className="h-3.5 w-3.5" /> Not a match
              </Button>
              <Button size="sm" className="h-8 text-xs gap-1" disabled={createLink.isPending} onClick={() => confirm(planner, bank)}>
                <Link2 className="h-3.5 w-3.5" /> Link
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
