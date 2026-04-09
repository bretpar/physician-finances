import { useState, useMemo } from "react";
import { DollarSign, Plus, Trash2, Pencil, AlertTriangle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useIncomeEntries, useAddIncome, useUpdateIncome, useDeleteIncome, IncomeEntry } from "@/hooks/useIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useCompanies } from "@/contexts/CompanyContext";

const INCOME_TYPES = ["W2", "1099", "K1"];

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface FormState {
  name: string;
  company: string;
  income_type: string;
  income_date: string;
  paycheck_amount: string;
  deposited_amount: string;
  taxes_withheld: string;
  pre_tax_deductions: string;
  retirement_401k: string;
  notes: string;
}

const emptyForm: FormState = {
  name: "",
  company: "",
  income_type: "1099",
  income_date: new Date().toISOString().split("T")[0],
  paycheck_amount: "",
  deposited_amount: "",
  taxes_withheld: "",
  pre_tax_deductions: "",
  retirement_401k: "",
  notes: "",
};

export default function Income() {
  const { data: entries, isLoading } = useIncomeEntries();
  const { data: rates } = useTaxSettings();
  const { companies } = useCompanies();
  const addIncome = useAddIncome();
  const updateIncome = useUpdateIncome();
  const deleteIncome = useDeleteIncome();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [taxSuggestion, setTaxSuggestion] = useState<{ amount: number; paycheck: number } | null>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterCompany, setFilterCompany] = useState("all");

  const num = (v: string) => parseFloat(v) || 0;

  const computedPaycheck = num(form.deposited_amount) + num(form.taxes_withheld) + num(form.pre_tax_deductions) + num(form.retirement_401k);
  const enteredPaycheck = num(form.paycheck_amount);
  const hasMismatch = form.paycheck_amount !== "" && form.deposited_amount !== "" && Math.abs(enteredPaycheck - computedPaycheck) > 0.01;

  // Summaries
  const totals = useMemo(() => {
    if (!entries) return { income: 0, withheld: 0, deductions: 0, retirement: 0 };
    return entries.reduce(
      (acc, e) => ({
        income: acc.income + Number(e.paycheck_amount),
        withheld: acc.withheld + Number(e.taxes_withheld),
        deductions: acc.deductions + Number(e.pre_tax_deductions),
        retirement: acc.retirement + Number(e.retirement_401k),
      }),
      { income: 0, withheld: 0, deductions: 0, retirement: 0 }
    );
  }, [entries]);

  // Unique companies from entries
  const entryCompanies = useMemo(() => {
    if (!entries) return [];
    return [...new Set(entries.map((e) => e.company).filter(Boolean))];
  }, [entries]);

  const allCompanies = useMemo(() => {
    const set = new Set<string>();
    companies.forEach((c) => set.add(c.name));
    entryCompanies.forEach((c) => set.add(c));
    return [...set].sort();
  }, [companies, entryCompanies]);

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    return entries.filter((e) => {
      if (filterType !== "all" && e.income_type !== filterType) return false;
      if (filterCompany !== "all" && e.company !== filterCompany) return false;
      return true;
    });
  }, [entries, filterType, filterCompany]);

  const calculateTaxSuggestion = (paycheckAmount: number) => {
    if (!rates || !entries) return 0;
    const totalAnnualIncome = totals.income + paycheckAmount;
    const totalDeductions = totals.deductions + totals.retirement;
    const taxableIncome = totalAnnualIncome - totalDeductions;
    const federalTax = taxableIncome * (rates.federalRate / 100);
    const alreadyWithheld = totals.withheld;
    const remaining = Math.max(0, federalTax - alreadyWithheld);
    // Suggest proportional amount for this paycheck
    const proportion = paycheckAmount / totalAnnualIncome;
    return remaining * proportion;
  };

  const setField = (key: keyof FormState, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
  };

  const handleSubmit = () => {
    if (!form.name.trim() || !form.company.trim()) {
      return;
    }
    if (num(form.paycheck_amount) <= 0 && num(form.deposited_amount) <= 0) {
      return;
    }

    const payload: Partial<IncomeEntry> = {
      name: form.name,
      company: form.company,
      income_type: form.income_type,
      income_date: form.income_date,
      paycheck_amount: num(form.paycheck_amount) || computedPaycheck,
      deposited_amount: num(form.deposited_amount),
      taxes_withheld: num(form.taxes_withheld),
      pre_tax_deductions: num(form.pre_tax_deductions),
      retirement_401k: num(form.retirement_401k),
      notes: form.notes,
    };

    const paycheckAmt = payload.paycheck_amount || 0;

    if (editingId) {
      updateIncome.mutate({ id: editingId, ...payload }, { onSuccess: resetForm });
    } else {
      addIncome.mutate(payload, {
        onSuccess: () => {
          const suggestion = calculateTaxSuggestion(paycheckAmt);
          if (suggestion > 0) {
            setTaxSuggestion({ amount: suggestion, paycheck: paycheckAmt });
          }
          resetForm();
        },
      });
    }
  };

  const startEdit = (entry: IncomeEntry) => {
    setForm({
      name: entry.name,
      company: entry.company,
      income_type: entry.income_type,
      income_date: entry.income_date,
      paycheck_amount: String(entry.paycheck_amount),
      deposited_amount: String(entry.deposited_amount),
      taxes_withheld: String(entry.taxes_withheld),
      pre_tax_deductions: String(entry.pre_tax_deductions),
      retirement_401k: String(entry.retirement_401k),
      notes: entry.notes || "",
    });
    setEditingId(entry.id);
    setShowForm(true);
  };

  const handleDelete = (id: string) => {
    deleteIncome.mutate(id);
    setDeleteConfirm(null);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading income…</p></div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Summary widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Total Income</p>
            <p className="text-2xl font-bold text-foreground">{fmt(totals.income)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Taxes Withheld</p>
            <p className="text-2xl font-bold text-foreground">{fmt(totals.withheld)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">Pre-Tax Deductions</p>
            <p className="text-2xl font-bold text-foreground">{fmt(totals.deductions)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <p className="text-sm text-muted-foreground">401k Contributions</p>
            <p className="text-2xl font-bold text-foreground">{fmt(totals.retirement)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + Add button */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[140px]"><SelectValue placeholder="All types" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {INCOME_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterCompany} onValueChange={setFilterCompany}>
          <SelectTrigger className="w-[180px]"><SelectValue placeholder="All companies" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Companies</SelectItem>
            {allCompanies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => { resetForm(); setShowForm(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Income
        </Button>
      </div>

      {/* Entry form */}
      {showForm && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{editingId ? "Edit Income Entry" : "New Income Entry"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label>Name *</Label>
                <Input placeholder="e.g. ED Shift, K1 Distribution" value={form.name} onChange={(e) => setField("name", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Company *</Label>
                <Select value={form.company} onValueChange={(v) => setField("company", v)}>
                  <SelectTrigger><SelectValue placeholder="Select company" /></SelectTrigger>
                  <SelectContent>
                    {allCompanies.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Income Type</Label>
                <Select value={form.income_type} onValueChange={(v) => setField("income_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {INCOME_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={form.income_date} onChange={(e) => setField("income_date", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Paycheck Amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="Total gross" value={form.paycheck_amount} onChange={(e) => setField("paycheck_amount", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Deposited Amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="Net deposit" value={form.deposited_amount} onChange={(e) => setField("deposited_amount", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Taxes Withheld</Label>
                <Input type="number" min="0" step="0.01" placeholder="0" value={form.taxes_withheld} onChange={(e) => setField("taxes_withheld", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Pre-Tax Deductions</Label>
                <Input type="number" min="0" step="0.01" placeholder="Healthcare, insurance…" value={form.pre_tax_deductions} onChange={(e) => setField("pre_tax_deductions", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>401k Contribution</Label>
                <Input type="number" min="0" step="0.01" placeholder="0" value={form.retirement_401k} onChange={(e) => setField("retirement_401k", e.target.value)} />
              </div>
            </div>

            {/* Mismatch warning */}
            {hasMismatch && (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Paycheck ({fmt(enteredPaycheck)}) ≠ Deposited + Withheld + Deductions + 401k ({fmt(computedPaycheck)})
                </span>
              </div>
            )}

            <div className="mt-3 space-y-1.5">
              <Label>Notes</Label>
              <Input placeholder="Optional notes" value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
            </div>

            <div className="flex gap-2 mt-4">
              <Button onClick={handleSubmit} disabled={!form.name.trim() || !form.company.trim()}>
                {editingId ? "Save Changes" : "Add Entry"}
              </Button>
              <Button variant="outline" onClick={resetForm}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Entries table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Income Entries ({filteredEntries.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Paycheck</TableHead>
                  <TableHead className="text-right">Deposited</TableHead>
                  <TableHead className="text-right">Withheld</TableHead>
                  <TableHead className="text-right">Deductions</TableHead>
                  <TableHead className="text-right">401k</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      No income entries yet. Click "Add Income" to get started.
                    </TableCell>
                  </TableRow>
                )}
                {filteredEntries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="whitespace-nowrap">{entry.income_date}</TableCell>
                    <TableCell>{entry.name}</TableCell>
                    <TableCell>{entry.company}</TableCell>
                    <TableCell><Badge variant="outline">{entry.income_type}</Badge></TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(entry.paycheck_amount))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(entry.deposited_amount))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(entry.taxes_withheld))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(entry.pre_tax_deductions))}</TableCell>
                    <TableCell className="text-right">{fmt(Number(entry.retirement_401k))}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" onClick={() => startEdit(entry)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setDeleteConfirm(entry.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Income Entry</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Are you sure? This cannot be undone.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tax suggestion modal */}
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
                from this {fmt(taxSuggestion.paycheck)} paycheck for taxes.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setTaxSuggestion(null)}>Got it</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
