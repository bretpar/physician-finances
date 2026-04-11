import { useState, useMemo } from "react";
import { categories, accounts, PERSONAL_CATEGORY } from "@/lib/mockData";
import { useTransactions, useDeleteTransaction, useAddTransaction, useUpdateTransaction, type DbTransaction, type TransactionType } from "@/hooks/useTransactions";
import { useAddIncome, type IncomeEntry } from "@/hooks/useIncome";
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
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, SlidersHorizontal, Plus, Trash2, Download, DollarSign, AlertTriangle, PiggyBank, Info, MoreHorizontal, Copy, Pencil, RefreshCw, Repeat, ShieldCheck, ShieldAlert } from "lucide-react";
import ExpenseSummaryWidgets from "@/components/ExpenseSummaryWidgets";
import { useExpenseSummary } from "@/hooks/useExpenseSummary";
import { useCompanies } from "@/contexts/CompanyContext";
import { ACCOUNT_TYPES } from "@/hooks/useRetirementContributions";
import { toast } from "sonner";

const INCOME_TYPES = ["W2", "1099", "K1"];
const RECURRING_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

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

type DateOption = "original" | "today" | "custom";

function getNextOccurrenceDate(baseDate: string, frequency: string): string {
  const d = new Date(baseDate + "T00:00:00");
  switch (frequency) {
    case "weekly": d.setDate(d.getDate() + 7); break;
    case "biweekly": d.setDate(d.getDate() + 14); break;
    case "monthly": d.setMonth(d.getMonth() + 1); break;
    case "quarterly": d.setMonth(d.getMonth() + 3); break;
    case "yearly": d.setFullYear(d.getFullYear() + 1); break;
  }
  return d.toISOString().split("T")[0];
}

export default function Transactions() {
  const { companies } = useCompanies();
  const { data: transactions = [], isLoading } = useTransactions();
  const deleteMutation = useDeleteTransaction();
  const addMutation = useAddTransaction();
  const updateMutation = useUpdateTransaction();
  const addIncomeMutation = useAddIncome();
  const { data: incomeEntries } = useIncomeEntries();
  const { data: taxSettings } = useTaxSettings();

  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterCompanyType, setFilterCompanyType] = useState("all");
  const [filterQuick, setFilterQuick] = useState("all");
  const [filterType, setFilterType] = useState<"all" | TransactionType>("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Edit dialog
  const [editTx, setEditTx] = useState<DbTransaction | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editVendor, setEditVendor] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editEntity, setEditEntity] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editIsRecurring, setEditIsRecurring] = useState(false);
  const [editRecurringFreq, setEditRecurringFreq] = useState("monthly");
  const [editWithholdingSaved, setEditWithholdingSaved] = useState(false);

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

  // Duplicate dialog
  const [dupTx, setDupTx] = useState<DbTransaction | null>(null);
  const [dupDateOption, setDupDateOption] = useState<DateOption>("original");
  const [dupCustomDate, setDupCustomDate] = useState("");

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
  const enteredPaycheck = num(incomeForm.paycheck_amount);
  const hasMismatch = incomeForm.paycheck_amount !== "" && incomeForm.deposited_amount !== "" && Math.abs(enteredPaycheck - computedPaycheck) > 0.01;

  const grossIncome = num(incomeForm.paycheck_amount) || computedPaycheck;
  const retirementContrib = num(incomeForm.retirement_401k);
  const preTaxDed = num(incomeForm.pre_tax_deductions);
  const taxableIncome = Math.max(0, grossIncome - retirementContrib - preTaxDed);
  const netIncome = num(incomeForm.deposited_amount);

  const getCompanyType = (companyName: string) => {
    const c = companies.find((co) => co.name === companyName);
    return c?.companyType || "1099";
  };

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.vendor.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterType !== "all" && (t.transaction_type || "expense") !== filterType) return false;
      if (filterCategory !== "all" && t.category !== filterCategory) return false;
      if (filterAccount !== "all" && t.account_source !== filterAccount) return false;
      if (filterCompany !== "all" && t.entity !== filterCompany) return false;
      if (filterCompanyType !== "all" && (t.company_type || "Unassigned") !== filterCompanyType) return false;
      if (filterQuick === "uncategorized" && t.category !== "Uncategorized") return false;
      if (filterQuick === "personal" && t.category !== PERSONAL_CATEGORY) return false;
      if (filterQuick === "unassigned" && t.entity !== "Unassigned") return false;
      if (filterDateFrom && t.transaction_date < filterDateFrom) return false;
      if (filterDateTo && t.transaction_date > filterDateTo) return false;
      return true;
    });
  }, [transactions, search, filterType, filterCategory, filterAccount, filterCompany, filterCompanyType, filterQuick, filterDateFrom, filterDateTo]);

  const summary = useExpenseSummary(transactions, companies);

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
    setEditIsRecurring((tx as any).is_recurring || false);
    setEditRecurringFreq((tx as any).recurring_frequency || "monthly");
  }

  function saveEdit() {
    if (!editTx) return;
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
      is_recurring: editIsRecurring,
      recurring_frequency: editIsRecurring ? editRecurringFreq : null,
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

  // Duplicate flow
  function openDuplicate(tx: DbTransaction) {
    setDupTx(tx);
    setDupDateOption("original");
    setDupCustomDate(new Date().toISOString().split("T")[0]);
  }

  function executeDuplicate() {
    if (!dupTx) return;
    let date = dupTx.transaction_date;
    if (dupDateOption === "today") date = new Date().toISOString().split("T")[0];
    else if (dupDateOption === "custom") date = dupCustomDate;

    addMutation.mutate({
      transaction_date: date,
      vendor: dupTx.vendor,
      amount: dupTx.amount,
      category: dupTx.category,
      account_source: dupTx.account_source,
      entity: dupTx.entity,
      company_type: dupTx.company_type,
      notes: dupTx.notes || "",
    }, {
      onSuccess: () => {
        toast.success("Transaction duplicated");
        setDupTx(null);
      },
    });
  }

  // Generate recurring occurrences
  function generateRecurring(tx: DbTransaction) {
    const freq = (tx as any).recurring_frequency;
    if (!freq) return;
    const nextDate = getNextOccurrenceDate(tx.transaction_date, freq);
    addMutation.mutate({
      transaction_date: nextDate,
      vendor: tx.vendor,
      amount: tx.amount,
      category: tx.category,
      account_source: tx.account_source,
      entity: tx.entity,
      company_type: tx.company_type,
      notes: tx.notes || "",
    }, {
      onSuccess: () => toast.success(`Next ${freq} occurrence created for ${nextDate}`),
    });
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
    const headers = ["Date", "Vendor", "Amount", "Category", "Account", "Company", "Company Type", "Notes"];
    const rows = filtered.map((t) => [t.transaction_date, t.vendor, t.amount, t.category, t.account_source, t.entity, t.company_type || "", t.notes || ""]);
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

  function getRetirementBadge(tx: DbTransaction) {
    const linked = incomeByLinkedTx.get(tx.id);
    if (linked && Number(linked.retirement_401k) > 0) {
      return { amount: Number(linked.retirement_401k), type: "401k" };
    }
    if (!incomeEntries || tx.amount <= 0) return null;
    const match = incomeEntries.find(
      (ie) =>
        ie.income_date === tx.transaction_date &&
        Math.abs(Number(ie.deposited_amount) - tx.amount) < 1 &&
        Number(ie.retirement_401k) > 0
    );
    if (match) return { amount: Number(match.retirement_401k), type: "401k" };
    return null;
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading transactions…</div>;
  }

  return (
    <TooltipProvider>
      <div className="space-y-4 max-w-7xl mx-auto">
        <ExpenseSummaryWidgets {...summary} />

        {/* Type filter tabs */}
        <div className="flex gap-2 flex-wrap">
          {([
            { value: "all" as const, label: "All" },
            { value: "income" as const, label: "Income" },
            { value: "expense" as const, label: "Expenses" },
            { value: "deduction" as const, label: "Deductions" },
            { value: "stock" as const, label: "Stocks" },
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
            <Input placeholder="Search transactions…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)} className="gap-2">
            <SlidersHorizontal className="h-4 w-4" /> Filters
          </Button>
          <Button variant="outline" onClick={exportCSV} className="gap-2">
            <Download className="h-4 w-4" /> CSV
          </Button>
          <Button variant="outline" onClick={() => setShowAddDialog(true)} className="gap-2">
            <Plus className="h-4 w-4" /> Add Expense
          </Button>
          <Button onClick={() => { setIncomeForm(emptyIncomeForm); setShowIncomeDialog(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Add Income
          </Button>
        </div>

        {showFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 glass-card rounded-xl p-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
              <Select value={filterCategory} onValueChange={setFilterCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
              <Select value={filterCompany} onValueChange={setFilterCompany}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Companies</SelectItem>
                  <SelectItem value="Unassigned">Unassigned</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.name}>{c.name} ({c.companyType})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company Type</Label>
              <Select value={filterCompanyType} onValueChange={setFilterCompanyType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="1099">1099</SelectItem>
                  <SelectItem value="W2">W2</SelectItem>
                  <SelectItem value="K1">K1</SelectItem>
                  <SelectItem value="Unassigned">Unassigned</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Account</Label>
              <Select value={filterAccount} onValueChange={setFilterAccount}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {accounts.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Quick Filter</Label>
              <Select value={filterQuick} onValueChange={setFilterQuick}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="uncategorized">Uncategorized Only</SelectItem>
                  <SelectItem value="personal">Personal Only</SelectItem>
                  <SelectItem value="unassigned">Unassigned Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">From Date</Label>
              <Input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">To Date</Label>
              <Input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
          </div>
        )}

        {/* Spreadsheet-style table */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h3 className="text-sm font-semibold text-card-foreground">
              {filtered.length} transaction{filtered.length !== 1 ? "s" : ""}
            </h3>
          </div>

          {/* Header row - desktop */}
          <div className="hidden lg:grid lg:grid-cols-[100px_1fr_100px_140px_160px_1fr_50px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
            <span>Date</span>
            <span>Vendor</span>
            <span className="text-right">Amount</span>
            <span>Category</span>
            <span>Company</span>
            <span>Notes</span>
            <span></span>
          </div>

          <div className="divide-y divide-border">
            {filtered.map((tx) => {
              const retBadge = getRetirementBadge(tx);
              const isRecurring = (tx as any).is_recurring;
              return (
                <div
                  key={tx.id}
                  className="flex flex-col lg:grid lg:grid-cols-[100px_1fr_100px_140px_160px_1fr_50px] gap-1 lg:gap-2 px-5 py-3 hover:bg-muted/50 transition-colors items-center"
                >
                  <span className="text-xs text-muted-foreground">{tx.transaction_date}</span>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                      {(tx.transaction_type || "expense")}
                    </Badge>
                    <span className="text-sm font-medium text-card-foreground truncate">{tx.vendor}</span>
                    {isRecurring && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="gap-1 shrink-0 text-[10px]">
                            <Repeat className="h-3 w-3" />
                            {(tx as any).recurring_frequency}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Recurring {(tx as any).recurring_frequency} transaction</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                    {retBadge && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="gap-1 shrink-0 bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400 dark:border-blue-800 text-[10px]">
                            <PiggyBank className="h-3 w-3" />
                            401(k) {fmt(retBadge.amount)}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Includes pre-tax retirement contribution of {fmt(retBadge.amount)}.</p>
                          <p className="text-xs text-muted-foreground">This reduces taxable income and withholding estimates.</p>
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <span className={`text-sm font-semibold tabular-nums text-right ${tx.amount >= 0 ? "text-success" : "text-destructive"}`}>
                    {fmt(tx.amount)}
                  </span>
                  <Badge
                    variant={tx.category === PERSONAL_CATEGORY ? "destructive" : tx.category === "Uncategorized" ? "outline" : "default"}
                    className="text-xs w-fit"
                  >
                    {tx.category}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {tx.entity}{tx.company_type ? ` (${tx.company_type})` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground italic truncate">{tx.notes}</span>

                  {/* Three-dot menu */}
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
                      <DropdownMenuItem onClick={() => openDuplicate(tx)}>
                        <Copy className="h-4 w-4 mr-2" /> Duplicate
                      </DropdownMenuItem>
                      {isRecurring && (
                        <DropdownMenuItem onClick={() => generateRecurring(tx)}>
                          <RefreshCw className="h-4 w-4 mr-2" /> Generate Next
                        </DropdownMenuItem>
                      )}
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

        {/* Edit dialog */}
        <Dialog open={!!editTx} onOpenChange={(open) => !open && setEditTx(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Transaction</DialogTitle></DialogHeader>
            {editTx && (
              <div className="space-y-4">
                {(() => {
                  const retBadge = getRetirementBadge(editTx);
                  if (!retBadge) return null;
                  return (
                    <div className="flex items-center gap-2 rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
                      <PiggyBank className="h-4 w-4 shrink-0" />
                      <span>Includes pre-tax retirement contribution of {fmt(retBadge.amount)} — this reduces taxable income and withholding estimates.</span>
                    </div>
                  );
                })()}
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
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company / Entity</Label>
                  <CompanyDropdown value={editEntity} onChange={setEditEntity} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                  <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} rows={3} />
                </div>

                {/* Recurring toggle */}
                <div className="rounded-md border border-border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Repeat className="h-4 w-4 text-muted-foreground" />
                      <Label className="text-sm font-medium">Repeat this transaction</Label>
                    </div>
                    <Switch checked={editIsRecurring} onCheckedChange={setEditIsRecurring} />
                  </div>
                  {editIsRecurring && (
                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">Frequency</Label>
                      <Select value={editRecurringFreq} onValueChange={setEditRecurringFreq}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {RECURRING_FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="flex justify-between">
                  <Button variant="destructive" onClick={() => confirmDelete(editTx.id)} className="gap-2">
                    <Trash2 className="h-4 w-4" /> Delete
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setEditTx(null)}>Cancel</Button>
                    <Button onClick={saveEdit}>Save</Button>
                  </div>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Duplicate confirmation dialog */}
        <Dialog open={!!dupTx} onOpenChange={(open) => !open && setDupTx(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Copy className="h-5 w-5 text-primary" /> Duplicate Transaction
              </DialogTitle>
            </DialogHeader>
            {dupTx && (
              <div className="space-y-4">
                <div className="rounded-md border border-border p-3 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vendor</span>
                    <span className="font-medium">{dupTx.vendor}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="font-medium">{fmt(dupTx.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Category</span>
                    <span className="font-medium">{dupTx.category}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium">Select date for duplicated transaction *</Label>
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dupDate" checked={dupDateOption === "original"} onChange={() => setDupDateOption("original")} className="accent-primary" />
                      <span className="text-sm">Same date ({dupTx.transaction_date})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dupDate" checked={dupDateOption === "today"} onChange={() => setDupDateOption("today")} className="accent-primary" />
                      <span className="text-sm">Today ({new Date().toISOString().split("T")[0]})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="dupDate" checked={dupDateOption === "custom"} onChange={() => setDupDateOption("custom")} className="accent-primary" />
                      <span className="text-sm">Custom date</span>
                    </label>
                    {dupDateOption === "custom" && (
                      <Input type="date" value={dupCustomDate} onChange={(e) => setDupCustomDate(e.target.value)} className="ml-6 w-fit" />
                    )}
                  </div>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setDupTx(null)}>Cancel</Button>
              <Button onClick={executeDuplicate} disabled={dupDateOption === "custom" && !dupCustomDate}>
                <Copy className="h-4 w-4 mr-2" /> Confirm Duplicate
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTxId} onOpenChange={(open) => !open && setDeleteTxId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Transaction</AlertDialogTitle>
              <AlertDialogDescription>This will permanently remove this transaction from all calculations and reports.</AlertDialogDescription>
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
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Amount (negative for expense) *</Label>
                  <Input type="number" step="0.01" value={addAmount} onChange={(e) => setAddAmount(e.target.value)} placeholder="-50.00" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Account</Label>
                  <Select value={addAccount} onValueChange={setAddAccount}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{accounts.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                  <Select value={addCategory} onValueChange={setAddCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company / Entity</Label>
                  <CompanyDropdown value={addEntity} onChange={setAddEntity} />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                <Textarea value={addMemo} onChange={(e) => setAddMemo(e.target.value)} rows={2} placeholder="Optional notes…" />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
                <Button onClick={addTransaction}>Add Expense</Button>
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
                  <Input placeholder="e.g. ED Shift, K1 Distribution" value={incomeForm.name} onChange={(e) => setIncomeField("name", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Company *</Label>
                  <Select value={incomeForm.company} onValueChange={(v) => setIncomeField("company", v)}>
                    <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                    <SelectContent>
                      {allCompanyNames.map((c) => (
                        <SelectItem key={c} value={c}>{c} ({getCompanyType(c)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Income Type</Label>
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
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Total Paycheck (Gross) *</Label>
                  <Input type="number" min="0" step="0.01" placeholder="Gross amount" value={incomeForm.paycheck_amount} onChange={(e) => setIncomeField("paycheck_amount", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Deposited Amount (Net)</Label>
                  <Input type="number" min="0" step="0.01" placeholder="Net deposit" value={incomeForm.deposited_amount} onChange={(e) => setIncomeField("deposited_amount", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">
                    Taxes Withheld {incomeForm.income_type === "W2" && <span className="text-primary">(expected)</span>}
                  </Label>
                  <Input type="number" min="0" step="0.01" placeholder="0" value={incomeForm.taxes_withheld} onChange={(e) => setIncomeField("taxes_withheld", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Pre-Tax Deductions</Label>
                  <Input type="number" min="0" step="0.01" placeholder="Healthcare, insurance…" value={incomeForm.pre_tax_deductions} onChange={(e) => setIncomeField("pre_tax_deductions", e.target.value)} />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Label className="text-xs text-muted-foreground">Retirement Contribution (Pre-Tax)</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-xs">Pre-tax retirement contributions (401k, 403b, etc.) reduce your taxable income and withholding estimates. This amount syncs to the Deductions tab automatically.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  <Input type="number" min="0" step="0.01" placeholder="0" value={incomeForm.retirement_401k} onChange={(e) => setIncomeField("retirement_401k", e.target.value)} />
                </div>
              </div>

              {num(incomeForm.retirement_401k) > 0 && (
                <div className="flex items-center gap-3 rounded-md bg-blue-50 dark:bg-blue-950/30 px-3 py-2">
                  <PiggyBank className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                      Pre-tax retirement contribution of {fmt(retirementContrib)} will reduce taxable income
                    </p>
                    <p className="text-[10px] text-blue-600/70 dark:text-blue-500/70">
                      Automatically synced to Deductions → Retirement Contributions
                    </p>
                  </div>
                  <Select value={incomeForm.retirement_account_type} onValueChange={(v) => setIncomeField("retirement_account_type", v)}>
                    <SelectTrigger className="w-[140px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {hasMismatch && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    Total Paycheck ({fmt(enteredPaycheck)}) ≠ Deposited + Withheld + Deductions + 401k ({fmt(computedPaycheck)})
                  </span>
                </div>
              )}

              {(grossIncome > 0) && (
                <div className="rounded-md border border-border px-3 py-2 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground">Income Breakdown</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                    <span className="text-muted-foreground">Gross Income</span>
                    <span className="text-right font-medium">{fmt(grossIncome)}</span>
                    {retirementContrib > 0 && (
                      <>
                        <span className="text-blue-600 dark:text-blue-400">− Pre-Tax Retirement</span>
                        <span className="text-right text-blue-600 dark:text-blue-400">−{fmt(retirementContrib)}</span>
                      </>
                    )}
                    {preTaxDed > 0 && (
                      <>
                        <span className="text-muted-foreground">− Other Pre-Tax</span>
                        <span className="text-right">−{fmt(preTaxDed)}</span>
                      </>
                    )}
                    <span className="text-muted-foreground font-semibold border-t border-border pt-0.5 mt-0.5">Taxable Income</span>
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
                <Input placeholder="Optional notes" value={incomeForm.notes} onChange={(e) => setIncomeField("notes", e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShowIncomeDialog(false)}>Cancel</Button>
                <Button onClick={submitIncome} disabled={!incomeForm.name.trim() || !incomeForm.company.trim()}>
                  Save Income
                </Button>
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
                  Based on your current projected income and deductions, you should set aside:
                </p>
                <p className="text-3xl font-bold text-primary text-center py-2">
                  {fmt(taxSuggestion.amount)}
                </p>
                <p className="text-sm text-muted-foreground text-center">
                  from this {fmt(taxSuggestion.paycheck)} income for taxes.
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
