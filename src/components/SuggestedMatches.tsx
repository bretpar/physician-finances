import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link2, X, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type { SuggestedMatch } from "@/hooks/useTransactionMatching";
import { useLinkTransactions, useIgnoreMatch } from "@/hooks/useTransactionMatching";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  suggestions: SuggestedMatch[];
}

export default function SuggestedMatches({ suggestions }: Props) {
  const [expanded, setExpanded] = useState(true);
  const linkMutation = useLinkTransactions();
  const ignoreMutation = useIgnoreMatch();

  if (suggestions.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20 p-4 space-y-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-amber-600" />
          <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
            {suggestions.length} Suggested match{suggestions.length > 1 ? "es" : ""}
          </span>
          <Badge variant="secondary" className="text-xs">Review needed</Badge>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-amber-600" />
        ) : (
          <ChevronDown className="h-4 w-4 text-amber-600" />
        )}
      </button>

      {expanded && (
        <div className="space-y-3">
          {suggestions.map((s, i) => {
            // For income rows the manual amount is GROSS; the Plaid amount is the
            // net deposit. A divergence >5% from the manual gross is worth flagging
            // even when the suggestion is otherwise plausible — the user should
            // confirm before we create a stored link.
            const isIncome = (s.manualTx.transaction_type || "expense") === "income";
            const manualAmt = Math.abs(s.manualTx.amount);
            const plaidAmt = Math.abs(s.plaidTx.amount);
            const rel = manualAmt > 0 ? Math.abs(plaidAmt - manualAmt) / manualAmt : 0;
            const showDiscrepancy = rel > 0.05;

            return (
              <Card key={i} className="p-3 space-y-2">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">
                      {isIncome ? "Planned (gross)" : "Manual entry"}
                    </p>
                    <p className="text-sm font-medium">{s.manualTx.vendor}</p>
                    <p>{fmt(s.manualTx.amount)} · {s.manualTx.transaction_date}</p>
                    {s.manualTx.entity !== "Unassigned" && (
                      <p className="text-muted-foreground">{s.manualTx.entity}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">
                      {isIncome ? "Imported deposit (net)" : "Imported"}
                    </p>
                    <p className="text-sm font-medium">{s.plaidTx.vendor}</p>
                    <p>{fmt(s.plaidTx.amount)} · {s.plaidTx.transaction_date}</p>
                    {s.plaidTx.account_source && (
                      <p className="text-muted-foreground">{s.plaidTx.account_source}</p>
                    )}
                  </div>
                </div>
                {showDiscrepancy && isIncome && (
                  <div className="rounded-md border border-amber-300 bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                    Deposit differs from planned net amount. Confirming will keep
                    the planned gross and tax details and just record the net
                    received.
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        s.confidenceLabel === "Strong match"
                          ? "border-emerald-400 text-emerald-700 dark:text-emerald-400"
                          : s.confidenceLabel === "Possible match"
                            ? "border-amber-400 text-amber-700 dark:text-amber-400"
                            : "border-muted text-muted-foreground"
                      }`}
                    >
                      {s.confidenceLabel}
                    </Badge>
                    {s.reasons.map((r, j) => (
                      <span key={j} className="text-xs text-muted-foreground">{r}</span>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        ignoreMutation.mutate({
                          manualTxId: s.manualTx.id,
                          plaidTxId: s.plaidTx.id,
                        })
                      }
                      disabled={ignoreMutation.isPending}
                      className="text-xs gap-1"
                    >
                      <X className="h-3 w-3" /> Dismiss
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        linkMutation.mutate({
                          manualTxId: s.manualTx.id,
                          plaidTxId: s.plaidTx.id,
                          confidence: s.confidence,
                        })
                      }
                      disabled={linkMutation.isPending}
                      className="text-xs gap-1"
                    >
                      <Link2 className="h-3 w-3" /> Confirm match
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
