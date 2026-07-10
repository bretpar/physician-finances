import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Link2, X, ChevronDown, ChevronUp, Split } from "lucide-react";
import { useState } from "react";
import type {
  SuggestedMatch,
  SingleSuggestedMatch,
  SplitSuggestedMatch,
} from "@/hooks/useTransactionMatching";
import {
  computeLinkConflictsForPair,
  useCreateMatchGroup,
  useLinkTransactions,
  useIgnoreMatch,
} from "@/hooks/useTransactionMatching";
import { ResolveDifferencesModal } from "@/components/ResolveDifferencesModal";
import type { ConflictResolution, FieldConflict } from "@/lib/linkMergeEngine";
import { toast } from "sonner";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  suggestions: SuggestedMatch[];
}

export default function SuggestedMatches({ suggestions }: Props) {
  const [expanded, setExpanded] = useState(true);
  const linkMutation = useLinkTransactions();
  const createGroup = useCreateMatchGroup();
  const ignoreMutation = useIgnoreMatch();
  const [resolveState, setResolveState] = useState<{
    open: boolean;
    manualTxId: string;
    plaidTxId: string;
    confidence?: number;
    conflicts: FieldConflict[];
    currentAmount: number | null;
    importedAmount: number | null;
  } | null>(null);
  const [checking, setChecking] = useState<string | null>(null);

  if (suggestions.length === 0) return null;

  const startLinkSingle = async (s: SingleSuggestedMatch) => {
    const key = `${s.manualTx.id}:${s.plaidTx.id}`;
    setChecking(key);
    try {
      const { conflicts, currentAmount, importedAmount } =
        await computeLinkConflictsForPair(s.manualTx.id, s.plaidTx.id);
      if (conflicts.length === 0) {
        linkMutation.mutate({
          manualTxId: s.manualTx.id,
          plaidTxId: s.plaidTx.id,
          confidence: s.confidence,
        });
      } else {
        setResolveState({
          open: true,
          manualTxId: s.manualTx.id,
          plaidTxId: s.plaidTx.id,
          confidence: s.confidence,
          conflicts,
          currentAmount,
          importedAmount,
        });
      }
    } catch (err: any) {
      toast.error(err?.message || "Could not prepare link");
    } finally {
      setChecking(null);
    }
  };

  const confirmSplit = (s: SplitSuggestedMatch) => {
    createGroup.mutate({
      transactionIds: [...s.manualTxs.map((m) => m.id), s.plaidTx.id],
    });
  };

  const dismissSuggestion = (s: SuggestedMatch) => {
    if (s.kind === "single") {
      ignoreMutation.mutate({
        manualTxId: s.manualTx.id,
        plaidTxId: s.plaidTx.id,
      });
    } else {
      for (const m of s.manualTxs) {
        ignoreMutation.mutate({ manualTxId: m.id, plaidTxId: s.plaidTx.id });
      }
    }
  };

  const onConfirmResolutions = (resolutions: ConflictResolution[]) => {
    if (!resolveState) return;
    linkMutation.mutate(
      {
        manualTxId: resolveState.manualTxId,
        plaidTxId: resolveState.plaidTxId,
        confidence: resolveState.confidence,
        resolutions,
      },
      {
        onSuccess: () => setResolveState(null),
      },
    );
  };

  const confidenceBadgeCls = (label: SuggestedMatch["confidenceLabel"]) =>
    label === "Strong match"
      ? "border-emerald-400 text-emerald-700 dark:text-emerald-400"
      : label === "Possible match"
        ? "border-amber-400 text-amber-700 dark:text-amber-400"
        : "border-muted text-muted-foreground";

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
            if (s.kind === "single") {
              const isIncome = (s.manualTx.transaction_type || "expense") === "income";
              const manualAmt = Math.abs(s.manualTx.amount);
              const plaidAmt = Math.abs(s.plaidTx.amount);
              const rel = manualAmt > 0 ? Math.abs(plaidAmt - manualAmt) / manualAmt : 0;
              const showDiscrepancy = rel > 0.05;
              const key = `${s.manualTx.id}:${s.plaidTx.id}`;
              const isChecking = checking === key;

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
                      Deposit differs from planned net amount. You'll be asked to
                      resolve the differences before linking.
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={`text-xs ${confidenceBadgeCls(s.confidenceLabel)}`}>
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
                        onClick={() => dismissSuggestion(s)}
                        disabled={ignoreMutation.isPending}
                        className="text-xs gap-1"
                      >
                        <X className="h-3 w-3" /> Dismiss
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => startLinkSingle(s)}
                        disabled={linkMutation.isPending || isChecking}
                        className="text-xs gap-1"
                      >
                        <Link2 className="h-3 w-3" />
                        {isChecking ? "Checking…" : "Confirm match"}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            }

            // Split (many-to-one) suggestion
            const plaidAmt = Math.abs(s.plaidTx.amount);
            const delta = plaidAmt - s.sumTarget;
            const rel = plaidAmt > 0 ? Math.abs(delta) / plaidAmt : 0;
            const showSumWarning = rel > 0.005;

            return (
              <Card key={i} className="p-3 space-y-2 border-primary/40">
                <div className="flex items-center gap-2">
                  <Split className="h-3.5 w-3.5 text-primary" />
                  <Badge variant="outline" className="text-[10px] border-primary/50 text-primary">
                    Split deposit · {s.manualTxs.length} entries
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="space-y-2">
                    <p className="font-medium text-muted-foreground">Planned entries (sum)</p>
                    {s.manualTxs.map((m) => (
                      <div key={m.id} className="border-l-2 border-primary/30 pl-2">
                        <p className="text-sm font-medium truncate">{m.vendor}</p>
                        <p>{fmt(m.amount)} · {m.transaction_date}</p>
                        {m.entity !== "Unassigned" && (
                          <p className="text-muted-foreground">{m.entity}</p>
                        )}
                      </div>
                    ))}
                    <p className="pt-1 border-t text-xs">
                      Sum target: <span className="font-medium">{fmt(s.sumTarget)}</span>
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="font-medium text-muted-foreground">Imported deposit (net)</p>
                    <p className="text-sm font-medium">{s.plaidTx.vendor}</p>
                    <p>{fmt(s.plaidTx.amount)} · {s.plaidTx.transaction_date}</p>
                    {s.plaidTx.account_source && (
                      <p className="text-muted-foreground">{s.plaidTx.account_source}</p>
                    )}
                  </div>
                </div>
                {showSumWarning && (
                  <div className="rounded-md border border-amber-300 bg-amber-100/60 dark:border-amber-800 dark:bg-amber-950/40 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-300">
                    Sum differs from deposit by {fmt(Math.abs(delta))} ({(rel * 100).toFixed(1)}%).
                    Review before linking.
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`text-xs ${confidenceBadgeCls(s.confidenceLabel)}`}>
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
                      onClick={() => dismissSuggestion(s)}
                      disabled={ignoreMutation.isPending}
                      className="text-xs gap-1"
                    >
                      <X className="h-3 w-3" /> Dismiss
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => confirmSplit(s)}
                      disabled={createGroup.isPending}
                      className="text-xs gap-1"
                    >
                      <Link2 className="h-3 w-3" />
                      {createGroup.isPending ? "Linking…" : "Confirm split"}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {resolveState && (
        <ResolveDifferencesModal
          open={resolveState.open}
          onOpenChange={(open) =>
            setResolveState((s) => (s ? { ...s, open } : s))
          }
          conflicts={resolveState.conflicts}
          currentAmount={resolveState.currentAmount}
          importedAmount={resolveState.importedAmount}
          onConfirm={onConfirmResolutions}
          isSubmitting={linkMutation.isPending}
        />
      )}
    </div>
  );
}
