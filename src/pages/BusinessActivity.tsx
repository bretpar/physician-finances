import { useState, useMemo } from "react";
import { ExpenseCategoryCombobox, mapLegacyCategory } from "@/components/ExpenseCategoryCombobox";
import { useTransactions, useDeleteTransaction, useAddTransaction, useUpdateTransaction, useBulkUpdateTransactions, TRANSFER_SUBTYPES, type DbTransaction } from "@/hooks/useTransactions";
import { useAddIncome, useUpdateIncome, type IncomeEntry } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useWithholdingRecommendation } from "@/hooks/useWithholdingRecommendation";
import { useSuggestedMatches } from "@/hooks/useTransactionMatching";
import SuggestedMatches from "@/components/SuggestedMatches";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, Trash2, Download, MoreHorizontal, Pencil, DollarSign, Link2, Unlink, AlertCircle, Building2, Tag, EyeOff, CheckCircle2, ArrowLeftRight } from "lucide-react";
import { useCompanies } from "@/contexts/CompanyContext";
import { toast } from "sonner";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const num = (v: string) => parseFloat(v) || 0;

interface TxFormState {
  date: string;
  name: string;
  amount: string;
  type: "income" | "expense" | "transfer";
  category: string;
  notes: string;
  transfer_subtype: string;
  // Income-only fields (hidden from table, shown in form)
  company: string;
  income_type: string;
  gross_amount: string;
  taxes_withheld: string;
  pre_tax_deductions: string;
  retirement_401k: string;
  actual_withholding: string;
}

const emptyForm: TxFormState = {
  date: new Date().toISOString().split("T")[0],
  name: "",
  amount: "",
  type: "expense",
  category: "",
  notes: "",
  transfer_subtype: "",
  company: "",
  income_type: "1099",
  gross_amount: "",
  taxes_withheld: "",
  pre_tax_deductions: "",
  retirement_401k: "",
  actual_withholding: "",
};

export default function Transactions() {
  const { companies } = useCompanies();
  const { data: transactions = [], isLoading } = useTransactions();
  const deleteMutation = useDeleteTransaction();
  const addMutation = useAddTransaction();
  const updateMutation = useUpdateTransaction();
  const bulkUpdateMutation = useBulkUpdateTransactions();
  const addIncomeMutation = useAddIncome();
  const updateIncomeMutation = useUpdateIncome();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense" | "transfer">("all");
  const [filterCompany, setFilterCompany] = useState<string>("all");
  const [filterSource, setFilterSource] = useState<"all" | "manual" | "plaid" | "merged">("all");
  const [filterReview, setFilterReview] = useState<"all" | "needs_review">("all");
  const [filterDateFrom, setFilterDateFrom] = useState<string>("");
  const [filterDateTo, setFilterDateTo] = useState<string>("");
  const [hideLinkedDupes, setHideLinkedDupes] = useState(true);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkCompany, setBulkCompany] = useState("");
  const [bulkCategory, setBulkCategory] = useState("");
  const [showBulkCategory, setShowBulkCategory] = useState(false);

  // Suggested matches
  const suggestions = useSuggestedMatches(transactions);

  // Unified form
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<TxFormState>(emptyForm);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editingIncomeId, setEditingIncomeId] = useState<string | null>(null);

  // Delete
  const [deleteTxId, setDeleteTxId] = useState<string | null>(null);

  // Tax suggestion popup
  const [taxSuggestion, setTaxSuggestion] = useState<{ amount: number; paycheck: number } | null>(null);

  const isEditing = !!editingTxId;
  const isIncome = form.type === "income";
  const isTransfer = form.type === "transfer";

  // Business Activity: only show non-W2 companies (1099, K1)
  const allCompanyNames = useMemo(() => {
    return [...new Set(
      companies.filter((c) => c.companyType !== "W2").map((c) => c.name)
    )].sort();
  }, [companies]);

  const getCompanyType = (name: string) =>
    companies.find((c) => c.name === name)?.companyType || "1099";

  const incomeByLinkedTx = useMemo(() => {
    const map = new Map<string, IncomeEntry>();
    if (!incomeEntries) return map;
    for (const ie of incomeEntries) {
      if (ie.linked_transaction_id) map.set(ie.linked_transaction_id, ie);
    }
    return map;
  }, [incomeEntries]);

  // Filtered list
  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.vendor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType !== "all" && (t.transaction_type || "expense") !== filterType) return false;
      if (filterCompany !== "all" && t.entity !== filterCompany) return false;
      if (filterSource !== "all" && (t.source_type || "manual") !== filterSource) return false;
      if (filterReview === "needs_review" && !t.needs_review) return false;
      if (filterDateFrom && t.transaction_date < filterDateFrom) return false;
      if (filterDateTo && t.transaction_date > filterDateTo) return false;
      // Hide linked source duplicates (plaid side of a linked pair)
      if (hideLinkedDupes && t.match_status === "linked" && t.is_deleted) return false;
      return true;
    });
  }, [transactions, search, filterType, filterCompany, filterSource, filterReview, filterDateFrom, filterDateTo, hideLinkedDupes]);

  const needsReviewCount = useMemo(() =>
    transactions.filter((t) => t.needs_review && !t.is_deleted).length
  , [transactions]);

  // Unique company names from transactions for filter
  const companyFilterOptions = useMemo(() => {
    const names = new Set(transactions.map((t) => t.entity).filter(Boolean));
    return [...names].sort();
  }, [transactions]);

  const setField = (key: keyof TxFormState, value: string) => {
    setForm((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === "company" && value) {
        updated.income_type = getCompanyType(value);
      }
      return updated;
    });
  };

  // --- Smart withholding recommendation engine ---
  const { getRecommendation } = useWithholdingRecommendation();
  const grossIncome = num(form.gross_amount);
  const recommendation = useMemo(() => {
    if (!isIncome || grossIncome <= 0) return null;
    return getRecommendation({
      grossIncome,
      incomeType: form.income_type,
      taxesAlreadyWithheld: num(form.taxes_withheld),
      retirement401k: num(form.retirement_401k),
      preTaxDeductions: num(form.pre_tax_deductions),
      alreadyIncludedInEstimate: isEditing,
    });
  }, [isIncome, grossIncome, form.income_type, form.taxes_withheld, form.retirement_401k, form.pre_tax_deductions, getRecommendation, isEditing]);
  const recommendedWithholding = recommendation?.recommendedWithholding ?? 0;

  // --- Open form for Add ---
  function openAdd() {
    setForm(emptyForm);
    setEditingTxId(null);
    setEditingIncomeId(null);
    setShowForm(true);
  }

  // --- Open form for Edit ---
  function openEdit(tx: DbTransaction) {
    const txType = (tx.transaction_type || "expense") as "income" | "expense" | "transfer";
    const linked = txType === "income" ? incomeByLinkedTx.get(tx.id) : null;

    setForm({
      date: tx.transaction_date,
      name: tx.vendor,
      amount: String(Math.abs(tx.amount)),
      type: txType,
      category: tx.category,
      notes: tx.notes || "",
      transfer_subtype: tx.transfer_subtype || "",
      company: linked?.company || tx.entity || "",
      income_type: linked?.income_type || tx.company_type || "1099",
      gross_amount: linked ? String(linked.paycheck_amount) : String(tx.amount),
      taxes_withheld: linked ? String(linked.taxes_withheld) : "",
      pre_tax_deductions: linked ? String(linked.pre_tax_deductions) : "",
      retirement_401k: linked ? String(linked.retirement_401k) : "",
      actual_withholding: String((tx as any).actual_withholding || ""),
    });
    setEditingTxId(tx.id);
    setEditingIncomeId(linked?.id || null);
    setShowForm(true);
  }

  // --- Save (unified for add + edit) ---
  function saveForm() {
    if (!form.name.trim() || !form.date) return;
    if (!isIncome && !isTransfer && !form.company) { toast.error("Please select a company"); return; }
    if (isIncome && num(form.gross_amount) <= 0) return;

    if (isIncome) {
      const paycheckAmt = num(form.gross_amount);
      const depositedAmt = num(form.amount);
      const taxWithheld = num(form.taxes_withheld);
      const preTaxDed = num(form.pre_tax_deductions);
      const retirement = num(form.retirement_401k);
      const companyType = form.income_type || getCompanyType(form.company);

      if (isEditing) {
        // Update transaction record
        updateMutation.mutate({
          id: editingTxId!,
          transaction_date: form.date,
          vendor: form.name,
          amount: depositedAmt || paycheckAmt,
          category: "Income",
          entity: form.company || "Unassigned",
          company_type: companyType,
          notes: form.notes,
          actual_withholding: num(form.actual_withholding),
          withholding_saved: num(form.actual_withholding) > 0,
          recommended_withholding: recommendedWithholding,
        } as any);

        // Update linked income entry — sync actual_withholding to taxes_withheld
        // so the tax engine picks it up via the weighted income pipeline
        const effectiveWithheld = Math.max(taxWithheld, num(form.actual_withholding));
        if (editingIncomeId) {
          updateIncomeMutation.mutate({
            id: editingIncomeId,
            name: form.name,
            company: form.company,
            income_type: companyType,
            income_date: form.date,
            paycheck_amount: paycheckAmt,
            deposited_amount: depositedAmt,
            taxes_withheld: effectiveWithheld,
            pre_tax_deductions: preTaxDed,
            retirement_401k: retirement,
            notes: form.notes,
          });
        }
      } else {
        // Add new income
        const payload: Partial<IncomeEntry> = {
          name: form.name,
          company: form.company,
          income_type: companyType,
          income_date: form.date,
          paycheck_amount: paycheckAmt,
          deposited_amount: depositedAmt,
          taxes_withheld: taxWithheld,
          pre_tax_deductions: preTaxDed,
          retirement_401k: retirement,
          notes: form.notes,
        };
        addIncomeMutation.mutate(payload, {
          onSuccess: () => {
            if ((companyType === "1099" || companyType === "K1") && taxWithheld === 0 && paycheckAmt > 0) {
              setTaxSuggestion({ amount: recommendedWithholding, paycheck: paycheckAmt });
            }
          },
        });
      }
    } else if (isTransfer) {
      // Transfer
      const amount = num(form.amount);
      if (amount === 0) return;

      if (isEditing) {
        updateMutation.mutate({
          id: editingTxId!,
          transaction_date: form.date,
          vendor: form.name,
          amount,
          category: "Transfer",
          notes: form.notes,
          transaction_type: "transfer",
          transfer_subtype: form.transfer_subtype || null,
          entity: form.company || "Unassigned",
          excluded_from_reports: true,
        } as any);
      } else {
        addMutation.mutate({
          transaction_date: form.date,
          vendor: form.name,
          amount,
          category: "Transfer",
          notes: form.notes,
          transaction_type: "transfer",
          transfer_subtype: form.transfer_subtype || null,
          entity: form.company || "Unassigned",
          excluded_from_reports: true,
        } as any);
      }
    } else {
      // Expense
      const amount = num(form.amount);
      if (amount === 0) return;

      if (isEditing) {
        updateMutation.mutate({
          id: editingTxId!,
          transaction_date: form.date,
          vendor: form.name,
          amount,
          category: form.category,
          notes: form.notes,
          entity: form.company || "Unassigned",
        } as any);
      } else {
        addMutation.mutate({
          transaction_date: form.date,
          vendor: form.name,
          amount,
          category: form.category,
          notes: form.notes,
          transaction_type: "expense",
          entity: form.company || "Unassigned",
        });
      }
    }

    setShowForm(false);
    setForm(emptyForm);
    setEditingTxId(null);
    setEditingIncomeId(null);
  }

  function confirmDelete(id: string) { setDeleteTxId(id); }
  function executeDelete() {
    if (!deleteTxId) return;
    deleteMutation.mutate(deleteTxId);
    setDeleteTxId(null);
    if (editingTxId === deleteTxId) {
      setShowForm(false);
      setEditingTxId(null);
    }
  }

  function exportCSV() {
    const headers = ["Date", "Transaction", "Amount", "Type", "Category"];
    const rows = filtered.map((t) => {
      const type = (t.transaction_type || "expense");
      const displayAmt = type === "expense" ? -Math.abs(t.amount) : Math.abs(t.amount);
      return [t.transaction_date, t.vendor, displayAmt, type === "income" ? "Income" : "Expense", t.category];
    });
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4 max-w-4xl mx-auto">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Business Activity</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1.5">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button size="sm" onClick={openAdd} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Search + filter tabs */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search transactions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-1 rounded-lg border border-border p-0.5 bg-muted/30">
            {(["all", "income", "expense", "transfer"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFilterType(tab)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                  filterType === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab === "all" ? "All" : tab === "income" ? "Income" : tab === "expense" ? "Expenses" : "Transfers"}
              </button>
            ))}
          </div>
        </div>
        {/* Company + date range filters */}
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap items-center">
          <Select value={filterCompany} onValueChange={setFilterCompany}>
            <SelectTrigger className="w-full sm:w-[180px] h-8 text-xs">
              <SelectValue placeholder="All Companies" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Companies</SelectItem>
              {companyFilterOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterSource} onValueChange={(v) => setFilterSource(v as any)}>
            <SelectTrigger className="w-full sm:w-[150px] h-8 text-xs">
              <SelectValue placeholder="All Sources" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="manual">Manual</SelectItem>
              <SelectItem value="plaid">Imported</SelectItem>
              <SelectItem value="merged">Linked</SelectItem>
            </SelectContent>
          </Select>
          {needsReviewCount > 0 && (
            <Button
              variant={filterReview === "needs_review" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setFilterReview(filterReview === "needs_review" ? "all" : "needs_review")}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              Needs Review ({needsReviewCount})
            </Button>
          )}
          <div className="flex gap-2 items-center">
            <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="h-8 text-xs w-[130px]" placeholder="From" />
            <span className="text-xs text-muted-foreground">to</span>
            <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="h-8 text-xs w-[130px]" placeholder="To" />
            {(filterDateFrom || filterDateTo || filterCompany !== "all" || filterSource !== "all" || filterReview !== "all") && (
              <Button variant="ghost" size="sm" className="h-8 text-xs px-2" onClick={() => { setFilterCompany("all"); setFilterSource("all"); setFilterReview("all"); setFilterDateFrom(""); setFilterDateTo(""); }}>
                Clear
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2 ml-auto">
            <Switch checked={hideLinkedDupes} onCheckedChange={setHideLinkedDupes} id="hide-dupes" />
            <Label htmlFor="hide-dupes" className="text-xs text-muted-foreground cursor-pointer">Hide linked duplicates</Label>
          </div>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2.5">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
          <div className="flex gap-2 flex-wrap flex-1">
            <Select value={bulkCompany} onValueChange={(v) => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { entity: v, needs_review: false } as any });
              setBulkCompany("");
              setSelectedIds(new Set());
            }}>
              <SelectTrigger className="w-[160px] h-7 text-xs">
                <SelectValue placeholder="Assign Company" />
              </SelectTrigger>
              <SelectContent>
                {companies.map((c) => (
                  <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowBulkCategory(true)}>
              <Tag className="h-3 w-3" /> Assign Category
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { excluded_from_reports: true, needs_review: false } as any });
              setSelectedIds(new Set());
            }}>
              <EyeOff className="h-3 w-3" /> Mark Personal
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { excluded_from_reports: true, needs_review: false } as any });
              setSelectedIds(new Set());
            }}>
              <EyeOff className="h-3 w-3" /> Exclude from Reports
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
              bulkUpdateMutation.mutate({ ids: [...selectedIds], updates: { needs_review: false } as any });
              setSelectedIds(new Set());
            }}>
              <CheckCircle2 className="h-3 w-3" /> Mark Reviewed
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedIds(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Suggested Matches */}
      <SuggestedMatches suggestions={suggestions} />

      {/* Banking-style table */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {/* Table header */}
        <div className="hidden sm:grid sm:grid-cols-[28px_85px_1fr_85px_100px_65px_65px_95px_36px] gap-2 px-4 py-2.5 border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground uppercase tracking-wide items-center">
          <Checkbox
            checked={filtered.length > 0 && selectedIds.size === filtered.length}
            onCheckedChange={(checked) => {
              if (checked) setSelectedIds(new Set(filtered.map((t) => t.id)));
              else setSelectedIds(new Set());
            }}
          />
          <span>Date</span>
          <span>Transaction</span>
          <span>Company</span>
          <span className="text-right">Amount</span>
          <span className="text-center">Type</span>
          <span className="text-center">Source</span>
          <span>Category</span>
          <span></span>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border">
          {filtered.map((tx) => {
            const type = (tx.transaction_type || "expense") as string;
            const isIncomeTx = type === "income";
            const displayAmount = isIncomeTx ? Math.abs(tx.amount) : -Math.abs(tx.amount);
            const source = tx.source_type || "manual";
            const isSelected = selectedIds.has(tx.id);

            return (
              <div
                key={tx.id}
                className={`flex flex-col sm:grid sm:grid-cols-[28px_85px_1fr_85px_100px_65px_65px_95px_36px] gap-1 sm:gap-2 px-4 py-3 hover:bg-muted/30 transition-colors items-center ${
                  tx.needs_review ? "bg-amber-50/30 dark:bg-amber-950/10" : ""
                } ${isSelected ? "bg-primary/5" : ""}`}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedIds);
                    if (checked) next.add(tx.id); else next.delete(tx.id);
                    setSelectedIds(next);
                  }}
                />
                <span className="text-sm text-muted-foreground tabular-nums">
                  {new Date(tx.transaction_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
                <span className="text-sm font-medium text-foreground truncate flex items-center gap-1.5">
                  {tx.vendor}
                  {tx.needs_review && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-400 text-amber-600 dark:text-amber-400">Review</Badge>
                  )}
                  {tx.excluded_from_reports && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted text-muted-foreground">Excluded</Badge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {tx.entity || "Unassigned"}
                </span>
                <span className={`text-sm font-semibold tabular-nums text-right ${isIncomeTx ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                  {isIncomeTx ? "+" : ""}{fmt(displayAmount)}
                </span>
                <span className="text-center">
                  <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    isIncomeTx
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                      : "bg-muted text-muted-foreground"
                  }`}>
                    {isIncomeTx ? "Income" : "Expense"}
                  </span>
                </span>
                <span className="text-center">
                  {source === "plaid" && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Imported</Badge>
                  )}
                  {source === "merged" && (
                    <Badge variant="default" className="text-[10px] px-1.5 py-0 gap-0.5">
                      <Link2 className="h-2.5 w-2.5" />Linked
                    </Badge>
                  )}
                  {source === "manual" && (
                    <span className="text-[10px] text-muted-foreground">Manual</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground truncate">
                  {mapLegacyCategory(tx.category)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(tx)}>
                      <Pencil className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => confirmDelete(tx.id)} className="text-destructive focus:text-destructive">
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-16 text-center text-muted-foreground text-sm">
              No transactions yet. Click "Add" to get started.
            </div>
          )}
        </div>
      </div>

      {/* ═══════ UNIFIED ADD / EDIT FORM ═══════ */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) { setShowForm(false); setEditingTxId(null); } }}>
        <DialogContent className={`max-h-[85vh] overflow-y-auto ${isIncome ? "max-w-lg" : ""}`}>
          <DialogHeader>
            <DialogTitle>{isEditing ? "Edit Entry" : "Add Business Entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Type toggle */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
              <div className="flex gap-1 rounded-lg border border-border p-0.5 bg-muted/30 w-fit">
                {(["income", "expense"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setField("type", t)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors capitalize ${
                      form.type === t
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t === "income" ? "Income" : "Expense"}
                  </button>
                ))}
              </div>
            </div>

            {/* Common fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <Input type="date" value={form.date} onChange={(e) => setField("date", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">
                  {isIncome ? "Description" : "Merchant / Name"}
                </Label>
                <Input
                  placeholder={isIncome ? "e.g. ED Shift Pay" : "e.g. Amazon"}
                  value={form.name}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </div>
            </div>

            {!isIncome && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company *</Label>
                  <Select value={form.company} onValueChange={(v) => setField("company", v)}>
                    <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {companies.map((c) => (
                        <SelectItem key={c.id} value={c.name}>{c.name} ({c.companyType})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Amount</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={(e) => setField("amount", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                    <ExpenseCategoryCombobox value={form.category} onValueChange={(v) => setField("category", v)} />
                  </div>
                </div>
              </div>
            )}

            {isIncome && (
              <div className="space-y-3 rounded-lg border border-border p-3 bg-muted/20">
                <p className="text-xs font-semibold text-muted-foreground">Income Details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
                    <Select value={form.company} onValueChange={(v) => setField("company", v)}>
                      <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                      <SelectContent>
                        {allCompanyNames.map((c) => (
                          <SelectItem key={c} value={c}>{c} ({getCompanyType(c)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Income *</Label>
                    <Input type="number" min="0" step="0.01" value={form.gross_amount} onChange={(e) => setField("gross_amount", e.target.value)} placeholder="0.00" />
                    <p className="text-[10px] text-muted-foreground mt-1">Total income before taxes or deductions</p>
                  </div>
                </div>

                {/* Net Received + Estimated Net */}
                {grossIncome > 0 && (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Net Received (Optional)</Label>
                      <Input type="number" min="0" step="0.01" placeholder={fmt(Math.max(0, grossIncome - num(form.taxes_withheld) - num(form.pre_tax_deductions) - num(form.retirement_401k)))} value={form.amount} onChange={(e) => setField("amount", e.target.value)} />
                      <p className="text-[10px] text-muted-foreground mt-1">Amount deposited into your bank account after taxes and deductions</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground bg-muted/40 rounded px-2 py-1">
                      Estimated Net: <strong>{fmt(Math.max(0, grossIncome - num(form.taxes_withheld) - num(form.pre_tax_deductions) - num(form.retirement_401k)))}</strong> based on your inputs
                    </p>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Taxes Withheld</Label>
                    <Input type="number" min="0" step="0.01" value={form.taxes_withheld} onChange={(e) => setField("taxes_withheld", e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Pre-Tax Ded.</Label>
                    <Input type="number" min="0" step="0.01" value={form.pre_tax_deductions} onChange={(e) => setField("pre_tax_deductions", e.target.value)} placeholder="0.00" />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Retirement</Label>
                    <Input type="number" min="0" step="0.01" value={form.retirement_401k} onChange={(e) => setField("retirement_401k", e.target.value)} placeholder="0.00" />
                  </div>
                </div>

                {/* Tax recommendation (read-only) + actual input */}
                {grossIncome > 0 && recommendation && (
                  <div className="rounded-md border border-border p-3 space-y-2 bg-background">
                    {recommendation.isOverWithheld ? (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Employer over-withheld by</span>
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400">{fmt(Math.abs(recommendedWithholding))}</span>
                        </div>
                        <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                          Your W-2 employer withheld more than estimated for this paycheck — consider adjusting your W-4.
                        </p>
                      </>
                    ) : recommendedWithholding > 0 ? (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {form.income_type === "W2" ? "Additional withholding recommended" : "Recommended to set aside"}
                          </span>
                          <span className="font-semibold text-primary">{fmt(recommendedWithholding)}</span>
                        </div>
                        {form.income_type === "W2" && (
                          <p className="text-[11px] text-amber-600 dark:text-amber-400">
                            Your W-2 employer may not be withholding enough — consider adjusting your W-4.
                          </p>
                        )}
                      </>
                    ) : null}
                    {!recommendation.isManualMode && recommendedWithholding !== 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        {recommendation.methodLabel} · {recommendation.effectiveRate.toFixed(1)}% effective rate
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground italic">
                      Withholding method controlled in Settings
                    </p>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Actual amount withheld</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={recommendedWithholding > 0 ? fmt(recommendedWithholding) : "0.00"}
                        value={form.actual_withholding === "0" ? "" : form.actual_withholding}
                        onChange={(e) => setField("actual_withholding", e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Notes */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
              <Input placeholder="Optional" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
            </div>

            {/* Actions */}
            <div className="flex justify-between">
              {isEditing ? (
                <Button variant="destructive" size="sm" onClick={() => confirmDelete(editingTxId!)}>
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ) : <div />}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                <Button onClick={saveForm} disabled={!form.name.trim() || !form.date}>
                  {isEditing ? "Save" : "Add"}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTxId} onOpenChange={(open) => !open && setDeleteTxId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove this transaction.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Tax suggestion popup */}
      <Dialog open={!!taxSuggestion} onOpenChange={() => setTaxSuggestion(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-primary" /> Tax Set-Aside Suggestion
            </DialogTitle>
          </DialogHeader>
          {taxSuggestion && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Consider setting aside this amount for taxes:</p>
              <p className="text-3xl font-bold text-primary text-center py-2">{fmt(taxSuggestion.amount)}</p>
              <p className="text-sm text-muted-foreground text-center">from this {fmt(taxSuggestion.paycheck)} income</p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setTaxSuggestion(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Category Assignment Dialog */}
      <Dialog open={showBulkCategory} onOpenChange={setShowBulkCategory}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign Category to {selectedIds.size} transactions</DialogTitle>
          </DialogHeader>
          <ExpenseCategoryCombobox
            value={bulkCategory}
            onValueChange={setBulkCategory}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowBulkCategory(false)}>Cancel</Button>
            <Button
              disabled={!bulkCategory}
              onClick={() => {
                bulkUpdateMutation.mutate({
                  ids: [...selectedIds],
                  updates: { category: bulkCategory, needs_review: false } as any,
                });
                setSelectedIds(new Set());
                setBulkCategory("");
                setShowBulkCategory(false);
              }}
            >
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
