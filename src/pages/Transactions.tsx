import { useState, useMemo } from "react";
import { categories, accounts, PERSONAL_CATEGORY } from "@/lib/mockData";
import { useTransactions, useDeleteTransaction, useAddTransaction, useUpdateTransaction, type DbTransaction, type TransactionType } from "@/hooks/useTransactions";
import { useAddIncome, useUpdateIncome, type IncomeEntry } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useIncomeEntries } from "@/hooks/useIncome";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, Plus, Trash2, Download, DollarSign, AlertTriangle, PiggyBank, Info, MoreHorizontal, Pencil, SlidersHorizontal } from "lucide-react";
import { useCompanies } from "@/contexts/CompanyContext";
import { ACCOUNT_TYPES } from "@/hooks/useRetirementContributions";
import { toast } from "sonner";

const INCOME_TYPES = ["W2", "1099", "K1"];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface IncomeFormState {
  name: string;
  company: string;
  income_type: string;
  income_date: string;
  paycheck_amount: string;
  deposited_amount: string;
  taxes_withheld: string;
  pre_tax_deductions: string;
  retirement_401k: string;
  retirement_account_type: string;
  notes: string;
}

const emptyIncomeForm: IncomeFormState = {
  name: "",
  company: "",
  income_type: "1099",
  income_date: new Date().toISOString().split("T")[0],
  paycheck_amount: "",
  deposited_amount: "",
  taxes_withheld: "",
  pre_tax_deductions: "",
  retirement_401k: "",
  retirement_account_type: "401k",
  notes: "",
};

export default function Transactions() {
  const { companies } = useCompanies();
  const { data: transactions = [], isLoading } = useTransactions();
  const deleteMutation = useDeleteTransaction();
  const addMutation = useAddTransaction();
  const updateMutation = useUpdateTransaction();
  const addIncomeMutation = useAddIncome();
  const updateIncomeMutation = useUpdateIncome();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();

  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<"all" | TransactionType>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Edit dialog
  const [editTx, setEditTx] = useState<DbTransaction | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editVendor, setEditVendor] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editEntity, setEditEntity] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editActualWithholding, setEditActualWithholding] = useState("");
  const [editWithholdingSaved, setEditWithholdingSaved] = useState(false);

  // Income-specific edit state
  const [editIncomeForm, setEditIncomeForm] = useState<IncomeFormState>(emptyIncomeForm);
  const [editIncomeId, setEditIncomeId] = useState<string | null>(null);
  const isEditingIncome = editTx?.transaction_type === "income";

  // Delete
  const [deleteTxId, setDeleteTxId] = useState<string | null>(null);

  // Add expense dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addVendor, setAddVendor] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addCategory, setAddCategory] = useState("Uncategorized");
  const [addAccount, setAddAccount] = useState(accounts[0]);
  const [addEntity, setAddEntity] = useState("Unassigned");
  const [addMemo, setAddMemo] = useState("");

  // Add income dialog
  const [showIncomeDialog, setShowIncomeDialog] = useState(false);
  const [incomeForm, setIncomeForm] = useState<IncomeFormState>(emptyIncomeForm);
  const [taxSuggestion, setTaxSuggestion] = useState<{ amount: number; paycheck: number } | null>(null);

  const num = (v: string) => parseFloat(v) || 0;

  const companyOptions = useMemo(() => {
    return companies.map((c) => ({ label: `${c.name} (${c.companyType})`, value: c.name, type: c.companyType }));
  }, [companies]);

  const allCompanyNames = useMemo(() => {
    const set = new Set<string>();
    companies.forEach((c) => set.add(c.name));
    return [...set].sort();
  }, [companies]);

  const incomeByLinkedTx = useMemo(() => {
    const map = new Map<string, IncomeEntry>();
    if (!incomeEntries) return map;
    for (const ie of incomeEntries) {
      if (ie.linked_transaction_id) {
        map.set(ie.linked_transaction_id, ie);
      }
    }
    return map;
  }, [incomeEntries]);

  const computedPaycheck = num(incomeForm.deposited_amount) + num(incomeForm.taxes_withheld) + num(incomeForm.pre_tax_deductions) + num(incomeForm.retirement_401k);
  const grossIncome = num(incomeForm.paycheck_amount) || computedPaycheck;
  const retirementContrib = num(incomeForm.retirement_401k);
  const preTaxDed = num(incomeForm.pre_tax_deductions);
  const taxableIncome = Math.max(0, grossIncome - retirementContrib - preTaxDed);
  const netIncome = num(incomeForm.deposited_amount);
  const enteredPaycheck = num(incomeForm.paycheck_amount);
  const hasMismatch = incomeForm.paycheck_amount !== "" && incomeForm.deposited_amount !== "" && Math.abs(enteredPaycheck - computedPaycheck) > 0.01;

  const getCompanyType = (companyName: string) => {
    const c = companies.find((co) => co.name === companyName);
    return c?.companyType || "1099";
  };

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.vendor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType !== "all" && (t.transaction_type || "expense") !== filterType) return false;
      if (filterCategory !== "all" && t.category !== filterCategory) return false;
      if (filterCompany !== "all" && t.entity !== filterCompany) return false;
      if (filterDateFrom && t.transaction_date < filterDateFrom) return false;
      if (filterDateTo && t.transaction_date > filterDateTo) return false;
      return true;
    });
  }, [transactions, search, filterType, filterCategory, filterCompany, filterDateFrom, filterDateTo]);

  function getCompanyTypeForEntity(entityName: string) {
    return companies.find((c) => c.name === entityName)?.companyType || "";
  }

  function openEdit(tx: DbTransaction) {
    setEditTx(tx);
    setEditDate(tx.transaction_date);
    setEditVendor(tx.vendor);
    setEditAmount(String(tx.amount));
    setEditCategory(tx.category);
    setEditEntity(tx.entity);
    setEditMemo(tx.notes || "");
    setEditWithholdingSaved((tx as any).withholding_saved || false);
    setEditActualWithholding(String((tx as any).actual_withholding || 0));

    if (tx.transaction_type === "income") {
      const linked = incomeByLinkedTx.get(tx.id);
      if (linked) {
        setEditIncomeId(linked.id);
        setEditIncomeForm({
          name: linked.name || tx.vendor,
          company: linked.company || tx.entity,
          income_type: linked.income_type || tx.company_type || "1099",
          income_date: linked.income_date || tx.transaction_date,
          paycheck_amount: String(linked.paycheck_amount || ""),
          deposited_amount: String(linked.deposited_amount || ""),
          taxes_withheld: String(linked.taxes_withheld || ""),
          pre_tax_deductions: String(linked.pre_tax_deductions || ""),
          retirement_401k: String(linked.retirement_401k || ""),
          retirement_account_type: "401k",
          notes: linked.notes || tx.notes || "",
        });
      } else {
        setEditIncomeId(null);
        setEditIncomeForm({
          name: tx.vendor,
          company: tx.entity,
          income_type: tx.company_type || "1099",
          income_date: tx.transaction_date,
          paycheck_amount: String(tx.amount),
          deposited_amount: String(tx.amount),
          taxes_withheld: "",
          pre_tax_deductions: "",
          retirement_401k: "",
          retirement_account_type: "401k",
          notes: tx.notes || "",
        });
      }
    }
  }

  const setEditIncomeField = (key: keyof IncomeFormState, value: string) => {
    setEditIncomeForm((p) => {
      const updated = { ...p, [key]: value };
      if (key === "company" && value) {
        updated.income_type = getCompanyType(value);
      }
      return updated;
    });
  };

  const editComputedPaycheck = num(editIncomeForm.deposited_amount) + num(editIncomeForm.taxes_withheld) + num(editIncomeForm.pre_tax_deductions) + num(editIncomeForm.retirement_401k);
  const editEnteredPaycheck = num(editIncomeForm.paycheck_amount);
  const editHasMismatch = editIncomeForm.paycheck_amount !== "" && editIncomeForm.deposited_amount !== "" && Math.abs(editEnteredPaycheck - editComputedPaycheck) > 0.01;
  const editGrossIncome = num(editIncomeForm.paycheck_amount) || editComputedPaycheck;
  const editRetirementContrib = num(editIncomeForm.retirement_401k);
  const editPreTaxDed = num(editIncomeForm.pre_tax_deductions);
  const editTaxableIncome = Math.max(0, editGrossIncome - editRetirementContrib - editPreTaxDed);
  const editNetIncome = num(editIncomeForm.deposited_amount);

  function saveEdit() {
    if (!editTx) return;

    if (editTx.transaction_type === "income") {
      const paycheckAmt = num(editIncomeForm.paycheck_amount) || editComputedPaycheck;
      const depositedAmt = num(editIncomeForm.deposited_amount);
      const taxWithheld = num(editIncomeForm.taxes_withheld);
      const preTaxDed = num(editIncomeForm.pre_tax_deductions);
      const retirement = num(editIncomeForm.retirement_401k);
      const companyType = editIncomeForm.income_type || getCompanyTypeForEntity(editIncomeForm.company);

      const taxableForThis = Math.max(0, paycheckAmt - preTaxDed - retirement);
      const isSelfEmployed = companyType === "1099" || companyType === "K1";
      const estimatedRate = isSelfEmployed ? 0.35 : 0.25;
      const recommendedWithholding = Math.max(0, Math.round((taxableForThis * estimatedRate - taxWithheld) * 100) / 100);

      updateMutation.mutate({
        id: editTx.id,
        transaction_date: editIncomeForm.income_date,
        vendor: editIncomeForm.name || editIncomeForm.company,
        amount: depositedAmt || paycheckAmt,
        category: "Income",
        entity: editIncomeForm.company || "Unassigned",
        company_type: companyType,
        notes: editIncomeForm.notes,
        actual_withholding: parseFloat(editActualWithholding) || 0,
        withholding_saved: (parseFloat(editActualWithholding) || 0) > 0 || editWithholdingSaved,
        recommended_withholding: recommendedWithholding,
      } as any);

      if (editIncomeId) {
        updateIncomeMutation.mutate({
          id: editIncomeId,
          name: editIncomeForm.name,
          company: editIncomeForm.company,
          income_type: companyType,
          income_date: editIncomeForm.income_date,
          paycheck_amount: paycheckAmt,
          deposited_amount: depositedAmt,
          taxes_withheld: taxWithheld,
          pre_tax_deductions: preTaxDed,
          retirement_401k: retirement,
          notes: editIncomeForm.notes,
        });
      }

      setEditTx(null);
      return;
    }

    const newAmount = parseFloat(editAmount) || editTx.amount;
    const companyType = getCompanyTypeForEntity(editEntity);

    updateMutation.mutate({
      id: editTx.id,
      transaction_date: editDate || editTx.transaction_date,
      vendor: editVendor || editTx.vendor,
      amount: newAmount,
      category: editCategory,
      entity: editEntity,
      company_type: companyType,
      notes: editMemo,
    } as any);
    setEditTx(null);
  }

  function confirmDelete(id: string) { setDeleteTxId(id); }

  function executeDelete() {
    if (!deleteTxId) return;
    deleteMutation.mutate(deleteTxId);
    setDeleteTxId(null);
    if (editTx?.id === deleteTxId) setEditTx(null);
  }

  function addTransaction() {
    const amount = parseFloat(addAmount) || 0;
    if (!addDate || !addVendor || amount === 0) return;
    const companyType = getCompanyTypeForEntity(addEntity);
    addMutation.mutate({
      transaction_date: addDate,
      vendor: addVendor,
      amount,
      category: addCategory,
      account_source: addAccount,
      entity: addEntity,
      company_type: companyType,
      notes: addMemo,
    });
    setShowAddDialog(false);
    setAddDate(""); setAddVendor(""); setAddAmount(""); setAddCategory("Uncategorized"); setAddEntity("Unassigned"); setAddMemo("");
  }

  const setIncomeField = (key: keyof IncomeFormState, value: string) => {
    setIncomeForm((p) => {
      const updated = { ...p, [key]: value };
      if (key === "company" && value) {
        updated.income_type = getCompanyType(value);
      }
      return updated;
    });
  };

  const calculateTaxSuggestion = (paycheckAmount: number) => {
    if (!taxSettings) return 0;
    const existingIncome = (incomeEntries || []).reduce((s, e) => s + Number(e.paycheck_amount), 0);
    const existingWithheld = (incomeEntries || []).reduce((s, e) => s + Number(e.taxes_withheld), 0);
    const existingDeductions = (incomeEntries || []).reduce((s, e) => s + Number(e.pre_tax_deductions) + Number(e.retirement_401k), 0);
    const totalAnnualIncome = existingIncome + paycheckAmount;
    const taxableIncomeCalc = totalAnnualIncome - existingDeductions;
    const federalTax = taxableIncomeCalc * (taxSettings.federalRate / 100);
    const remaining = Math.max(0, federalTax - existingWithheld);
    const proportion = paycheckAmount / totalAnnualIncome;
    return remaining * proportion;
  };

  function submitIncome() {
    if (!incomeForm.name.trim() || !incomeForm.company.trim()) return;
    if (num(incomeForm.paycheck_amount) <= 0 && num(incomeForm.deposited_amount) <= 0) return;
    const paycheckAmt = num(incomeForm.paycheck_amount) || computedPaycheck;
    const payload: Partial<IncomeEntry> = {
      name: incomeForm.name,
      company: incomeForm.company,
      income_type: incomeForm.income_type,
      income_date: incomeForm.income_date,
      paycheck_amount: paycheckAmt,
      deposited_amount: num(incomeForm.deposited_amount),
      taxes_withheld: num(incomeForm.taxes_withheld),
      pre_tax_deductions: num(incomeForm.pre_tax_deductions),
      retirement_401k: num(incomeForm.retirement_401k),
      notes: incomeForm.notes,
    };
    addIncomeMutation.mutate(payload, {
      onSuccess: () => {
        const withheld = num(incomeForm.taxes_withheld);
        const type = incomeForm.income_type;
        if ((type === "1099" || type === "K1") && withheld === 0) {
          const suggestion = calculateTaxSuggestion(paycheckAmt);
          if (suggestion > 0) {
            setTaxSuggestion({ amount: suggestion, paycheck: paycheckAmt });
          }
        }
        setShowIncomeDialog(false);
        setIncomeForm(emptyIncomeForm);
      },
    });
  }

  function exportCSV() {
    const headers = ["Date", "Description", "Amount", "Type", "Category", "Company", "Notes"];
    const rows = filtered.map((t) => [t.transaction_date, t.vendor, t.amount, t.transaction_type || "expense", t.category, t.entity, t.notes || ""]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "transactions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  function CompanyDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="Unassigned">Unassigned</SelectItem>
          {companyOptions.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
        </SelectContent>
      </Select>
    );
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading transactions…</div>;
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 max-w-5xl mx-auto">
        {/* Type filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {([
            { value: "all" as const, label: "All" },
            { value: "income" as const, label: "Income" },
            { value: "expense" as const, label: "Expenses" },
          ] as const).map((tab) => (
            <Button
              key={tab.value}
              variant={filterType === tab.value ? "default" : "outline"}
              size="sm"
              onClick={() => setFilterType(tab.value)}
            >
              {tab.label}
              {tab.value !== "all" && (
                <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5">
                  {transactions.filter((t) => (t.transaction_type || "expense") === tab.value).length}
                </Badge>
              )}
            </Button>
          ))}
        </div>

        {/* Search & actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)} className="gap-2">
            <SlidersHorizontal className="h-4 w-4" /> Filters
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Expense
          </Button>
          <Button size="sm" onClick={() => { setIncomeForm(emptyIncomeForm); setShowIncomeDialog(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Income
          </Button>
        </div>

        {/* Advanced filters (hidden by default) */}
        {showFilters && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 rounded-xl border border-border p-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
              <Select value={filterCompany} onValueChange={setFilterCompany}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">From</Label>
              <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">To</Label>
              <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
          </div>
        )}

        {/* Transaction table — simplified columns */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-card-foreground">
              {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
            </h3>
          </div>

          {/* Header */}
          <div className="hidden lg:grid lg:grid-cols-[90px_1fr_90px_100px_100px_44px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
            <span>Date</span>
            <span>Description</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Tax Hold</span>
            <span className="text-right">Withheld</span>
            <span></span>
          </div>

          <div className="divide-y divide-border">
            {filtered.map((tx) => {
              const isIncome = tx.transaction_type === "income";
              const recWithholding = (tx as any).recommended_withholding || 0;
              const actualWithholding = (tx as any).actual_withholding || 0;
              const hasActual = actualWithholding > 0;
              const rowBg = isIncome && recWithholding > 0
                ? hasActual
                  ? "bg-green-50/50 dark:bg-green-950/10"
                  : "bg-red-50/50 dark:bg-red-950/10"
                : "";

              return (
                <div
                  key={tx.id}
                  className={`flex flex-col lg:grid lg:grid-cols-[90px_1fr_90px_100px_100px_44px] gap-1 lg:gap-2 px-5 py-3 hover:bg-muted/50 transition-colors items-center ${rowBg}`}
                >
                  <span className="text-xs text-muted-foreground">{tx.transaction_date}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                      {(tx.transaction_type || "expense")}
                    </Badge>
                    <span className="text-sm font-medium text-card-foreground truncate">{tx.vendor}</span>
                  </div>
                  <span className={`text-sm font-semibold tabular-nums text-right ${tx.amount >= 0 ? "text-success" : "text-destructive"}`}>
                    {fmt(tx.amount)}
                  </span>
                  {/* Tax Hold — red */}
                  <span className={`text-sm tabular-nums text-right ${isIncome && recWithholding > 0 ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}`}>
                    {isIncome && recWithholding > 0 ? fmt(recWithholding) : "—"}
                  </span>
                  {/* Actual — green */}
                  <span className={`text-sm tabular-nums text-right ${hasActual ? "text-green-600 dark:text-green-400 font-medium" : "text-muted-foreground"}`}>
                    {isIncome && recWithholding > 0 ? (hasActual ? fmt(actualWithholding) : "—") : "—"}
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
              <div className="px-5 py-12 text-center text-muted-foreground text-sm">No transactions found.</div>
            )}
          </div>
        </div>

        {/* ═══════ DIALOGS ═══════ */}

        {/* Edit dialog */}
        <Dialog open={!!editTx} onOpenChange={(open) => !open && setEditTx(null)}>
          <DialogContent className={isEditingIncome ? "max-w-2xl" : undefined}>
            <DialogHeader>
              <DialogTitle>{isEditingIncome ? "Edit Income" : "Edit Transaction"}</DialogTitle>
            </DialogHeader>
            {editTx && isEditingIncome ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Name *</Label>
                    <Input placeholder="e.g. ED Shift" value={editIncomeForm.name} onChange={(e) => setEditIncomeField("name", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Company *</Label>
                    <Select value={editIncomeForm.company} onValueChange={(v) => setEditIncomeField("company", v)}>
                      <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                      <SelectContent>
                        {allCompanyNames.map((c) => (
                          <SelectItem key={c} value={c}>{c} ({getCompanyType(c)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                    <Select value={editIncomeForm.income_type} onValueChange={(v) => setEditIncomeField("income_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {INCOME_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Date *</Label>
                    <Input type="date" value={editIncomeForm.income_date} onChange={(e) => setEditIncomeField("income_date", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Amount *</Label>
                    <Input type="number" min="0" step="0.01" value={editIncomeForm.paycheck_amount} onChange={(e) => setEditIncomeField("paycheck_amount", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Net Deposit</Label>
                    <Input type="number" min="0" step="0.01" value={editIncomeForm.deposited_amount} onChange={(e) => setEditIncomeField("deposited_amount", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Taxes Withheld</Label>
                    <Input type="number" min="0" step="0.01" value={editIncomeForm.taxes_withheld} onChange={(e) => setEditIncomeField("taxes_withheld", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Pre-Tax Deductions</Label>
                    <Input type="number" min="0" step="0.01" value={editIncomeForm.pre_tax_deductions} onChange={(e) => setEditIncomeField("pre_tax_deductions", e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Retirement (401k)</Label>
                    <Input type="number" min="0" step="0.01" value={editIncomeForm.retirement_401k} onChange={(e) => setEditIncomeField("retirement_401k", e.target.value)} />
                  </div>
                </div>

                {editHasMismatch && (
                  <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>Gross ({fmt(editEnteredPaycheck)}) ≠ Net + Withheld + Deductions ({fmt(editComputedPaycheck)})</span>
                  </div>
                )}

                {editGrossIncome > 0 && (
                  <div className="rounded-md border border-border px-3 py-2 space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground">Summary</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                      <span className="text-muted-foreground">Gross</span>
                      <span className="text-right font-medium">{fmt(editGrossIncome)}</span>
                      <span className="text-muted-foreground font-semibold border-t border-border pt-0.5 mt-0.5">Taxable</span>
                      <span className="text-right font-bold border-t border-border pt-0.5 mt-0.5">{fmt(editTaxableIncome)}</span>
                      {editNetIncome > 0 && (
                        <>
                          <span className="text-muted-foreground">Net Deposit</span>
                          <span className="text-right">{fmt(editNetIncome)}</span>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Withholding tracking */}
                {(editTx as any).recommended_withholding > 0 && (
                  <div className="rounded-md border border-border p-3 space-y-3">
                    <div className="flex items-center gap-2 text-sm">
                      <DollarSign className="h-4 w-4 text-red-500" />
                      <span className="text-muted-foreground">Recommended:</span>
                      <span className="font-semibold text-red-600 dark:text-red-400">{fmt((editTx as any).recommended_withholding)}</span>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Actual Amount Withheld</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder={`e.g. ${fmt((editTx as any).recommended_withholding)}`}
                        value={editActualWithholding === "0" ? "" : editActualWithholding}
                        onChange={(e) => setEditActualWithholding(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                  <Input placeholder="Optional" value={editIncomeForm.notes} onChange={(e) => setEditIncomeField("notes", e.target.value)} />
                </div>

                <div className="flex justify-between">
                  <Button variant="destructive" size="sm" onClick={() => confirmDelete(editTx.id)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setEditTx(null)}>Cancel</Button>
                    <Button onClick={saveEdit} disabled={!editIncomeForm.name.trim() || !editIncomeForm.company.trim()}>Save</Button>
                  </div>
                </div>
              </div>
            ) : editTx ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                    <Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Vendor</Label>
                    <Input value={editVendor} onChange={(e) => setEditVendor(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Amount</Label>
                    <Input type="number" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                    <Select value={editCategory} onValueChange={setEditCategory}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
                  <CompanyDropdown value={editEntity} onChange={setEditEntity} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                  <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} rows={2} />
                </div>
                <div className="flex justify-between">
                  <Button variant="destructive" size="sm" onClick={() => confirmDelete(editTx.id)}>
                    <Trash2 className="h-4 w-4 mr-1" /> Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setEditTx(null)}>Cancel</Button>
                    <Button onClick={saveEdit}>Save</Button>
                  </div>
                </div>
              </div>
            ) : null}
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

        {/* Add Expense dialog */}
        <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Expense</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Date *</Label>
                  <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Vendor *</Label>
                  <Input value={addVendor} onChange={(e) => setAddVendor(e.target.value)} placeholder="Vendor name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Amount *</Label>
                  <Input type="number" step="0.01" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="-50.00" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                  <Select value={addCategory} onValueChange={setAddCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
                <CompanyDropdown value={addEntity} onChange={setAddEntity} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                <Textarea value={addMemo} onChange={(e) => setAddMemo(e.target.value)} rows={2} placeholder="Optional" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={addTransaction}>Add</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Add Income dialog */}
        <Dialog open={showIncomeDialog} onOpenChange={setShowIncomeDialog}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Add Income</DialogTitle></DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Name *</Label>
                  <Input placeholder="e.g. ED Shift" value={incomeForm.name} onChange={(e) => setIncomeField("name", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company *</Label>
                  <Select value={incomeForm.company} onValueChange={(v) => setIncomeField("company", v)}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {allCompanyNames.map((c) => (
                        <SelectItem key={c} value={c}>{c} ({getCompanyType(c)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                  <Select value={incomeForm.income_type} onValueChange={(v) => setIncomeField("income_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {INCOME_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Date *</Label>
                  <Input type="date" value={incomeForm.income_date} onChange={(e) => setIncomeField("income_date", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Amount *</Label>
                  <Input type="number" min="0" step="0.01" value={incomeForm.paycheck_amount} onChange={(e) => setIncomeField("paycheck_amount", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Net Deposit</Label>
                  <Input type="number" min="0" step="0.01" value={incomeForm.deposited_amount} onChange={(e) => setIncomeField("deposited_amount", e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Taxes Withheld</Label>
                  <Input type="number" min="0" step="0.01" value={incomeForm.taxes_withheld} onChange={(e) => setIncomeField("taxes_withheld", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Pre-Tax Deductions</Label>
                  <Input type="number" min="0" step="0.01" value={incomeForm.pre_tax_deductions} onChange={(e) => setIncomeField("pre_tax_deductions", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Retirement (401k)</Label>
                  <Input type="number" min="0" step="0.01" value={incomeForm.retirement_401k} onChange={(e) => setIncomeField("retirement_401k", e.target.value)} />
                </div>
              </div>

              {hasMismatch && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Gross ({fmt(enteredPaycheck)}) ≠ Net + Withheld + Deductions ({fmt(computedPaycheck)})</span>
                </div>
              )}

              {grossIncome > 0 && (
                <div className="rounded-md border border-border px-3 py-2 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">Summary</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-muted-foreground">Gross</span>
                    <span className="text-right font-medium">{fmt(grossIncome)}</span>
                    <span className="text-muted-foreground font-semibold border-t border-border pt-0.5 mt-0.5">Taxable</span>
                    <span className="text-right font-bold border-t border-border pt-0.5 mt-0.5">{fmt(taxableIncome)}</span>
                    {netIncome > 0 && (
                      <>
                        <span className="text-muted-foreground">Net Deposit</span>
                        <span className="text-right">{fmt(netIncome)}</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                <Input placeholder="Optional" value={incomeForm.notes} onChange={(e) => setIncomeField("notes", e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowIncomeDialog(false)}>Cancel</Button>
                <Button onClick={submitIncome} disabled={!incomeForm.name.trim() || !incomeForm.company.trim()}>Save Income</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

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
                <p className="text-sm text-muted-foreground">
                  Consider setting aside this amount for taxes:
                </p>
                <p className="text-3xl font-bold text-primary text-center py-2">
                  {fmt(taxSuggestion.amount)}
                </p>
                <p className="text-sm text-muted-foreground text-center">
                  from this {fmt(taxSuggestion.paycheck)} income
                </p>
              </div>
            )}
            <DialogFooter>
              <Button onClick={() => setTaxSuggestion(null)}>Got it</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
