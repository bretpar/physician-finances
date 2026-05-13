import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link2, X, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { useState } from "react";
import type { SuggestedMatch } from "@/hooks/useTransactionMatching";
import { useLinkTransactions, useIgnoreMatch } from "@/hooks/useTransactionMatching";
import MatchGroupBuilder from "./MatchGroupBuilder";
import type { DbTransaction } from "@/hooks/useTransactions";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  suggestions: SuggestedMatch[];
  /** All transactions feed used by the multi-select group builder. */
  transactions?: DbTransaction[];
}

export default function SuggestedMatches({ suggestions, transactions = [] }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [seedManual, setSeedManual] = useState<string[]>([]);
  const [seedImported, setSeedImported] = useState<string[]>([]);
  const linkMutation = useLinkTransactions();
  const ignoreMutation = useIgnoreMatch();

  const openBuilder = (manualIds: string[] = [], importedIds: string[] = []) => {
    setSeedManual(manualIds);
    setSeedImported(importedIds);
    setBuilderOpen(true);
  };

  return (
    <>
      <div className="rounded-xl border border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-2 text-left flex-1 min-w-0"
          >
            <Link2 className="h-4 w-4 text-amber-600 shrink-0" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-300">
              {suggestions.length === 0
                ? "No suggested matches"
                : `${suggestions.length} Suggested Match${suggestions.length > 1 ? "es" : ""}`}
            </span>
            {suggestions.length > 0 && (
              <Badge variant="secondary" className="text-xs">Review</Badge>
            )}
            <span className="ml-auto">
              {expanded ? (
                <ChevronUp className="h-4 w-4 text-amber-600" />
              ) : (
                <ChevronDown className="h-4 w-4 text-amber-600" />
              )}
            </span>
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openBuilder()}
            className="gap-2 shrink-0"
          >
            <Layers className="h-3.5 w-3.5" />
            Build matched group
          </Button>
        </div>

        {expanded && suggestions.length > 0 && (
          <div className="space-y-3">
            {suggestions.map((s, i) => (
              <Card key={i} className="p-3 space-y-2">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">Manual Entry</p>
                    <p className="text-sm font-medium">{s.manualTx.vendor}</p>
                    <p>{fmt(s.manualTx.amount)} · {s.manualTx.transaction_date}</p>
                    {s.manualTx.entity !== "Unassigned" && (
                      <p className="text-muted-foreground">{s.manualTx.entity}</p>
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">Imported</p>
                    <p className="text-sm font-medium">{s.plaidTx.vendor}</p>
                    <p>{fmt(s.plaidTx.amount)} · {s.plaidTx.transaction_date}</p>
                    {s.plaidTx.account_source && (
                      <p className="text-muted-foreground">{s.plaidTx.account_source}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between flex-wrap gap-2">
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
                  <div className="flex gap-2 flex-wrap">
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
                      variant="outline"
                      size="sm"
                      onClick={() => openBuilder([s.manualTx.id], [s.plaidTx.id])}
                      className="text-xs gap-1"
                    >
                      <Layers className="h-3 w-3" /> Add more
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
                      <Link2 className="h-3 w-3" /> Link
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <MatchGroupBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        transactions={transactions}
        initialManualIds={seedManual}
        initialImportedIds={seedImported}
      />
    </>
  );
}
