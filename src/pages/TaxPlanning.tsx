import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trash2, DollarSign, TrendingUp, PiggyBank, Receipt, AlertCircle } from "lucide-react";
import StatCard from "@/components/StatCard";
import { useCompanies } from "@/contexts/CompanyContext";

interface ForecastRow {
  id: string;
  month: string;
  companyName: string;
  companyType: "1099" | "W2" | "K1";
  grossIncome: number;
  expectedWithholding: number;
  notes: string;
}

// Tax settings defaults (mirrors Settings page defaults)
const TAX_RATES = { federal: 0.20, state: 0.00, bno: 0.015 };

function getNext12Months(): string[] {
  const months: string[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

function formatMonth(m: string): string {
  const [y, mo] = m.split("-");
  const date = new Date(parseInt(y), parseInt(mo) - 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function getQuarter(month: string): number {
  const mo = parseInt(month.split("-")[1]);
  if (mo <= 3) return 1;
  if (mo <= 6) return 2;
  if (mo <= 9) return 3;
  return 4;
}

function getCurrentQuarter(): number {
  return getQuarter(`${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`);
}

const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function TaxPlanning() {
  const { companies } = useCompanies();
  const months = useMemo(() => getNext12Months(), []);

  // Preload default forecast rows - one per company per first 3 months
  const [forecasts, setForecasts] = useState<ForecastRow[]>(() => {
    const rows: ForecastRow[] = [];
    const preloadMonths = months.slice(0, 3);
    companies.forEach((c) => {
      preloadMonths.forEach((m) => {
        rows.push({
          id: `${c.id}-${m}`,
          month: m,
          companyName: c.name,
          companyType: c.companyType,
          grossIncome: 0,
          expectedWithholding: 0,
          notes: "",
        });
      });
    });
    return rows;
  });

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addMonth, setAddMonth] = useState(months[0]);
  const [addCompany, setAddCompany] = useState(companies[0]?.name || "");
  const [addIncome, setAddIncome] = useState("");
  const [addWithholding, setAddWithholding] = useState("");
  const [addNotes, setAddNotes] = useState("");

  // Paycheck inputs
  const [paychecksRemQuarter, setPaychecksRemQuarter] = useState(6);
  const [paychecksRemYear, setPaychecksRemYear] = useState(18);

  // Calculations
  const calc = useMemo(() => {
    const activeForecasts = forecasts.filter((f) => f.grossIncome > 0);

    const w2Rows = activeForecasts.filter((f) => f.companyType === "W2");
    const t1099Rows = activeForecasts.filter((f) => f.companyType === "1099");
    const k1Rows = activeForecasts.filter((f) => f.companyType === "K1");

    const w2Income = w2Rows.reduce((s, r) => s + r.grossIncome, 0);
    const t1099Income = t1099Rows.reduce((s, r) => s + r.grossIncome, 0);
    const k1Income = k1Rows.reduce((s, r) => s + r.grossIncome, 0);
    const totalIncome = w2Income + t1099Income + k1Income;

    const w2Withholding = w2Rows.reduce((s, r) => s + r.expectedWithholding, 0);

    // W2 tax
    const w2TargetTax = w2Income * (TAX_RATES.federal + TAX_RATES.state);
    const w2Shortfall = Math.max(0, w2TargetTax - w2Withholding);

    // 1099 tax
    const t1099Tax = t1099Income * (TAX_RATES.federal + TAX_RATES.state + TAX_RATES.bno);
    const seTax1099 = t1099Income * 0.153 * 0.9235;

    // K1 tax
    const k1Tax = k1Income * (TAX_RATES.federal + TAX_RATES.state);
    const k1BnoTax = k1Income * TAX_RATES.bno;

    const totalTaxLiability = w2TargetTax + t1099Tax + seTax1099 + k1Tax + k1BnoTax;
    const totalWithholding = w2Withholding;
    const remainingLiability = Math.max(0, totalTaxLiability - totalWithholding);

    // Quarterly breakdown
    const currentQ = getCurrentQuarter();
    const quarterlyData = [2, 3, 4].map((q) => {
      const qRows = activeForecasts.filter((f) => getQuarter(f.month) === q);
      const q1099 = qRows.filter((r) => r.companyType === "1099");
      const qK1 = qRows.filter((r) => r.companyType === "K1");
      const qW2 = qRows.filter((r) => r.companyType === "W2");

      const q1099Income = q1099.reduce((s, r) => s + r.grossIncome, 0);
      const qK1Income = qK1.reduce((s, r) => s + r.grossIncome, 0);
      const qW2Income = qW2.reduce((s, r) => s + r.grossIncome, 0);
      const qW2Withholding = qW2.reduce((s, r) => s + r.expectedWithholding, 0);

      const q1099Tax = q1099Income * (TAX_RATES.federal + TAX_RATES.state + TAX_RATES.bno) + q1099Income * 0.153 * 0.9235;
      const qK1Tax = qK1Income * (TAX_RATES.federal + TAX_RATES.state + TAX_RATES.bno);
      const qW2Tax = Math.max(0, qW2Income * (TAX_RATES.federal + TAX_RATES.state) - qW2Withholding);

      return {
        quarter: q,
        label: q === 2 ? "Q2 — Jun 15" : q === 3 ? "Q3 — Sep 15" : "Q4 — Jan 15",
        total: q1099Tax + qK1Tax + qW2Tax,
        isPast: q < currentQ,
      };
    });

    // Monthly reserve
    const monthsRemaining = Math.max(1, months.length);
    const monthlyReserve = remainingLiability / monthsRemaining;

    // Paycheck recommendation
    const perPaycheckQuarter = paychecksRemQuarter > 0 ? w2Shortfall / paychecksRemQuarter : 0;
    const perPaycheckYear = paychecksRemYear > 0 ? w2Shortfall / paychecksRemYear : 0;

    return {
      totalIncome, w2Income, t1099Income, k1Income,
      totalTaxLiability, w2TargetTax, w2Withholding, w2Shortfall,
      t1099Tax: t1099Tax + seTax1099, k1Tax: k1Tax + k1BnoTax,
      remainingLiability, quarterlyData, monthlyReserve,
      perPaycheckQuarter, perPaycheckYear,
    };
  }, [forecasts, months, paychecksRemQuarter, paychecksRemYear]);

  function updateForecast(id: string, updates: Partial<ForecastRow>) {
    setForecasts((prev) => prev.map((f) => (f.id === id ? { ...f, ...updates } : f)));
  }

  function handleAddRow() {
    const company = companies.find((c) => c.name === addCompany);
    if (!company || !addIncome) return;
    setForecasts((prev) => [
      ...prev,
      {
        id: `forecast-${Date.now()}`,
        month: addMonth,
        companyName: company.name,
        companyType: company.companyType,
        grossIncome: parseFloat(addIncome) || 0,
        expectedWithholding: parseFloat(addWithholding) || 0,
        notes: addNotes,
      },
    ]);
    setShowAddDialog(false);
    setAddIncome(""); setAddWithholding(""); setAddNotes("");
  }

  function executeDelete() {
    if (!deleteId) return;
    setForecasts((prev) => prev.filter((f) => f.id !== deleteId));
    setDeleteId(null);
  }

  // Group forecasts by month for display
  const groupedByMonth = useMemo(() => {
    const groups: Record<string, ForecastRow[]> = {};
    months.forEach((m) => { groups[m] = []; });
    forecasts.forEach((f) => {
      if (!groups[f.month]) groups[f.month] = [];
      groups[f.month].push(f);
    });
    return groups;
  }, [forecasts, months]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Section 5: Summary Widgets */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Projected Annual Income" value={fmt(calc.totalIncome)} icon={TrendingUp} variant="success" />
        <StatCard label="Projected Tax Liability" value={fmt(calc.totalTaxLiability)} icon={DollarSign} variant="warning" />
        <StatCard label="W2 Withholding Shortfall" value={fmt(calc.w2Shortfall)} icon={AlertCircle} variant="destructive" />
        <StatCard label="Next Quarterly Payment" value={fmt(calc.quarterlyData[0]?.total || 0)} icon={Receipt} variant="default" trend={calc.quarterlyData[0]?.label} />
        <StatCard label="Monthly Tax Reserve" value={fmt(calc.monthlyReserve)} icon={PiggyBank} variant="warning" trend="Set aside monthly" />
      </div>

      {/* Section 2: Tax Calculation by Income Type */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-card-foreground">Tax Liability by Income Type</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="border border-border rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">W2 Income</p>
            <p className="text-xl font-bold text-card-foreground">{fmt(calc.w2Income)}</p>
            <div className="text-xs space-y-1 text-muted-foreground">
              <div className="flex justify-between"><span>Target withholding</span><span>{fmt(calc.w2TargetTax)}</span></div>
              <div className="flex justify-between"><span>Current withholding</span><span className="text-success">−{fmt(calc.w2Withholding)}</span></div>
              <div className="flex justify-between font-semibold text-card-foreground"><span>Additional needed</span><span className="text-destructive">{fmt(calc.w2Shortfall)}</span></div>
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">1099 Income</p>
            <p className="text-xl font-bold text-card-foreground">{fmt(calc.t1099Income)}</p>
            <div className="text-xs space-y-1 text-muted-foreground">
              <div className="flex justify-between"><span>Federal + State + B&O + SE</span><span>{fmt(calc.t1099Tax)}</span></div>
              <div className="flex justify-between font-semibold text-card-foreground"><span>Quarterly estimate</span><span>{fmt(calc.t1099Tax / 4)}</span></div>
            </div>
          </div>
          <div className="border border-border rounded-lg p-4 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">K1 Income</p>
            <p className="text-xl font-bold text-card-foreground">{fmt(calc.k1Income)}</p>
            <div className="text-xs space-y-1 text-muted-foreground">
              <div className="flex justify-between"><span>Federal + State + B&O</span><span>{fmt(calc.k1Tax)}</span></div>
              <div className="flex justify-between font-semibold text-card-foreground"><span>Quarterly estimate</span><span>{fmt(calc.k1Tax / 4)}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Paycheck Withholding Recommendation */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-card-foreground">Recommended Additional W2 Withholding Per Paycheck</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Paychecks remaining this quarter</Label>
              <Input type="number" min="1" value={paychecksRemQuarter} onChange={(e) => setPaychecksRemQuarter(parseInt(e.target.value) || 1)} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Paychecks remaining this year</Label>
              <Input type="number" min="1" value={paychecksRemYear} onChange={(e) => setPaychecksRemYear(parseInt(e.target.value) || 1)} />
            </div>
          </div>
          <div className="space-y-3">
            <div className="border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Extra per paycheck (quarterly)</p>
              <p className="text-2xl font-bold text-warning mt-1">{fmt(calc.perPaycheckQuarter)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Withhold an additional {fmt(calc.perPaycheckQuarter)} per paycheck for the next {paychecksRemQuarter} paychecks.
              </p>
            </div>
            <div className="border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Extra per paycheck (annual)</p>
              <p className="text-2xl font-bold text-primary mt-1">{fmt(calc.perPaycheckYear)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Recommended W-4 adjustment: add {fmt(calc.perPaycheckYear)} extra withholding per paycheck.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Quarterly Estimate Planner */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-card-foreground">Quarterly Estimated Payments</h3>
        <p className="text-xs text-muted-foreground">Based on projected 1099, K1, and W2 under-withholding</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {calc.quarterlyData.map((q) => (
            <div key={q.quarter} className={`rounded-lg border p-4 ${q.isPast ? "border-success/30 bg-success/5" : "border-border"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-card-foreground">{q.label}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${q.isPast ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {q.isPast ? "Paid" : "Due"}
                </span>
              </div>
              <p className="text-lg font-bold text-card-foreground mt-2">{fmt(q.total)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section 1: Monthly Income Forecast Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-card-foreground">Monthly Income Forecast</h3>
          <Button variant="outline" size="sm" onClick={() => setShowAddDialog(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Add Row
          </Button>
        </div>

        {/* Header */}
        <div className="hidden lg:grid lg:grid-cols-[120px_140px_80px_120px_120px_1fr_40px] gap-2 px-5 py-2 border-b border-border bg-muted/30 text-xs font-semibold text-muted-foreground">
          <span>Month</span>
          <span>Company</span>
          <span>Type</span>
          <span className="text-right">Gross Income</span>
          <span className="text-right">Withholding</span>
          <span>Notes</span>
          <span></span>
        </div>

        <div className="divide-y divide-border">
          {months.map((month) => {
            const rows = groupedByMonth[month] || [];
            if (rows.length === 0) return null;
            return rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col lg:grid lg:grid-cols-[120px_140px_80px_120px_120px_1fr_40px] gap-1 lg:gap-2 px-5 py-2 hover:bg-muted/50 transition-colors items-center"
              >
                <span className="text-xs text-muted-foreground">{formatMonth(row.month)}</span>
                <span className="text-sm font-medium text-card-foreground truncate">{row.companyName}</span>
                <span className="text-xs text-muted-foreground">{row.companyType}</span>
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 text-right text-sm"
                  value={row.grossIncome || ""}
                  onChange={(e) => updateForecast(row.id, { grossIncome: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                />
                <Input
                  type="number"
                  step="0.01"
                  className="h-8 text-right text-sm"
                  value={row.expectedWithholding || ""}
                  onChange={(e) => updateForecast(row.id, { expectedWithholding: parseFloat(e.target.value) || 0 })}
                  placeholder="0.00"
                />
                <Input
                  className="h-8 text-sm"
                  value={row.notes}
                  onChange={(e) => updateForecast(row.id, { notes: e.target.value })}
                  placeholder="Notes…"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => setDeleteId(row.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ));
          })}
        </div>
      </div>

      {/* Add Forecast Row Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Forecast Row</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Month</Label>
                <Select value={addMonth} onValueChange={setAddMonth}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {months.map((m) => <SelectItem key={m} value={m}>{formatMonth(m)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Company</Label>
                <Select value={addCompany} onValueChange={setAddCompany}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => <SelectItem key={c.id} value={c.name}>{c.name} ({c.companyType})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Anticipated Gross Income</Label>
                <Input type="number" step="0.01" value={addIncome} onChange={(e) => setAddIncome(e.target.value)} placeholder="25000" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Expected Withholding</Label>
                <Input type="number" step="0.01" value={addWithholding} onChange={(e) => setAddWithholding(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 block">Notes</Label>
              <Textarea value={addNotes} onChange={(e) => setAddNotes(e.target.value)} rows={2} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button onClick={handleAddRow}>Add</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Forecast Row</AlertDialogTitle>
            <AlertDialogDescription>Remove this forecast entry?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
