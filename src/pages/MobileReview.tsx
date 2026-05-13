import { useMemo, useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Check, CheckCheck, Link2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  useTransactions,
  useBulkUpdateTransactions,
  useUpdateTransaction,
  type DbTransaction,
} from "@/hooks/useTransactions";
import { useCompanies } from "@/contexts/CompanyContext";
import { useMatchGroups } from "@/hooks/useTransactionMatching";
import { EXPENSE_CATEGORIES } from "@/components/ExpenseCategoryCombobox";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

type FilterTab = "needs_review" | "reviewed" | "all";

export default function MobileReview() {
  const { data: transactions = [], isLoading } = useTransactions();
  const { data: matchGroups = [] } = useMatchGroups();
  const bulkUpdate = useBulkUpdateTransactions();
  const updateTx = useUpdateTransaction();

  const needsReviewCount = useMemo(
    () => transactions.filter((t) => t.needs_review).length,
    [transactions],
  );
  const reviewedCount = transactions.length - needsReviewCount;

  const [tab, setTab] = useState<FilterTab>("needs_review");
  // If "needs review" is empty on first load, default to All
  useEffect(() => {
    if (!isLoading && needsReviewCount === 0) setTab("all");
    // run once on first data load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const visible = useMemo(() => {
    return transactions.filter((t) => {
      if (tab === "needs_review") return t.needs_review;
      if (tab === "reviewed") return !t.needs_review;
      return true;
    });
  }, [transactions, tab]);

  const groupCountByLink = useMemo(() => {
    const m = new Map<string, { manual: number; imported: number }>();
    for (const g of matchGroups as any[]) {
      const items = g.items || [];
      m.set(g.id, {
        manual: items.filter((i: any) => i.transaction_source === "manual").length,
        imported: items.filter((i: any) => i.transaction_source === "imported").length,
      });
    }
    return m;
  }, [matchGroups]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const [openTxId, setOpenTxId] = useState<string | null>(null);
  const openTx = useMemo(
    () => transactions.find((t) => t.id === openTxId) || null,
    [openTxId, transactions],
  );

  const [confirmBulk, setConfirmBulk] = useState(false);

  const markReviewed = async (ids: string[]) => {
    if (ids.length === 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    await bulkUpdate.mutateAsync({
      ids,
      updates: {
        needs_review: false,
        reviewed_at: new Date().toISOString(),
        reviewed_by_user: user?.id ?? null,
      } as any,
    });
    toast.success(
      ids.length === 1
        ? "Transaction marked as reviewed."
        : `${ids.length} transactions marked as reviewed.`,
    );
    setSelected(new Set());
  };

  return (
    <div className="pb-28 md:pb-0">
      <div className="px-4 pt-4 pb-2 sticky top-0 bg-background/95 backdrop-blur z-10 border-b">
        <h1 className="text-xl font-semibold">Review transactions</h1>
        <p className="text-xs text-muted-foreground mb-3">
          Confirm imported and manual transactions before they appear on reports.
        </p>
        <Tabs value={tab} onValueChange={(v) => setTab(v as FilterTab)}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="needs_review" className="text-xs">
              Needs review
              {needsReviewCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                  {needsReviewCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="reviewed" className="text-xs">
              Reviewed
              <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                {reviewedCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs">
              All
              <Badge variant="secondary" className="ml-1.5 h-4 px-1.5 text-[10px]">
                {transactions.length}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="px-3 py-3 space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="text-center py-12 px-4">
            <CheckCheck className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
            <p className="text-sm font-medium">All caught up</p>
            <p className="text-xs text-muted-foreground">
              No transactions to review here.
            </p>
          </div>
        ) : (
          visible.map((t) => (
            <ReviewCard
              key={t.id}
              tx={t}
              selected={selected.has(t.id)}
              selectionMode={selected.size > 0}
              onToggleSelect={() => toggleSel(t.id)}
              onOpen={() => setOpenTxId(t.id)}
              groupCounts={t.linked_group_id ? groupCountByLink.get(t.linked_group_id) : undefined}
              onMarkReviewed={() => markReviewed([t.id])}
            />
          ))
        )}
      </div>

      {/* Sticky bottom action bar for multi-select */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur p-3 flex items-center gap-2 shadow-lg md:left-64">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="gap-1"
          >
            <X className="h-4 w-4" />
            <span className="hidden xs:inline">Clear</span>
          </Button>
          <span className="text-sm font-medium flex-1">
            {selected.size} selected
          </span>
          <Button
            onClick={() => {
              if (selected.size > 1) setConfirmBulk(true);
              else markReviewed([...selected]);
            }}
            className="gap-2"
            disabled={bulkUpdate.isPending}
          >
            <CheckCheck className="h-4 w-4" />
            Mark reviewed
          </Button>
        </div>
      )}

      <AlertDialog open={confirmBulk} onOpenChange={setConfirmBulk}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark these transactions as reviewed?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark {selected.size} transactions as reviewed. They will stay
              in your ledger and reports — only the review status changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmBulk(false);
                await markReviewed([...selected]);
              }}
            >
              Mark reviewed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ReviewSheet
        tx={openTx}
        onOpenChange={(o) => { if (!o) setOpenTxId(null); }}
        onSave={async (updates, markReviewedToo) => {
          if (!openTx) return;
          const { data: { user } } = await supabase.auth.getUser();
          const fullUpdates: any = { ...updates };
          if (markReviewedToo) {
            fullUpdates.needs_review = false;
            fullUpdates.reviewed_at = new Date().toISOString();
            fullUpdates.reviewed_by_user = user?.id ?? null;
          }
          await updateTx.mutateAsync({ id: openTx.id, ...fullUpdates });
          if (markReviewedToo) toast.success("Transaction marked as reviewed.");
          setOpenTxId(null);
        }}
        groupCounts={openTx?.linked_group_id ? groupCountByLink.get(openTx.linked_group_id) : undefined}
      />
    </div>
  );
}

function StatusPill({ tx, groupCounts }: { tx: DbTransaction; groupCounts?: { manual: number; imported: number } }) {
  if (tx.linked_group_id) {
    const total = (groupCounts?.manual ?? 0) + (groupCounts?.imported ?? 0);
    return (
      <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
        <Link2 className="h-2.5 w-2.5" /> Matched · {total}
      </span>
    );
  }
  if (tx.needs_review) {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Needs review
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      Reviewed
    </span>
  );
}

function ReviewCard({
  tx,
  selected,
  selectionMode,
  onToggleSelect,
  onOpen,
  onMarkReviewed,
  groupCounts,
}: {
  tx: DbTransaction;
  selected: boolean;
  selectionMode: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
  onMarkReviewed: () => void;
  groupCounts?: { manual: number; imported: number };
}) {
  const isIncome = tx.transaction_type === "income";
  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-colors",
        selected && "border-primary ring-1 ring-primary",
        tx.needs_review && !selected && "border-amber-200 dark:border-amber-900/50",
      )}
    >
      <div className="flex items-stretch">
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className="flex items-center pl-3 pr-1 touch-none"
          aria-label={selected ? "Deselect" : "Select"}
        >
          <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
        </button>
        <button
          onClick={onOpen}
          className="flex-1 text-left p-3 min-w-0"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight break-words">
                {tx.vendor || "(No description)"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tx.transaction_date}
                {tx.category ? ` · ${tx.category}` : ""}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <StatusPill tx={tx} groupCounts={groupCounts} />
                {tx.entity && tx.entity !== "Unassigned" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                    {tx.entity}
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground capitalize">
                  {tx.transaction_type}
                </span>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={cn(
                "text-sm font-semibold tabular-nums",
                isIncome ? "text-emerald-600" : "text-foreground",
              )}>
                {isIncome ? "+" : ""}{fmt(Math.abs(tx.amount))}
              </p>
            </div>
          </div>
        </button>
      </div>
      {!selectionMode && tx.needs_review && (
        <div className="border-t flex">
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpen}
            className="flex-1 rounded-none rounded-bl-xl text-xs h-10"
          >
            Review
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onMarkReviewed}
            className="flex-1 rounded-none rounded-br-xl text-xs h-10 gap-1.5 text-emerald-700 dark:text-emerald-400"
          >
            <Check className="h-4 w-4" />
            Mark reviewed
          </Button>
        </div>
      )}
    </div>
  );
}

function ReviewSheet({
  tx,
  onOpenChange,
  onSave,
  groupCounts,
}: {
  tx: DbTransaction | null;
  onOpenChange: (o: boolean) => void;
  onSave: (updates: Partial<DbTransaction>, markReviewed: boolean) => Promise<void>;
  groupCounts?: { manual: number; imported: number };
}) {
  const { companies } = useCompanies();
  const [form, setForm] = useState<Partial<DbTransaction>>({});

  useEffect(() => {
    if (tx) {
      setForm({
        transaction_date: tx.transaction_date,
        vendor: tx.vendor,
        amount: tx.amount,
        transaction_type: tx.transaction_type,
        source_id: tx.source_id,
        entity: tx.entity,
        company_type: tx.company_type,
        category: tx.category,
        excluded_from_reports: tx.excluded_from_reports,
      });
    }
  }, [tx]);

  if (!tx) return null;
  const isIncome = (form.transaction_type || tx.transaction_type) === "income";

  const updateField = <K extends keyof DbTransaction>(k: K, v: DbTransaction[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <Sheet open={!!tx} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] flex flex-col p-0">
        <SheetHeader className="p-4 border-b text-left">
          <SheetTitle>Review transaction</SheetTitle>
          <SheetDescription>
            Confirm or edit the details, then mark as reviewed.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {tx.linked_group_id && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-900 p-3 flex items-center gap-2 text-xs">
              <Link2 className="h-4 w-4 text-blue-600" />
              <span>
                Matched to {(groupCounts?.imported ?? 0)} imported, {(groupCounts?.manual ?? 0)} manual.
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rv-date" className="text-xs">Date</Label>
              <Input
                id="rv-date"
                type="date"
                value={form.transaction_date || ""}
                onChange={(e) => updateField("transaction_date", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rv-amount" className="text-xs">Amount</Label>
              <Input
                id="rv-amount"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={form.amount ?? 0}
                onChange={(e) => updateField("amount", parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="rv-vendor" className="text-xs">Merchant / source</Label>
            <Input
              id="rv-vendor"
              value={form.vendor || ""}
              onChange={(e) => updateField("vendor", e.target.value)}
            />
          </div>

          <div>
            <Label className="text-xs">Type</Label>
            <Select
              value={(form.transaction_type as string) || "expense"}
              onValueChange={(v) => updateField("transaction_type", v as any)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="income">Income</SelectItem>
                <SelectItem value="expense">Expense</SelectItem>
                <SelectItem value="transfer">Transfer</SelectItem>
                <SelectItem value="deduction">Deduction</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Business / entity</Label>
            <Select
              value={form.source_id || "__personal"}
              onValueChange={(v) => {
                if (v === "__personal") {
                  updateField("source_id", null as any);
                  updateField("entity", "Unassigned");
                  updateField("excluded_from_reports", true);
                } else {
                  const c = companies.find((c) => c.id === v);
                  if (c) {
                    updateField("source_id", c.id);
                    updateField("entity", c.name);
                    updateField("company_type", c.companyType);
                    updateField("excluded_from_reports", false);
                  }
                }
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__personal">Personal (not business)</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isIncome && (
            <div>
              <Label className="text-xs">Category</Label>
              <Select
                value={form.category || ""}
                onValueChange={(v) => updateField("category", v)}
              >
                <SelectTrigger><SelectValue placeholder="Pick a category" /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <SheetFooter className="border-t p-3 gap-2 flex-row">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onSave(form, false)}
          >
            Save
          </Button>
          <Button
            className="flex-[2] gap-2"
            onClick={() => onSave(form, true)}
          >
            <Check className="h-4 w-4" />
            Mark as reviewed
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
