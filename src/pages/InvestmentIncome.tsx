import { useMemo, useState } from "react";
import { BarChart3, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateField } from "@/components/DateField";
import { cn } from "@/lib/utils";
import { useIncomeRecommendation } from "@/hooks/useIncomeRecommendation";
import {
  aggregateInvestmentTaxBuckets,
  calculateInvestmentTaxableAmount,
  investmentIncomeTypeLabels,
  useAddInvestmentIncomeEntry,
  useDeleteInvestmentIncomeEntry,
  useInvestmentIncomeEntries,
  useUpdateInvestmentIncomeEntry,
  type InvestmentIncomeEntry,
  type InvestmentIncomeType,
} from "@/hooks/useInvestmentIncome";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { calculateInvestmentTaxRecommendation } from "@/lib/investmentTaxRecommendation";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const num = (v: string) => Number.parseFloat(v) || 0;

type FormState = {
  entry_date: string;
  investment_income_type: InvestmentIncomeType;
  asset_name_or_ticker: string;
  sale_proceeds: string;
  cost_basis: string;
  taxable_amount: string;
  is_qualified_dividend: boolean;
  actual_tax_saved: string;
  notes: string;
};

const emptyForm: FormState = {
  entry_date: new Date().toISOString().split("T")[0],
  investment_income_type: "short_term_sale",
  asset_name_or_ticker: "",
  sale_proceeds: "",
  cost_basis: "",
  taxable_amount: "",
  is_qualified_dividend: true,
  actual_tax_saved: "",
  notes: "",
};

export default function InvestmentIncome() {
  const { data: entries = [], isLoading } = useInvestmentIncomeEntries();
  const addMutation = useAddInvestmentIncomeEntry();
  const updateMutation = useUpdateInvestmentIncomeEntry();
  const deleteMutation = useDeleteInvestmentIncomeEntry();
  const { getRecommendation } = useIncomeRecommendation();
  const { data: taxSettings } = useTaxSettings();
  const { forecastEstimate, actualEstimate } = useTaxEstimate();
  const investmentEnabled = taxSettings?.householdIncomeStreams?.investmentIncome !== false;
  const filingStatus = taxSettings?.filingStatus ?? "single";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saleDetailsOpen, setSaleDetailsOpen] = useState(false);
  const [howCalcOpen, setHowCalcOpen] = useState(false);

  const isDividend = form.investment_income_type === "dividend";
  const computedTaxable = calculateInvestmentTaxableAmount({
    type: form.investment_income_type,
    saleProceeds: num(form.sale_proceeds),
    costBasis: num(form.cost_basis),
    taxableAmountOverride: form.taxable_amount === "" ? null : num(form.taxable_amount),
  });
  const canShowTaxRecommendation = computedTaxable > 0 && (isDividend || (!!form.sale_proceeds && !!form.cost_basis));

  // Ordinary effective rate from the recommendation engine (fed into short-term/non-qualified div).
  const ordinaryRec = computedTaxable > 0
    ? getRecommendation({
        grossIncome: computedTaxable,
        incomeType: "personal_income",
        incomeBucket: "personal",
        federalWithheld: 0,
        stateWithheld: 0,
        retirement401k: 0,
        preTaxDeductions: 0,
      })
    : null;
  const ordinaryEffectiveRate = (ordinaryRec?.effectiveRate ?? 0) / 100;

  // Projected ordinary taxable income, excluding this entry's gain (avoid double-stacking).
  const baseEstimate = forecastEstimate ?? actualEstimate;
  const projectedOrdinaryTaxableIncome = Math.max(
    0,
    (baseEstimate?.taxableIncome ?? 0) - (computedTaxable > 0 && (form.investment_income_type === "long_term_sale" || (isDividend && form.is_qualified_dividend)) ? computedTaxable : 0),
  );

  const investmentRec = computedTaxable > 0
    ? calculateInvestmentTaxRecommendation({
        type: form.investment_income_type,
        taxableAmount: computedTaxable,
        isQualifiedDividend: form.is_qualified_dividend,
        filingStatus,
        projectedOrdinaryTaxableIncome,
        ordinaryEffectiveRate,
      })
    : null;

  const summary = useMemo(() => aggregateInvestmentTaxBuckets(entries), [entries]);

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      if ((key === "sale_proceeds" || key === "cost_basis" || key === "investment_income_type") && next.investment_income_type !== "dividend") {
        next.taxable_amount = String(num(next.sale_proceeds) - num(next.cost_basis));
      }
      if (key === "investment_income_type" && value === "dividend") {
        next.sale_proceeds = "";
        next.cost_basis = "";
        next.taxable_amount = "";
      }
      return next;
    });
  }

  function openAdd() {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
  }

  function openEdit(entry: InvestmentIncomeEntry) {
    setForm({
      entry_date: entry.entry_date,
      investment_income_type: entry.investment_income_type,
      asset_name_or_ticker: entry.asset_name_or_ticker,
      sale_proceeds: entry.sale_proceeds == null ? "" : String(entry.sale_proceeds),
      cost_basis: entry.cost_basis == null ? "" : String(entry.cost_basis),
      taxable_amount: String(entry.taxable_amount),
      is_qualified_dividend: entry.is_qualified_dividend ?? true,
      actual_tax_saved: entry.actual_tax_saved == null ? "" : String(entry.actual_tax_saved),
      notes: entry.notes || "",
    });
    setEditingId(entry.id);
    setShowForm(true);
  }

  function buildPayload() {
    const taxableAmount = computedTaxable;
    const rec = taxableAmount > 0
      ? calculateInvestmentTaxRecommendation({
          type: form.investment_income_type,
          taxableAmount,
          isQualifiedDividend: form.is_qualified_dividend,
          filingStatus,
          projectedOrdinaryTaxableIncome,
          ordinaryEffectiveRate,
        })
      : null;

    return {
      entry_date: form.entry_date,
      investment_income_type: form.investment_income_type,
      asset_name_or_ticker: form.asset_name_or_ticker.trim(),
      sale_proceeds: isDividend ? null : num(form.sale_proceeds),
      cost_basis: isDividend ? null : num(form.cost_basis),
      taxable_amount: taxableAmount,
      tax_recommendation: rec?.estimatedTax || 0,
      tax_rate_used: rec?.effectiveRate ?? null,
      tax_method_used: rec?.taxMethod ?? null,
      actual_tax_saved: form.actual_tax_saved === "" ? null : num(form.actual_tax_saved),
      is_qualified_dividend: isDividend ? form.is_qualified_dividend : true,
      notes: form.notes,
    };
  }

  function saveForm() {
    if (!form.entry_date || !form.asset_name_or_ticker.trim()) return;
    if (isDividend && num(form.taxable_amount) <= 0) return;
    if (!isDividend && (!form.sale_proceeds || !form.cost_basis)) return;

    const payload = buildPayload();
    if (editingId) {
      updateMutation.mutate({ id: editingId, ...payload } as any, {
        onSuccess: () => { setShowForm(false); setEditingId(null); },
      });
    } else {
      addMutation.mutate(payload as any, {
        onSuccess: () => setShowForm(false),
      });
    }
  }

  function confirmDelete() {
    if (!deleteId) return;
    deleteMutation.mutate(deleteId);
    setDeleteId(null);
  }

  if (isLoading) return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold text-foreground">Investment Income</h1>
            <p className="text-xs text-muted-foreground">Investment sales and dividends affecting your taxes</p>
          </div>
        </div>
        <Button size="sm" onClick={openAdd} disabled={!investmentEnabled} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      {!investmentEnabled && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Badge variant="outline" className="mr-2">Disabled income type</Badge>
          Investment income is turned off in your Household Income Profile. Existing entries are preserved for history; new entries are blocked. Enable it in Settings → Household Income Profile to add new investment activity.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="pt-3 pb-2"><p className="text-xs text-muted-foreground">Investment Taxable YTD</p><p className="text-lg font-bold">{fmt(summary.totalTaxableIncome)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-xs text-muted-foreground">Short-term Gains/Losses</p><p className={cn("text-lg font-bold", summary.shortTermSales < 0 ? "text-destructive" : "text-success")}>{fmt(summary.shortTermSales)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-xs text-muted-foreground">Long-term Gains/Losses</p><p className={cn("text-lg font-bold", summary.longTermSales < 0 ? "text-destructive" : "text-success")}>{fmt(summary.longTermSales)}</p></CardContent></Card>
        <Card><CardContent className="pt-3 pb-2"><p className="text-xs text-muted-foreground">Dividends</p><p className="text-lg font-bold">{fmt(summary.dividends)}</p></CardContent></Card>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Stock / asset / source</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Sale proceeds</TableHead>
                <TableHead className="text-right">Cost basis</TableHead>
                <TableHead className="text-right">Taxable gain/loss</TableHead>
                <TableHead className="text-right">Recommended tax savings</TableHead>
                <TableHead className="text-right">Actual tax saved</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead className="w-[88px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <TableRow><TableCell colSpan={11} className="text-center py-8 text-muted-foreground">No investment income entries yet</TableCell></TableRow>
              ) : entries.map((entry) => {
                const amount = Number(entry.taxable_amount || 0);
                const dividend = entry.investment_income_type === "dividend";
                const recommended = Number(entry.tax_recommendation || 0);
                const actualSavedRaw = entry.actual_tax_saved;
                const hasActual = actualSavedRaw != null && actualSavedRaw !== undefined && actualSavedRaw !== "" as any;
                const actualSaved = Number(actualSavedRaw || 0);
                const diff = actualSaved - recommended;
                return (
                  <TableRow key={entry.id}>
                    <TableCell>{new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</TableCell>
                    <TableCell className="font-medium">{entry.asset_name_or_ticker}</TableCell>
                    <TableCell>{investmentIncomeTypeLabels[entry.investment_income_type]}</TableCell>
                    <TableCell className="text-right">{dividend ? "—" : fmt(Number(entry.sale_proceeds || 0))}</TableCell>
                    <TableCell className="text-right">{dividend ? "—" : fmt(Number(entry.cost_basis || 0))}</TableCell>
                    <TableCell className={cn("text-right font-semibold", dividend ? "text-foreground" : amount < 0 ? "text-destructive" : "text-success")}>{fmt(amount)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{recommended > 0 ? fmt(recommended) : "—"}</TableCell>
                    <TableCell className={cn("text-right", hasActual ? "font-medium text-foreground" : "text-muted-foreground")}>{hasActual ? fmt(actualSaved) : "—"}</TableCell>
                    <TableCell className={cn("text-right font-medium", recommended <= 0 ? "text-muted-foreground" : diff >= 0 ? "text-success" : "text-destructive")}>{recommended > 0 ? `${diff >= 0 ? "+" : ""}${fmt(diff)}` : "—"}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Edit ${entry.asset_name_or_ticker}`} onClick={() => openEdit(entry)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete ${entry.asset_name_or_ticker}`} onClick={() => setDeleteId(entry.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) setEditingId(null); setShowForm(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] p-0 flex flex-col gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>{editingId ? "Edit" : "Add"} Investment Income</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground mb-1 block">Date</Label><DateField value={form.entry_date} onChange={(v) => setField("entry_date", v)} /></div>
              <div><Label className="text-xs text-muted-foreground mb-1 block">Investment income type</Label><Select value={form.investment_income_type} onValueChange={(v) => setField("investment_income_type", v as InvestmentIncomeType)}><SelectTrigger aria-label="Investment income type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short_term_sale">Short-term sale</SelectItem><SelectItem value="long_term_sale">Long-term sale</SelectItem><SelectItem value="dividend">Dividend</SelectItem></SelectContent></Select></div>
            </div>
            <div><Label className="text-xs text-muted-foreground mb-1 block">Stock / asset name or ticker</Label><Input aria-label="Stock / asset name or ticker" value={form.asset_name_or_ticker} onChange={(e) => setField("asset_name_or_ticker", e.target.value)} placeholder={isDividend ? "e.g. VTI dividend" : "e.g. AAPL"} /></div>
            {!isDividend && <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><div><Label className="text-xs text-muted-foreground mb-1 block">Total sale proceeds</Label><Input aria-label="Total sale proceeds" type="number" min="0" step="0.01" value={form.sale_proceeds} onChange={(e) => setField("sale_proceeds", e.target.value)} placeholder="0.00" /></div><div><Label className="text-xs text-muted-foreground mb-1 block">Cost basis</Label><Input aria-label="Cost basis" type="number" min="0" step="0.01" value={form.cost_basis} onChange={(e) => setField("cost_basis", e.target.value)} placeholder="0.00" /></div></div>}
            <div><Label className="text-xs text-muted-foreground mb-1 block">{isDividend ? "Taxable dividend amount" : "Taxable amount"}</Label><Input aria-label={isDividend ? "Taxable dividend amount" : "Taxable amount"} type="number" step="0.01" value={form.taxable_amount} onChange={(e) => setField("taxable_amount", e.target.value)} placeholder={isDividend ? "0.00" : String(num(form.sale_proceeds) - num(form.cost_basis))} className={cn(!isDividend && computedTaxable < 0 ? "text-destructive" : "text-foreground")} /><p className="text-[10px] text-muted-foreground mt-1">{isDividend ? "Used for dividend tax calculations." : "Defaults to sale proceeds minus cost basis; override if needed."}</p></div>
            {isDividend && (
              <div className="flex items-center justify-between rounded-md border border-border p-2.5">
                <div>
                  <Label className="text-sm">Qualified dividend</Label>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Qualified dividends use long-term capital gains rates. Non-qualified use ordinary rates.</p>
                </div>
                <Switch checked={form.is_qualified_dividend} onCheckedChange={(v) => setField("is_qualified_dividend", v)} aria-label="Qualified dividend" />
              </div>
            )}
            <div><Label className="text-xs text-muted-foreground mb-1 block">Notes</Label><Input value={form.notes} onChange={(e) => setField("notes", e.target.value)} placeholder="Optional" /></div>
            {canShowTaxRecommendation && investmentRec && (
              <div className="rounded-md border border-border bg-muted/30 p-2.5 text-sm space-y-2">
                <div>
                  <div>
                    <span className="text-muted-foreground">Recommended tax savings: </span>
                    <span className="font-semibold text-foreground">{fmt(investmentRec.estimatedTax)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">This is the recommended amount to save for taxes based on the investment income type and your projected tax profile.</p>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-border">
                  <span className="text-muted-foreground">Taxable amount</span>
                  <span className="text-right font-medium">{fmt(investmentRec.taxableAmount)}</span>
                  <span className="text-muted-foreground">Tax method</span>
                  <span className="text-right font-medium">{investmentRec.methodLabel}</span>
                  <span className="text-muted-foreground">Tax rate used</span>
                  <span className="text-right font-medium">{investmentRec.rateLabel}</span>
                </div>
                <p className="text-[11px] text-muted-foreground">Long-term gains use capital gains rates. Short-term gains are taxed like ordinary income.</p>
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block" htmlFor="actual-tax-saved">Actual tax saved</Label>
              <Input id="actual-tax-saved" aria-label="Actual tax saved" type="number" min="0" step="0.01" value={form.actual_tax_saved} onChange={(e) => setField("actual_tax_saved", e.target.value)} placeholder="0.00" />
              <p className="text-[10px] text-muted-foreground mt-1">Enter how much you actually moved into tax savings for this investment income.</p>
            </div>
          </div>
          <div className="shrink-0 border-t border-border px-6 py-3 flex justify-between gap-2 bg-background">
            {editingId ? <Button variant="destructive" size="sm" onClick={() => { setDeleteId(editingId); setShowForm(false); }}><Trash2 className="h-4 w-4 mr-1" /> Delete</Button> : <div />}
            <div className="flex gap-2"><Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button><Button onClick={saveForm} disabled={!form.entry_date || !form.asset_name_or_ticker.trim()}>{editingId ? "Save" : "Save Entry"}</Button></div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete investment income entry?</AlertDialogTitle><AlertDialogDescription>This will permanently remove this investment income entry.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
