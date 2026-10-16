import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useSuggestedMatches,
  useLinkTransactions,
  useCreateMatchGroup,
  useIgnoreMatch,
} from "@/hooks/useTransactionMatching";
import { buildRecordSelectionBridge } from "@/lib/recordSelectionBridge";
import { buildLinkReviewItems, manualLinkCandidates, type LinkReviewItem } from "@/lib/linkReview";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const KIND_LABEL: Record<LinkReviewItem["kind"], string> = {
  suggested: "Suggested match",
  unlinked_deposit: "Unlinked deposit",
  unconfirmed_income: "No deposit linked",
  auto_linked: "Linked automatically",
  merge_group: "Entry and deposits don't line up",
};

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function useAllLinks() {
  return useQuery({
    queryKey: ["transaction-links", "all-for-review"],
    queryFn: async () => {
      const { data, error } = await supabase.from("transaction_links").select("*").eq("status", "linked");
      if (error) throw error;
      return data || [];
    },
  });
}

function useDismissals() {
  return useQuery({
    queryKey: ["link-review-dismissals"],
    queryFn: async () => {
      const { data, error } = await supabase.from("link_review_dismissals").select("item_key");
      if (error) throw error;
      return new Set((data || []).map((d) => d.item_key));
    },
  });
}

/** Undo a group's links and return its records to active/unmatched (links and link status only). */
async function releaseGroup(groupId: string | null | undefined, txIds: string[]) {
  if (groupId) {
    const { error } = await supabase.from("transaction_links").update({ status: "unlinked" }).eq("linked_group_id", groupId);
    if (error) throw error;
  }
  if (txIds.length) {
    const { error } = await supabase
      .from("transactions")
      .update({ match_status: "unmatched", linked_group_id: null, status: "active" })
      .in("id", txIds);
    if (error) throw error;
  }
}

export default function LinkReview() {
  const qc = useQueryClient();
  const { data: transactions = [], isLoading: txLoading } = useTransactions();
  const { data: incomeEntries = [], isLoading: ieLoading } = useIncomeEntries();
  const { data: links = [] } = useAllLinks();
  const { data: dismissed = new Set<string>() } = useDismissals();
  const { recordSelection } = useTaxEstimate();
  const suggestions = useSuggestedMatches(transactions as any, incomeEntries as any);
  const linkPair = useLinkTransactions();
  const createGroup = useCreateMatchGroup();
  const ignore = useIgnoreMatch();
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const bridge = useMemo(() => {
    const sel = recordSelection?.actualOnly;
    if (!sel) return null;
    const ids = (r: any[]) => r.map((x) => x.id as string);
    return buildRecordSelectionBridge({
      incomeEntries: incomeEntries as any[],
      transactions: transactions as any[],
      transactionLinks: links as any[],
      plannerConversions: [],
      selection: {
        businessIncomeTransactionIds: ids(sel.businessIncomeTransactions),
        linkedEnrichmentEntryIds: ids(sel.linkedEnrichmentEntries),
        personalEntryIds: ids(sel.personalEntries),
        projectedPaychecks: sel.projectedPaychecks,
      },
    });
  }, [recordSelection, incomeEntries, transactions, links]);

  const items = useMemo(
    () =>
      buildLinkReviewItems({
        transactions: transactions as any[],
        incomeEntries: incomeEntries as any[],
        transactionLinks: links as any[],
        suggestions: suggestions as any,
        bridge,
        dismissedKeys: dismissed,
        today: new Date().toISOString().slice(0, 10),
      }),
    [transactions, incomeEntries, links, suggestions, bridge, dismissed],
  );

  const refresh = () => {
    ["transactions", "transaction-links", "income_entries", "match-groups", "link-review-dismissals"].forEach((k) =>
      qc.invalidateQueries({ queryKey: [k] }),
    );
  };

  const markReviewed = useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase.from("link_review_dismissals").insert({ item_key: key });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      toast.success("Marked as reviewed");
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      refresh();
    } catch (e: any) {
      toast.error(e?.message || "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  const txById = useMemo(() => new Map((transactions as any[]).map((t) => [t.id, t])), [transactions]);

  function actions(item: LinkReviewItem) {
    const isBusy = busy === item.key;
    const reviewed = (
      <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => markReviewed.mutate(item.key)}>
        Mark as reviewed
      </Button>
    );
    if (item.kind === "suggested") {
      const s = (suggestions as any[]).find((x) =>
        item.transactionIds.includes(x.plaidTx.id),
      );
      return (
        <>
          <Button
            size="sm"
            disabled={isBusy || !s}
            onClick={() =>
              run(item.key, () =>
                s.kind === "single"
                  ? linkPair.mutateAsync({ manualTxId: s.manualTx.id, plaidTxId: s.plaidTx.id, confidence: s.confidence })
                  : createGroup.mutateAsync({ transactionIds: item.transactionIds }),
              )
            }
          >
            Confirm link
          </Button>
          {s?.kind === "single" && (
            <Button size="sm" variant="outline" disabled={isBusy}
              onClick={() => run(item.key, () => ignore.mutateAsync({ manualTxId: s.manualTx.id, plaidTxId: s.plaidTx.id }))}>
              Not a match
            </Button>
          )}
        </>
      );
    }
    if (item.kind === "unlinked_deposit" || item.kind === "unconfirmed_income") {
      const self = txById.get(item.transactionIds[0]);
      const candidates = self ? manualLinkCandidates(self, transactions as any[]) : [];
      return (
        <>
          <Select value={pick[item.key]} onValueChange={(v) => setPick((p) => ({ ...p, [item.key]: v }))}>
            <SelectTrigger className="h-9 w-full sm:w-64">
              <SelectValue placeholder={candidates.length ? (item.kind === "unlinked_deposit" ? "Choose income entry" : "Choose deposit") : "Nothing nearby to link"} />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.transaction_date} · {c.vendor} · {money(Math.abs(Number(c.amount)))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={isBusy || !pick[item.key]}
            onClick={() => run(item.key, () => createGroup.mutateAsync({ transactionIds: [item.transactionIds[0], pick[item.key]] }))}>
            Link
          </Button>
          {reviewed}
        </>
      );
    }
    if (item.kind === "auto_linked") {
      return (
        <>
          <Button size="sm" variant="outline" disabled={isBusy}
            onClick={() => run(item.key, async () => { await releaseGroup(item.groupId, item.transactionIds); toast.success("Unlinked"); })}>
            Unlink
          </Button>
          <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => markReviewed.mutate(item.key)}>
            Link is correct
          </Button>
        </>
      );
    }
    // merge_group
    return (
      <>
        <Button size="sm" disabled={isBusy}
          onClick={() => run(item.key, async () => {
            await releaseGroup(item.groupId, item.linkAllIds ?? []);
            await createGroup.mutateAsync({ transactionIds: item.linkAllIds ?? [] });
          })}>
          Link all deposits to this entry
        </Button>
        {reviewed}
      </>
    );
  }

  const loading = txLoading || ieLoading;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Link Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Income entries and bank deposits whose links are missing or uncertain. Each fix only changes the records shown on that card.
        </p>
      </div>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Nothing to review. All income entries and deposits are linked or reviewed.</CardContent></Card>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"} to review</p>
          {items.map((item) => (
            <Card key={item.key}>
              <CardContent className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{KIND_LABEL[item.kind]}</Badge>
                      {item.confidenceLabel && <Badge variant="outline">{item.confidenceLabel}</Badge>}
                    </div>
                    <p className="mt-2 break-words font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.date ?? "No date"}</p>
                  </div>
                  <p className="font-semibold tabular-nums text-foreground">{money(item.amount)}</p>
                </div>
                <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">{item.howCounted}</p>
                <div className="flex flex-wrap items-center gap-2">{actions(item)}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
