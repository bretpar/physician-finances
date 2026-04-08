import { useState, useMemo } from "react";
import { mockTransactions, categories, accounts, PERSONAL_CATEGORY, type Transaction } from "@/lib/mockData";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Search, SlidersHorizontal, Plus, Trash2, Download } from "lucide-react";
import ExpenseSummaryWidgets from "@/components/ExpenseSummaryWidgets";
import { useExpenseSummary } from "@/hooks/useExpenseSummary";
import { useCompanies } from "@/contexts/CompanyContext";

export default function Transactions() {
  const { companies } = useCompanies();
  const [transactions, setTransactions] = useState<Transaction[]>(mockTransactions);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [filterCompany, setFilterCompany] = useState("all");
  const [filterCompanyType, setFilterCompanyType] = useState("all");
  const [filterQuick, setFilterQuick] = useState("all");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Edit dialog
  const [editTx, setEditTx] = useState<Transaction | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editVendor, setEditVendor] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editEntity, setEditEntity] = useState("");
  const [editMemo, setEditMemo] = useState("");
  const [editTaxWithheld, setEditTaxWithheld] = useState(0);

  // Delete
  const [deleteTxId, setDeleteTxId] = useState<string | null>(null);

  // Add dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addDate, setAddDate] = useState("");
  const [addVendor, setAddVendor] = useState("");
  const [addAmount, setAddAmount] = useState("");
  const [addCategory, setAddCategory] = useState("Uncategorized");
  const [addAccount, setAddAccount] = useState(accounts[0]);
  const [addEntity, setAddEntity] = useState("Unassigned");
  const [addMemo, setAddMemo] = useState("");

  // W-2 dialog
  const [showW2Dialog, setShowW2Dialog] = useState(false);
  const [w2Date, setW2Date] = useState("");
  const [w2Employer, setW2Employer] = useState("");
  const [w2Company, setW2Company] = useState("Unassigned");
  const [w2GrossPay, setW2GrossPay] = useState("");
  const [w2FedWithheld, setW2FedWithheld] = useState("");
  const [w2StateWithheld, setW2StateWithheld] = useState("");
  const [w2Memo, setW2Memo] = useState("");

  const companyOptions = useMemo(() => {
    return companies.map((c) => ({ label: `${c.name} (${c.companyType})`, value: c.name, type: c.companyType }));
  }, [companies]);

  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (search && !t.merchant.toLowerCase().includes(search.toLowerCase())) return false;
      if (filterCategory !== "all" && t.category !== filterCategory) return false;
      if (filterAccount !== "all" && t.account !== filterAccount) return false;
      if (filterCompany !== "all" && t.entity !== filterCompany) return false;
      if (filterCompanyType !== "all" && (t.companyType || "Unassigned") !== filterCompanyType) return false;
      if (filterQuick === "uncategorized" && t.category !== "Uncategorized") return false;
      if (filterQuick === "personal" && t.category !== PERSONAL_CATEGORY) return false;
      if (filterQuick === "unassigned" && t.entity !== "Unassigned") return false;
      if (filterDateFrom && t.date < filterDateFrom) return false;
      if (filterDateTo && t.date > filterDateTo) return false;
      return true;
    });
  }, [transactions, search, filterCategory, filterAccount, filterCompany, filterCompanyType, filterQuick, filterDateFrom, filterDateTo]);

  const summary = useExpenseSummary(transactions, companies);

  const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  function getCompanyTypeForEntity(entityName: string) {
    return companies.find((c) => c.name === entityName)?.companyType;
  }

  function openEdit(tx: Transaction) {
    setEditTx(tx);
    setEditDate(tx.date);
    setEditVendor(tx.merchant);
    setEditAmount(String(tx.amount));
    setEditCategory(tx.category);
    setEditEntity(tx.entity);
    setEditMemo(tx.memo);
    setEditTaxWithheld(tx.taxWithheld || 0);
  }

  function saveEdit() {
    if (!editTx) return;
    const newAmount = parseFloat(editAmount) || editTx.amount;
    const isPersonal = editCategory === PERSONAL_CATEGORY;
    const companyType = getCompanyTypeForEntity(editEntity);
    setTransactions((prev) =>
      prev.map((t) =>
        t.id === editTx.id
          ? {
              ...t,
              date: editDate || t.date,
              merchant: editVendor || t.merchant,
              amount: newAmount,
              category: editCategory,
              entity: editEntity,
              companyType,
              memo: editMemo,
              deductible: !isPersonal && newAmount < 0 && editCategory !== "Uncategorized",
              taxWithheld: editCategory === "W-2 Income" ? editTaxWithheld : undefined,
            }
          : t
      )
    );
    setEditTx(null);
  }

  function confirmDelete(id: string) { setDeleteTxId(id); }

  function executeDelete() {
    if (!deleteTxId) return;
    setTransactions((prev) => prev.filter((t) => t.id !== deleteTxId));
    setDeleteTxId(null);
    if (editTx?.id === deleteTxId) setEditTx(null);
  }

  function addTransaction() {
    const amount = parseFloat(addAmount) || 0;
    if (!addDate || !addVendor || amount === 0) return;
    const companyType = getCompanyTypeForEntity(addEntity);
    const newTx: Transaction = {
      id: `manual-${Date.now()}`,
      date: addDate,
      merchant: addVendor,
      amount,
      category: addCategory,
      account: addAccount,
      entity: addEntity,
      companyType,
      deductible: addCategory !== PERSONAL_CATEGORY && addCategory !== "Uncategorized" && amount < 0,
      memo: addMemo,
      type: amount >= 0 ? "income" : "expense",
    };
    setTransactions((prev) => [newTx, ...prev]);
    setShowAddDialog(false);
    setAddDate(""); setAddVendor(""); setAddAmount(""); setAddCategory("Uncategorized"); setAddEntity("Unassigned"); setAddMemo("");
  }

  function addW2Income() {
    const grossPay = parseFloat(w2GrossPay) || 0;
    const fedWithheld = parseFloat(w2FedWithheld) || 0;
    const stateWithheld = parseFloat(w2StateWithheld) || 0;
    if (grossPay <= 0 || !w2Date || !w2Employer) return;
    const companyType = getCompanyTypeForEntity(w2Company);
    const newTx: Transaction = {
      id: `w2-${Date.now()}`,
      date: w2Date,
      merchant: w2Employer,
      amount: grossPay,
      category: "W-2 Income",
      account: "Chase Business Checking",
      entity: w2Company,
      companyType: companyType || "W2",
      deductible: false,
      memo: w2Memo,
      type: "income",
      taxWithheld: fedWithheld + stateWithheld,
    };
    setTransactions((prev) => [newTx, ...prev]);
    setShowW2Dialog(false);
    setW2Date(""); setW2Employer(""); setW2Company("Unassigned"); setW2GrossPay(""); setW2FedWithheld(""); setW2StateWithheld(""); setW2Memo("");
  }

  function exportCSV() {
    const headers = ["Date", "Vendor", "Amount", "Category", "Account", "Company", "Company Type", "Notes", "Tax Withheld"];
    const rows = filtered.map((t) => [t.date, t.merchant, t.amount, t.category, t.account, t.entity, t.companyType || "", t.memo, t.taxWithheld || ""]);
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

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <ExpenseSummaryWidgets {...summary} />

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
          <Plus className="h-4 w-4" /> Add Transaction
        </Button>
        <Button onClick={() => setShowW2Dialog(true)} className="gap-2">
          <Plus className="h-4 w-4" /> Add W-2
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
        <div className="hidden lg:grid lg:grid-cols-[100px_1fr_100px_140px_160px_1fr_40px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
          <span>Date</span>
          <span>Vendor</span>
          <span className="text-right">Amount</span>
          <span>Category</span>
          <span>Company</span>
          <span>Notes</span>
          <span></span>
        </div>

        <div className="divide-y divide-border">
          {filtered.map((tx) => (
            <div
              key={tx.id}
              className="flex flex-col lg:grid lg:grid-cols-[100px_1fr_100px_140px_160px_1fr_40px] gap-1 lg:gap-2 px-5 py-3 hover:bg-muted/50 transition-colors cursor-pointer items-center"
              onClick={() => openEdit(tx)}
            >
              <span className="text-xs text-muted-foreground">{tx.date}</span>
              <span className="text-sm font-medium text-card-foreground truncate">{tx.merchant}</span>
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
                {tx.entity}{tx.companyType ? ` (${tx.companyType})` : ""}
              </span>
              <span className="text-xs text-muted-foreground italic truncate">{tx.memo}</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); confirmDelete(tx.id); }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
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
              {editCategory === "W-2 Income" && (
                <div>
                  <Label className="text-xs text-muted-foreground mb-1.5 block">Tax Withheld</Label>
                  <Input type="number" value={editTaxWithheld} onChange={(e) => setEditTaxWithheld(parseFloat(e.target.value) || 0)} />
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
                <Textarea value={editMemo} onChange={(e) => setEditMemo(e.target.value)} rows={3} />
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

      {/* Add Transaction */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Transaction</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <Input type="date" value={addDate} onChange={(e) => setAddDate(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Vendor</Label>
                <Input value={addVendor} onChange={(e) => setAddVendor(e.target.value)} placeholder="Vendor name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Amount (negative for expense)</Label>
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
              <Button onClick={addTransaction}>Add Transaction</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add W-2 */}
      <Dialog open={showW2Dialog} onOpenChange={setShowW2Dialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add W-2 Income</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Date</Label>
                <Input type="date" value={w2Date} onChange={(e) => setW2Date(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Employer Name</Label>
                <Input value={w2Employer} onChange={(e) => setW2Employer(e.target.value)} placeholder="Hospital System" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company / Entity</Label>
              <CompanyDropdown value={w2Company} onChange={setW2Company} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Gross Pay</Label>
              <Input type="number" value={w2GrossPay} onChange={(e) => setW2GrossPay(e.target.value)} placeholder="0.00" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Federal Tax Withheld</Label>
                <Input type="number" value={w2FedWithheld} onChange={(e) => setW2FedWithheld(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">State Tax Withheld</Label>
                <Input type="number" value={w2StateWithheld} onChange={(e) => setW2StateWithheld(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Memo</Label>
              <Textarea value={w2Memo} onChange={(e) => setW2Memo(e.target.value)} rows={2} placeholder="Bi-weekly paycheck…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowW2Dialog(false)}>Cancel</Button>
              <Button onClick={addW2Income}>Add Income</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
