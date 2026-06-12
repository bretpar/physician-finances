import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/DateField";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Plus, Trash2, Download, Pencil, Car, PiggyBank, HeartPulse, Home, Info, Wallet } from "lucide-react";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTransactions } from "@/hooks/useTransactions";
import { HsaLedgerSection } from "@/components/settings/HsaSection";
import { useMileageEntries, useMileageYTD, useAddMileageEntry, useUpdateMileageEntry, useDeleteMileageEntry, getIrsMileageRate, UNASSIGNED_COMPANY_VALUE } from "@/hooks/useMileage";
import { useHomeOfficeDeductions, useSaveHomeOfficeDeduction, useDeleteHomeOfficeDeduction, calculateHomeOfficeAmounts, type HomeOfficeDeduction, type HomeOfficeMethod } from "@/hooks/useHomeOfficeDeductions";
import {
  useRetirementContributions, useAddRetirementContribution, useUpdateRetirementContribution,
  useDeleteRetirementContribution, useAnnualizedContributions,
  ACCOUNT_TYPES, FREQUENCIES,
  type RetirementContribution,
} from "@/hooks/useRetirementContributions";
import { useCompanies } from "@/contexts/CompanyContext";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";
import { normalizeFilingType } from "@/lib/filingTypes";
import { deriveUserTypeFromIncomeStreams } from "@/lib/entitlements";
import { getDeductionToolVisibility } from "@/lib/householdIncomeProfile";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const num = (v: string) => parseFloat(v) || 0;

// ─── Retirement Contribution Form ───────────────────────────
interface ContribForm {
  account_type: string;
  contribution_amount: string;
  frequency: string;
  start_date: string;
  end_date: string;
  employer_match: string;
  apply_to_withholding: boolean;
  notes: string;
}

interface HomeOfficeForm {
  companyId: string;
  includeInTaxCalculation: boolean;
  method: HomeOfficeMethod;
  squareFeet: string;
  priorYearAmount: string;
  taxYear: string;
}

const emptyHomeOfficeForm = (): HomeOfficeForm => ({
  companyId: "",
  includeInTaxCalculation: false,
  method: "simplified_square_footage",
  squareFeet: "",
  priorYearAmount: "",
  taxYear: String(new Date().getFullYear()),
});

const emptyContribForm: ContribForm = {
  account_type: "401k",
  contribution_amount: "",
  frequency: "per_paycheck",
  start_date: new Date().toISOString().split("T")[0],
  end_date: "",
  employer_match: "",
  apply_to_withholding: true,
  notes: "",
};

export default function Mileage() {
  const now = new Date();
  const { data: taxSettings } = useTaxSettings();
  const isW2Only = deriveUserTypeFromIncomeStreams(taxSettings?.householdIncomeStreams) === "W2_ONLY";
  // Tool visibility is automatic based on the Household Income Profile.
  // See getDeductionToolVisibility for the rules.
  const { showMileage, showHomeOffice, showRetirement, showHsa } = getDeductionToolVisibility(taxSettings?.householdIncomeStreams);
  const defaultTab = showMileage ? "mileage" : showHomeOffice ? "home-office" : showRetirement ? "retirement" : "hsa";

  // ─── Mileage state ───────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const { companies } = useCompanies();
  const { data: monthEntries = [], isLoading } = useMileageEntries(selectedMonth, selectedYear);
  const { data: ytdEntries = [] } = useMileageYTD(selectedYear);
  const addMileage = useAddMileageEntry();
  const updateMileage = useUpdateMileageEntry();
  const deleteMileage = useDeleteMileageEntry();

  const [showAdd, setShowAdd] = useState(false);
  // Add form: company_id is canonical link; UNASSIGNED for legacy/no-company entries
  const [addCompanyId, setAddCompanyId] = useState<string>("");
  const [addMiles, setAddMiles] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editCompanyId, setEditCompanyId] = useState<string>("");
  const [editMiles, setEditMiles] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // Resolve company name from id (or fall back to a stored legacy name)
  const companyNameById = (id: string | null | undefined, fallback?: string | null) => {
    if (!id || id === UNASSIGNED_COMPANY_VALUE) return fallback || "Unassigned";
    return companies.find((c) => c.id === id)?.name || fallback || "Unassigned";
  };

  // ─── Retirement state ─────────────────────────
  const { data: contributions, isLoading: contribLoading } = useRetirementContributions();
  const addContrib = useAddRetirementContribution();
  const updateContrib = useUpdateRetirementContribution();
  const deleteContrib = useDeleteRetirementContribution();
  const annualized = useAnnualizedContributions(contributions);

  // ─── Income-linked retirement data ────────────
  const { data: incomeEntries } = useIncomeEntries();
  const { data: transactions = [] } = useTransactions();
  const currentYear = now.getFullYear();
  const { data: homeOfficeDeductions = [] } = useHomeOfficeDeductions(currentYear);
  const saveHomeOffice = useSaveHomeOfficeDeduction();
  const deleteHomeOffice = useDeleteHomeOfficeDeduction();
  const paycheckLinked = useMemo(() => {
    if (!incomeEntries) return { entries: [], total: 0 };
    const entries = incomeEntries.filter((e) => Number(e.retirement_401k) > 0);
    const total = entries.reduce((s, e) => s + Number(e.retirement_401k), 0);
    return { entries, total };
  }, [incomeEntries]);

  const [contribForm, setContribForm] = useState<ContribForm>(emptyContribForm);
  const [contribEditId, setContribEditId] = useState<string | null>(null);
  const [showContribForm, setShowContribForm] = useState(false);
  const [contribDeleteId, setContribDeleteId] = useState<string | null>(null);
  const [homeOfficeForm, setHomeOfficeForm] = useState<HomeOfficeForm>(emptyHomeOfficeForm);
  const [homeOfficeEditId, setHomeOfficeEditId] = useState<string | null>(null);
  const [showHomeOfficeForm, setShowHomeOfficeForm] = useState(false);
  const [homeOfficeDeleteId, setHomeOfficeDeleteId] = useState<string | null>(null);

  // ─── Mileage helpers ──────────────────────────
  const monthTotalMiles = useMemo(() => monthEntries.reduce((s, e) => s + Number(e.miles), 0), [monthEntries]);
  const monthDeduction = monthTotalMiles * getIrsMileageRate(selectedYear);
  const ytdTotalMiles = useMemo(() => ytdEntries.reduce((s, e) => s + Number(e.miles), 0), [ytdEntries]);
  const ytdDeduction = useMemo(
    () => ytdEntries.reduce((s, e) => s + Number(e.miles) * getIrsMileageRate(e.year), 0),
    [ytdEntries],
  );

  const byCompany = useMemo(() => {
    const map: Record<string, number> = {};
    monthEntries.forEach((e) => { map[e.company_name] = (map[e.company_name] || 0) + Number(e.miles); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [monthEntries]);

  const pastCompanies = useMemo(() => {
    const set = new Set(ytdEntries.map((e) => e.company_name));
    companies.forEach((c) => set.add(c.name));
    return Array.from(set).filter(Boolean).sort();
  }, [ytdEntries, companies]);

  const businessCompanies = useMemo(
    () => companies.filter((c) => ["1099_schedule_c", "k1_partnership", "scorp_distribution"].includes(normalizeFilingType(c.companyType))),
    [companies],
  );

  const availableProfitByCompany = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of businessCompanies) map.set(c.id, 0);
    for (const tx of transactions) {
      if (isExcludedFromBusiness(tx as any) || !tx.source_id) continue;
      if (!map.has(tx.source_id)) continue;
      const amount = Math.abs(Number(tx.amount) || 0);
      map.set(tx.source_id, (map.get(tx.source_id) || 0) + (tx.transaction_type === "income" ? amount : tx.transaction_type === "expense" ? -amount : 0));
    }
    for (const e of ytdEntries) if (e.company_id && map.has(e.company_id)) map.set(e.company_id, (map.get(e.company_id) || 0) - Number(e.miles) * getIrsMileageRate(e.year));
    return map;
  }, [businessCompanies, transactions, ytdEntries]);

  const homeOfficePreview = useMemo(() => calculateHomeOfficeAmounts({
    method: homeOfficeForm.method,
    squareFeet: num(homeOfficeForm.squareFeet),
    priorYearAmount: num(homeOfficeForm.priorYearAmount),
    includeInTaxCalculation: homeOfficeForm.includeInTaxCalculation,
    availableBusinessProfit: availableProfitByCompany.get(homeOfficeForm.companyId) || 0,
  }), [homeOfficeForm, availableProfitByCompany]);

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  function handleAddMileage() {
    const miles = parseFloat(addMiles);
    if (!addCompanyId || isNaN(miles) || miles < 0) return;
    const isUnassigned = addCompanyId === UNASSIGNED_COMPANY_VALUE;
    const name = isUnassigned ? "Unassigned" : (companies.find((c) => c.id === addCompanyId)?.name || "");
    if (!name) return;
    addMileage.mutate({
      month: selectedMonth,
      year: selectedYear,
      company_name: name,
      company_id: isUnassigned ? null : addCompanyId,
      miles,
    });
    setShowAdd(false); setAddCompanyId(""); setAddMiles("");
  }

  function openEditMileage(entry: typeof monthEntries[0]) {
    setEditId(entry.id);
    setEditCompanyId(entry.company_id || UNASSIGNED_COMPANY_VALUE);
    setEditMiles(String(entry.miles));
  }

  function handleEditMileage() {
    if (!editId) return;
    const miles = parseFloat(editMiles);
    if (!editCompanyId || isNaN(miles) || miles < 0) return;
    const isUnassigned = editCompanyId === UNASSIGNED_COMPANY_VALUE;
    const name = isUnassigned ? "Unassigned" : (companies.find((c) => c.id === editCompanyId)?.name || "");
    if (!name) return;
    updateMileage.mutate({
      id: editId,
      company_name: name,
      company_id: isUnassigned ? null : editCompanyId,
      miles,
    });
    setEditId(null);
  }

  function handleDeleteMileage() {
    if (!deleteId) return;
    deleteMileage.mutate(deleteId);
    setDeleteId(null);
  }

  function exportCSV() {
    const headers = ["Month", "Year", "Company", "Miles", "Deduction"];
    const rows = ytdEntries.map((e) => [MONTHS[e.month - 1], e.year, e.company_name, e.miles, (Number(e.miles) * getIrsMileageRate(e.year)).toFixed(2)]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `mileage_${selectedYear}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ─── Retirement helpers ───────────────────────
  const setContribField = (key: keyof ContribForm, value: string | boolean) =>
    setContribForm((p) => ({ ...p, [key]: value }));

  function resetContribForm() {
    setContribForm(emptyContribForm);
    setContribEditId(null);
    setShowContribForm(false);
  }

  function handleContribSubmit() {
    if (num(contribForm.contribution_amount) <= 0) return;

    const payload: Partial<RetirementContribution> = {
      account_type: contribForm.account_type,
      contribution_amount: num(contribForm.contribution_amount),
      frequency: contribForm.frequency,
      start_date: contribForm.start_date,
      end_date: contribForm.end_date || null,
      employer_match: num(contribForm.employer_match),
      apply_to_withholding: contribForm.apply_to_withholding,
      notes: contribForm.notes || null,
    };

    if (contribEditId) {
      updateContrib.mutate({ id: contribEditId, ...payload }, { onSuccess: resetContribForm });
    } else {
      addContrib.mutate(payload, { onSuccess: resetContribForm });
    }
  }

  function startEditContrib(c: RetirementContribution) {
    setContribForm({
      account_type: c.account_type,
      contribution_amount: String(c.contribution_amount),
      frequency: c.frequency,
      start_date: c.start_date,
      end_date: c.end_date || "",
      employer_match: String(c.employer_match),
      apply_to_withholding: c.apply_to_withholding,
      notes: c.notes || "",
    });
    setContribEditId(c.id);
    setShowContribForm(true);
  }

  function handleDeleteContrib() {
    if (!contribDeleteId) return;
    deleteContrib.mutate(contribDeleteId);
    setContribDeleteId(null);
  }

  function resetHomeOfficeForm() {
    setHomeOfficeForm(emptyHomeOfficeForm());
    setHomeOfficeEditId(null);
    setShowHomeOfficeForm(false);
  }

  function startEditHomeOffice(deduction: HomeOfficeDeduction) {
    setHomeOfficeForm({
      companyId: deduction.company_id || "",
      includeInTaxCalculation: deduction.include_in_tax_calculation,
      method: deduction.method,
      squareFeet: deduction.square_feet == null ? "" : String(deduction.square_feet),
      priorYearAmount: deduction.prior_year_amount == null ? "" : String(deduction.prior_year_amount),
      taxYear: String(deduction.tax_year),
    });
    setHomeOfficeEditId(deduction.id);
    setShowHomeOfficeForm(true);
  }

  function handleHomeOfficeSubmit() {
    if (homeOfficeForm.includeInTaxCalculation && !homeOfficeForm.companyId) return;
    if (homeOfficeForm.method === "simplified_square_footage" && num(homeOfficeForm.squareFeet) <= 0) return;
    if (homeOfficeForm.method === "prior_year_estimate" && num(homeOfficeForm.priorYearAmount) < 0) return;
    saveHomeOffice.mutate({
      id: homeOfficeEditId || undefined,
      company_id: homeOfficeForm.companyId || null,
      include_in_tax_calculation: homeOfficeForm.includeInTaxCalculation,
      method: homeOfficeForm.method,
      square_feet: homeOfficeForm.method === "simplified_square_footage" ? num(homeOfficeForm.squareFeet) : null,
      prior_year_amount: homeOfficeForm.method === "prior_year_estimate" ? num(homeOfficeForm.priorYearAmount) : null,
      calculated_amount: homeOfficePreview.calculatedAmount,
      allowed_amount: homeOfficePreview.allowedAmount,
      unused_capped_amount: homeOfficePreview.unusedCappedAmount,
      tax_year: Number(homeOfficeForm.taxYear) || currentYear,
    }, { onSuccess: resetHomeOfficeForm });
  }

  function handleDeleteHomeOffice() {
    if (!homeOfficeDeleteId) return;
    deleteHomeOffice.mutate(homeOfficeDeleteId);
    setHomeOfficeDeleteId(null);
  }

  const getAccountLabel = (v: string) => ACCOUNT_TYPES.find((a) => a.value === v)?.label || v;
  const getFreqLabel = (v: string) => FREQUENCIES.find((f) => f.value === v)?.label || v;

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <Tabs defaultValue={defaultTab} className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-2 sm:grid-cols-4 h-auto gap-1 p-1">
          {showMileage && <TabsTrigger value="mileage" className="gap-1.5 text-xs sm:text-sm py-2 px-2"><Car className="h-4 w-4 shrink-0" /> Mileage</TabsTrigger>}
          {showHomeOffice && <TabsTrigger value="home-office" className="gap-1.5 text-xs sm:text-sm py-2 px-2"><Home className="h-4 w-4 shrink-0" /> Home Office</TabsTrigger>}
          {showRetirement && <TabsTrigger value="retirement" className="gap-1.5 text-xs sm:text-sm py-2 px-2"><PiggyBank className="h-4 w-4 shrink-0" /> Retirement</TabsTrigger>}
          {showHsa && <TabsTrigger value="hsa" className="gap-1.5 text-xs sm:text-sm py-2 px-2"><HeartPulse className="h-4 w-4 shrink-0" /> HSA</TabsTrigger>}
        </TabsList>

        {/* ─── MILEAGE TAB ──────────────────────────── */}
        <TabsContent value="mileage" className="space-y-6 mt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Monthly Miles</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-card-foreground">{monthTotalMiles.toLocaleString()}</p><p className="text-xs text-muted-foreground">{MONTHS[selectedMonth - 1]} {selectedYear}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Monthly Deduction</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-success">{fmt(monthDeduction)}</p><p className="text-xs text-muted-foreground">@ ${getIrsMileageRate(selectedYear)}/mile</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">YTD Miles</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-card-foreground">{ytdTotalMiles.toLocaleString()}</p><p className="text-xs text-muted-foreground">{selectedYear}</p></CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">YTD Deduction</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-success">{fmt(ytdDeduction)}</p><p className="text-xs text-muted-foreground">Business mileage deduction</p></CardContent></Card>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
            <div className="flex gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Month</Label>
                <Select value={String(selectedMonth)} onValueChange={(v) => setSelectedMonth(Number(v))}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Year</Label>
                <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(Number(v))}>
                  <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" onClick={exportCSV} className="gap-2"><Download className="h-4 w-4" /> Export CSV</Button>
              <Button onClick={() => setShowAdd(true)} className="gap-2"><Plus className="h-4 w-4" /> Add Entry</Button>
            </div>
          </div>

          {byCompany.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Miles by Company — {MONTHS[selectedMonth - 1]}</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {byCompany.map(([name, miles]) => (
                    <div key={name} className="flex justify-between items-center text-sm">
                      <span className="text-card-foreground">{name}</span>
                      <div className="text-right">
                        <span className="font-semibold tabular-nums">{miles.toLocaleString()} mi</span>
                        <span className="text-muted-foreground ml-3 text-xs">{fmt(miles * getIrsMileageRate(selectedYear))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          <div className="glass-card rounded-xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border flex items-center gap-2">
              <Car className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-card-foreground">
                {monthEntries.length} entr{monthEntries.length !== 1 ? "ies" : "y"} — {MONTHS[selectedMonth - 1]} {selectedYear}
              </h3>
            </div>
            <div className="hidden sm:grid sm:grid-cols-[1fr_120px_120px_80px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
              <span>Company</span><span className="text-right">Miles</span><span className="text-right">Deduction</span><span></span>
            </div>
            <div className="divide-y divide-border">
              {isLoading ? (
                <div className="px-5 py-12 text-center text-muted-foreground text-sm">Loading…</div>
              ) : monthEntries.length === 0 ? (
                <div className="px-5 py-12 text-center text-muted-foreground text-sm">No mileage entries for this month.</div>
              ) : (
                monthEntries.map((entry) => (
                  <div key={entry.id} className="flex flex-col sm:grid sm:grid-cols-[1fr_120px_120px_80px] gap-1 sm:gap-2 px-5 py-3 hover:bg-muted/50 transition-colors items-center">
                    <span className="text-sm font-medium text-card-foreground">
                      {companyNameById(entry.company_id, entry.company_name)}
                      {!entry.company_id && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">Unassigned</span>
                      )}
                    </span>
                    <span className="text-sm tabular-nums text-right">{Number(entry.miles).toLocaleString()}</span>
                    <span className="text-sm tabular-nums text-right text-success">{fmt(Number(entry.miles) * IRS_MILEAGE_RATE)}</span>
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditMileage(entry)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(entry.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </TabsContent>

        {/* ─── HOME OFFICE TAB ───────────────────── */}
        <TabsContent value="home-office" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  Home Office
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild><Info className="h-4 w-4 text-muted-foreground" /></TooltipTrigger>
                      <TooltipContent className="max-w-xs">Home office deductions are generally for business use of your home. The simplified method estimates the deduction using square footage. You can also use last year’s deduction as an estimate for planning.</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </CardTitle>
                <Button onClick={() => { resetHomeOfficeForm(); setShowHomeOfficeForm(true); }} className="gap-2"><Plus className="h-4 w-4" /> Add Deduction</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {homeOfficeDeductions.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted-foreground">No home office deductions saved.</div>
              ) : homeOfficeDeductions.map((d) => {
                const company = companies.find((c) => c.id === d.company_id);
                const filing = normalizeFilingType(company?.companyType);
                const trackedForReview = d.include_in_tax_calculation && filing === "k1_partnership";
                const status = !d.include_in_tax_calculation ? "Not included" : trackedForReview ? "Tracked for review" : "Included";
                return (
                  <div key={d.id} className="rounded-lg border border-border p-4 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-foreground">{company?.name || "No company selected"}</p>
                          <Badge variant={d.include_in_tax_calculation ? "default" : "secondary"}>{status}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{d.method === "simplified_square_footage" ? "Simplified square footage method" : "Prior-year estimate"} • {d.tax_year}</p>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEditHomeOffice(d)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setHomeOfficeDeleteId(d.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                      <div><p className="text-xs text-muted-foreground">Selected company</p><p className="font-medium text-foreground">{company?.name || "—"}</p></div>
                      <div><p className="text-xs text-muted-foreground">Calculated deduction</p><p className="font-medium text-foreground tabular-nums">{fmt(Number(d.calculated_amount))}</p></div>
                      <div><p className="text-xs text-muted-foreground">Amount used in tax calculation</p><p className="font-medium text-foreground tabular-nums">{fmt(Number(d.allowed_amount))}</p></div>
                      <div><p className="text-xs text-muted-foreground">Tax calculation status</p><p className="font-medium text-foreground">{status}</p></div>
                    </div>
                    {Number(d.unused_capped_amount) > 0 && <p className="text-xs text-muted-foreground">Only {fmt(Number(d.allowed_amount))} of this deduction was used because the deduction cannot exceed the available business profit.</p>}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── RETIREMENT TAB ─────────────────────── */}
        <TabsContent value="retirement" className="space-y-6 mt-6">
          {/* Summary cards — include both standalone + paycheck-linked */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Total Pre-Tax Retirement (YTD)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmt(annualized.total + paycheckLinked.total)}</p><p className="text-xs text-muted-foreground">Standalone + paycheck-linked</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Standalone (Annual)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmt(annualized.total)}</p><p className="text-xs text-muted-foreground">{contributions?.length || 0} configured</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">From Paychecks (YTD)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmt(paycheckLinked.total)}</p><p className="text-xs text-muted-foreground">{paycheckLinked.entries.length} income entries</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Affects Withholding</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-success">{fmt(annualized.withholding)}</p><p className="text-xs text-muted-foreground">From standalone contributions</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs font-medium text-muted-foreground">Per Paycheck (Est.)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold">{fmt(annualized.perPaycheck)}</p><p className="text-xs text-muted-foreground">Estimated per pay period</p></CardContent>
            </Card>
          </div>

          {/* Add button */}
          <div className="flex justify-end">
            <Button onClick={() => { resetContribForm(); setShowContribForm(true); }} className="gap-2">
              <Plus className="h-4 w-4" /> Add Contribution
            </Button>
          </div>

          {/* Form */}
          {showContribForm && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{contribEditId ? "Edit Contribution" : "New Retirement Contribution"}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label>Account Type *</Label>
                    <Select value={contribForm.account_type} onValueChange={(v) => setContribField("account_type", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{ACCOUNT_TYPES.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contribution Amount *</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={contribForm.contribution_amount} onChange={(e) => setContribField("contribution_amount", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Frequency</Label>
                    <Select value={contribForm.frequency} onValueChange={(v) => setContribField("frequency", v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FREQUENCIES.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Start Date</Label>
                    <DateField value={contribForm.start_date} onChange={(v) => setContribField("start_date", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End Date (optional)</Label>
                    <DateField value={contribForm.end_date} onChange={(v) => setContribField("end_date", v)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Employer Match (optional)</Label>
                    <Input type="number" min="0" step="0.01" placeholder="0.00" value={contribForm.employer_match} onChange={(e) => setContribField("employer_match", e.target.value)} />
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <Switch checked={contribForm.apply_to_withholding} onCheckedChange={(v) => setContribField("apply_to_withholding", v)} />
                  <div>
                    <Label className="text-sm">Apply to withholding simulation</Label>
                    <p className="text-xs text-muted-foreground">
                      {contribForm.apply_to_withholding
                        ? "Affects paycheck withholding calculations immediately"
                        : "Only affects annual tax projection"}
                    </p>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5">
                  <Label>Notes</Label>
                  <Input placeholder="Optional notes" value={contribForm.notes} onChange={(e) => setContribField("notes", e.target.value)} />
                </div>

                <div className="flex gap-2 mt-4">
                  <Button onClick={handleContribSubmit} disabled={num(contribForm.contribution_amount) <= 0}>
                    {contribEditId ? "Save Changes" : "Add Contribution"}
                  </Button>
                  <Button variant="outline" onClick={resetContribForm}>Cancel</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Contributions table */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <PiggyBank className="h-4 w-4" /> Retirement Contributions ({contributions?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account Type</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Amount</TableHead>
                      <TableHead className="hidden sm:table-cell">Frequency</TableHead>
                      <TableHead className="text-right whitespace-nowrap hidden md:table-cell">Annual</TableHead>
                      <TableHead className="text-right whitespace-nowrap hidden lg:table-cell">Employer Match</TableHead>
                      <TableHead className="hidden md:table-cell">Withholding</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(!contributions || contributions.length === 0) ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No retirement contributions yet. Click "Add Contribution" to get started.
                        </TableCell>
                      </TableRow>
                    ) : (
                      contributions.map((c) => {
                        const amt = Number(c.contribution_amount);
                        const annual = c.frequency === "per_paycheck" ? amt * 26 : c.frequency === "monthly" ? amt * 12 : amt;
                        return (
                          <TableRow key={c.id}>
                            <TableCell className="font-medium"><span className="block truncate">{getAccountLabel(c.account_type)}</span></TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap">{fmt(amt)}</TableCell>
                            <TableCell className="hidden sm:table-cell"><Badge variant="outline">{getFreqLabel(c.frequency)}</Badge></TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap font-medium hidden md:table-cell">{fmt(annual)}</TableCell>
                            <TableCell className="text-right tabular-nums whitespace-nowrap text-muted-foreground hidden lg:table-cell">{Number(c.employer_match) > 0 ? fmt(Number(c.employer_match)) : "—"}</TableCell>
                            <TableCell className="hidden md:table-cell">
                              <Badge variant="outline" className={c.apply_to_withholding ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"}>
                                {c.apply_to_withholding ? "Active" : "Projection Only"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1 justify-end">
                                <Button size="icon" variant="ghost" onClick={() => startEditContrib(c)}><Pencil className="h-4 w-4" /></Button>
                                <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setContribDeleteId(c.id)}><Trash2 className="h-4 w-4" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
           </Card>

          {/* Paycheck-linked retirement contributions from income entries */}
          {paycheckLinked.entries.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wallet className="h-4 w-4" /> Paycheck-Linked Contributions ({paycheckLinked.entries.length})
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  These retirement contributions were recorded with income entries and automatically reduce taxable income.
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Income Entry</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">401k Amount</TableHead>
                        <TableHead className="text-right">Paycheck</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paycheckLinked.entries.slice(0, 20).map((ie) => (
                        <TableRow key={ie.id}>
                          <TableCell className="whitespace-nowrap">{ie.income_date}</TableCell>
                          <TableCell className="font-medium">{ie.name}</TableCell>
                          <TableCell>{ie.company}</TableCell>
                          <TableCell><Badge variant="outline">{ie.income_type}</Badge></TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{fmt(Number(ie.retirement_401k))}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(Number(ie.paycheck_amount))}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── HSA TAB ────────────────────────────── */}
        <TabsContent value="hsa" className="space-y-6 mt-6">
          <HsaLedgerSection />
        </TabsContent>
      </Tabs>

      {/* ─── MILEAGE DIALOGS ──────────────────────── */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Mileage Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
              <Select value={addCompanyId} onValueChange={setAddCompanyId}>
                <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  <SelectItem value={UNASSIGNED_COMPANY_VALUE}>Unassigned (no company)</SelectItem>
                </SelectContent>
              </Select>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                The deductible amount is added to this company's expenses on Reports & Schedule C.
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Miles Driven</Label>
              <Input type="number" min="0" step="0.1" value={addMiles} onChange={(e) => setAddMiles(e.target.value)} placeholder="0" />
            </div>
            <p className="text-xs text-muted-foreground">
              For {MONTHS[selectedMonth - 1]} {selectedYear} • Deduction: {fmt((parseFloat(addMiles) || 0) * IRS_MILEAGE_RATE)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button onClick={handleAddMileage} disabled={!addCompanyId || !(parseFloat(addMiles) >= 0)}>Add Entry</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editId} onOpenChange={(open) => !open && setEditId(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Mileage Entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
              <Select value={editCompanyId} onValueChange={setEditCompanyId}>
                <SelectTrigger><SelectValue placeholder="Select a company" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  <SelectItem value={UNASSIGNED_COMPANY_VALUE}>Unassigned (no company)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label className="text-xs text-muted-foreground mb-1.5 block">Miles Driven</Label><Input type="number" min="0" step="0.1" value={editMiles} onChange={(e) => setEditMiles(e.target.value)} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
              <Button onClick={handleEditMileage} disabled={!editCompanyId}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Mileage Entry</AlertDialogTitle><AlertDialogDescription>This will permanently remove this mileage entry.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteMileage} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={showHomeOfficeForm} onOpenChange={(open) => !open && resetHomeOfficeForm()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{homeOfficeEditId ? "Edit Home Office Deduction" : "Add Home Office Deduction"}</DialogTitle></DialogHeader>
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-lg border border-border p-3">
              <Switch checked={homeOfficeForm.includeInTaxCalculation} onCheckedChange={(v) => setHomeOfficeForm((p) => ({ ...p, includeInTaxCalculation: v }))} />
              <div><Label>Include in tax calculation</Label><p className="text-xs text-muted-foreground">Turn on to include this deduction in your estimated tax calculation.</p></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Associated company {homeOfficeForm.includeInTaxCalculation ? "*" : ""}</Label>
                <Select value={homeOfficeForm.companyId} onValueChange={(v) => setHomeOfficeForm((p) => ({ ...p, companyId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select a business" /></SelectTrigger>
                  <SelectContent>{businessCompanies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} — {c.companyType}</SelectItem>)}</SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Choose which business this home office deduction belongs to.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Tax year</Label>
                <Input type="number" value={homeOfficeForm.taxYear} onChange={(e) => setHomeOfficeForm((p) => ({ ...p, taxYear: e.target.value }))} />
              </div>
            </div>
            <RadioGroup value={homeOfficeForm.method} onValueChange={(v) => setHomeOfficeForm((p) => ({ ...p, method: v as HomeOfficeMethod }))} className="grid gap-3 sm:grid-cols-2">
              <Label className="flex items-start gap-3 rounded-lg border border-border p-3"><RadioGroupItem value="simplified_square_footage" /> <span><span className="block">Simplified square footage method</span><span className="block text-xs font-normal text-muted-foreground">Current IRS simplified method is $5 per square foot, up to 300 square feet.</span></span></Label>
              <Label className="flex items-start gap-3 rounded-lg border border-border p-3"><RadioGroupItem value="prior_year_estimate" /> <span><span className="block">Use prior-year estimate</span><span className="block text-xs font-normal text-muted-foreground">Use last year’s home office deduction as a planning estimate for this year.</span></span></Label>
            </RadioGroup>
            {homeOfficeForm.method === "simplified_square_footage" ? (
              <div className="space-y-1.5"><Label>Home office square footage</Label><Input type="number" min="0" step="1" value={homeOfficeForm.squareFeet} onChange={(e) => setHomeOfficeForm((p) => ({ ...p, squareFeet: e.target.value }))} />{homeOfficePreview.isSquareFootageCapped && <p className="text-xs text-muted-foreground">The simplified method is capped at 300 square feet, so only 300 sq ft is used for this estimate.</p>}</div>
            ) : (
              <div className="space-y-1.5"><Label>Prior-year home office deduction amount</Label><Input type="number" min="0" step="0.01" value={homeOfficeForm.priorYearAmount} onChange={(e) => setHomeOfficeForm((p) => ({ ...p, priorYearAmount: e.target.value }))} /></div>
            )}
            <div className="rounded-lg bg-muted/40 p-4 space-y-2">
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Estimated deduction</span><span className="font-bold text-foreground tabular-nums">{fmt(homeOfficePreview.calculatedAmount)}</span></div>
              {homeOfficePreview.allowedAmount !== homeOfficePreview.calculatedAmount && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Amount used in tax calculation</span><span className="font-semibold text-foreground tabular-nums">{fmt(homeOfficePreview.allowedAmount)}</span></div>}
              {homeOfficeForm.includeInTaxCalculation && homeOfficePreview.allowedAmount === 0 && <p className="text-xs text-muted-foreground">This deduction is saved, but it is not currently reducing taxes because this company does not have available business profit.</p>}
            </div>
            <DialogFooter><Button variant="outline" onClick={resetHomeOfficeForm}>Cancel</Button><Button onClick={handleHomeOfficeSubmit}>Save Deduction</Button></DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!homeOfficeDeleteId} onOpenChange={(open) => !open && setHomeOfficeDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Home Office Deduction</AlertDialogTitle><AlertDialogDescription>This will remove this home office deduction from the Deductions tab and tax calculations.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteHomeOffice} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── RETIREMENT DELETE ────────────────────── */}
      <AlertDialog open={!!contribDeleteId} onOpenChange={(open) => !open && setContribDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete Contribution</AlertDialogTitle><AlertDialogDescription>This will permanently remove this retirement contribution.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={handleDeleteContrib} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
