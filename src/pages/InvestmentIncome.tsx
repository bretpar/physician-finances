import { Fragment, useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Info, Pencil, Plus, Trash2 } from "lucide-react";
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
  const bothSaleFieldsFilled = !isDividend && form.sale_proceeds !== "" && form.cost_basis !== "";
  const taxableIsCalculated = bothSaleFieldsFilled;
  const canShowTaxRecommendation = computedTaxable > 0;

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
        if (next.sale_proceeds !== "" && next.cost_basis !== "") {
          next.taxable_amount = String(num(next.sale_proceeds) - num(next.cost_basis));
        }
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
    setSaleDetailsOpen(false);
    setHowCalcOpen(false);
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
    setSaleDetailsOpen(false);
    setHowCalcOpen(false);
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
      sale_proceeds: isDividend ? null : (form.sale_proceeds === "" ? null : num(form.sale_proceeds)),
      cost_basis: isDividend ? null : (form.cost_basis === "" ? null : num(form.cost_basis)),
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
    if (form.taxable_amount === "" && !bothSaleFieldsFilled) return;

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
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">No investment income entries yet</div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[8px]" />
                      <TableHead>Date</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead className="text-right">Proceeds</TableHead>
                      <TableHead className="text-right">Taxable</TableHead>
                      <TableHead className="text-right">Actual saved</TableHead>
                      <TableHead className="w-[88px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((entry) => {
                      const amount = Number(entry.taxable_amount || 0);
                      const dividend = entry.investment_income_type === "dividend";
                      const recommended = Number(entry.tax_recommendation || 0);
                      const actualSavedRaw = entry.actual_tax_saved;
                      const hasActual = actualSavedRaw != null && (actualSavedRaw as any) !== "";
                      const actualSaved = Number(actualSavedRaw || 0);
                      const diff = actualSaved - recommended;
                      const isExpanded = expandedId === entry.id;
                      const toggle = () => setExpandedId(isExpanded ? null : entry.id);
                      return (
                        <Fragment key={entry.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={toggle}
                          >
                            <TableCell className="pr-0">
                              {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{new Date(entry.entry_date + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</TableCell>
                            <TableCell className="font-medium max-w-[260px] truncate">{entry.asset_name_or_ticker}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">{dividend || entry.sale_proceeds == null ? "—" : fmt(Number(entry.sale_proceeds || 0))}</TableCell>
                            <TableCell className={cn("text-right font-semibold whitespace-nowrap", dividend ? "text-foreground" : amount < 0 ? "text-destructive" : "text-success")}>{fmt(amount)}</TableCell>
                            <TableCell className={cn("text-right whitespace-nowrap", hasActual ? "font-medium text-foreground" : "text-muted-foreground")}>{hasActual ? fmt(actualSaved) : "—"}</TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-1">
                                <Button variant="ghost" size="icon" aria-label={`Edit ${entry.asset_name_or_ticker}`} onClick={() => openEdit(entry)}><Pencil className="h-4 w-4" /></Button>
                                <Button variant="ghost" size="icon" aria-label={`Delete ${entry.asset_name_or_ticker}`} onClick={() => setDeleteId(entry.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <TableRow key={entry.id + "-details"} className="bg-muted/20 hover:bg-muted/20">
                              <TableCell />
                              <TableCell colSpan={6} className="py-3">
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
                                  <div><dt className="text-muted-foreground">Type</dt><dd className="font-medium text-foreground">{investmentIncomeTypeLabels[entry.investment_income_type]}</dd></div>
                                  <div><dt className="text-muted-foreground">Cost basis</dt><dd className="font-medium text-foreground">{dividend || entry.cost_basis == null ? "—" : fmt(Number(entry.cost_basis || 0))}</dd></div>
                                  <div><dt className="text-muted-foreground">Recommended tax savings</dt><dd className="font-medium text-foreground">{recommended > 0 ? fmt(recommended) : "—"}</dd></div>
                                  <div><dt className="text-muted-foreground">Difference</dt><dd className={cn("font-medium", recommended <= 0 ? "text-muted-foreground" : diff >= 0 ? "text-success" : "text-destructive")}>{recommended > 0 ? `${diff >= 0 ? "+" : ""}${fmt(diff)}` : "—"}</dd></div>
                                  {entry.notes && (
                                    <div className="col-span-2"><dt className="text-muted-foreground">Notes</dt><dd className="text-foreground whitespace-pre-wrap">{entry.notes}</dd></div>
                                  )}
                                </dl>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile list */}
              <ul className="md:hidden divide-y divide-border">
                {entries.map((entry) => {
                  const amount = Number(entry.taxable_amount || 0);
                  const dividend = entry.investment_income_type === "dividend";
                  const recommended = Number(entry.tax_recommendation || 0);
                  const actualSavedRaw = entry.actual_tax_saved;
                  const hasActual = actualSavedRaw != null && (actualSavedRaw as any) !== "";
                  const actualSaved = Number(actualSavedRaw || 0);
                  const diff = actualSaved - recommended;
                  const isExpanded = expandedId === entry.id;
                  const toggle = () => setExpandedId(isExpanded ? null : entry.id);
                  const dateObj = new Date(entry.entry_date + "T00:00:00");
                  const shortDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  const fullDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                  return (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={toggle}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <span className="text-xs text-muted-foreground w-12 shrink-0">{shortDate}</span>
                        <span className="flex-1 min-w-0 truncate text-sm font-medium text-foreground">{entry.asset_name_or_ticker}</span>
                        <span className={cn("text-sm font-semibold tabular-nums", dividend ? "text-foreground" : amount < 0 ? "text-destructive" : "text-success")}>{fmt(amount)}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Edit ${entry.asset_name_or_ticker}`}
                          onClick={(e) => { e.stopPropagation(); openEdit(entry); }}
                          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); openEdit(entry); } }}
                          className="p-1 -mr-1 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="h-4 w-4" />
                        </span>
                      </button>
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 bg-muted/20">
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                            <div><dt className="text-muted-foreground">Date</dt><dd className="font-medium text-foreground">{fullDate}</dd></div>
                            <div><dt className="text-muted-foreground">Type</dt><dd className="font-medium text-foreground">{investmentIncomeTypeLabels[entry.investment_income_type]}</dd></div>
                            <div><dt className="text-muted-foreground">Proceeds</dt><dd className="font-medium text-foreground">{dividend || entry.sale_proceeds == null ? "—" : fmt(Number(entry.sale_proceeds || 0))}</dd></div>
                            <div><dt className="text-muted-foreground">Cost basis</dt><dd className="font-medium text-foreground">{dividend || entry.cost_basis == null ? "—" : fmt(Number(entry.cost_basis || 0))}</dd></div>
                            <div><dt className="text-muted-foreground">Recommended tax savings</dt><dd className="font-medium text-foreground">{recommended > 0 ? fmt(recommended) : "—"}</dd></div>
                            <div><dt className="text-muted-foreground">Actual tax saved</dt><dd className="font-medium text-foreground">{hasActual ? fmt(actualSaved) : "—"}</dd></div>
                            <div><dt className="text-muted-foreground">Difference</dt><dd className={cn("font-medium", recommended <= 0 ? "text-muted-foreground" : diff >= 0 ? "text-success" : "text-destructive")}>{recommended > 0 ? `${diff >= 0 ? "+" : ""}${fmt(diff)}` : "—"}</dd></div>
                            {entry.notes && (
                              <div className="col-span-2"><dt className="text-muted-foreground">Notes</dt><dd className="text-foreground whitespace-pre-wrap">{entry.notes}</dd></div>
                            )}
                          </dl>
                          <div className="flex justify-end pt-3">
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setDeleteId(entry.id)}>
                              <Trash2 className="h-4 w-4 mr-1.5" /> Delete
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={(open) => { if (!open) setEditingId(null); setShowForm(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] p-0 flex flex-col gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>{editingId ? "Edit" : "Add"} Investment Income</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground mb-1 block">Investment income type</Label><Select value={form.investment_income_type} onValueChange={(v) => setField("investment_income_type", v as InvestmentIncomeType)}><SelectTrigger aria-label="Investment income type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short_term_sale">Short-term sale</SelectItem><SelectItem value="long_term_sale">Long-term sale</SelectItem><SelectItem value="dividend">Dividend</SelectItem></SelectContent></Select></div>
              <div><Label className="text-xs text-muted-foreground mb-1 block">Date</Label><DateField value={form.entry_date} onChange={(v) => setField("entry_date", v)} /></div>
            </div>
            <div><Label className="text-xs text-muted-foreground mb-1 block">Stock / asset name or ticker</Label><Input aria-label="Stock / asset name or ticker" value={form.asset_name_or_ticker} onChange={(e) => setField("asset_name_or_ticker", e.target.value)} placeholder={isDividend ? "e.g. VTI dividend" : "e.g. AAPL"} /></div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">{isDividend ? "Taxable dividend amount" : "Taxable amount"}</Label>
              <Input
                aria-label={isDividend ? "Taxable dividend amount" : "Taxable amount"}
                type="number"
                step="0.01"
                value={form.taxable_amount}
                onChange={(e) => setField("taxable_amount", e.target.value)}
                placeholder="0.00"
                disabled={taxableIsCalculated}
                className={cn(!isDividend && computedTaxable < 0 ? "text-destructive" : "text-foreground")}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                {isDividend
                  ? "Used for dividend tax calculations."
                  : taxableIsCalculated
                    ? "Calculated from sale proceeds minus cost basis."
                    : "Enter the taxable gain or loss for this investment."}
              </p>
            </div>
            {!isDividend && (
              <Collapsible open={saleDetailsOpen} onOpenChange={setSaleDetailsOpen}>
                <CollapsibleTrigger className="flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors w-full py-2">
                  {saleDetailsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  Calculate taxable amount from sale details
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div><Label className="text-xs text-muted-foreground mb-1 block">Total sale proceeds</Label><Input aria-label="Total sale proceeds" type="number" min="0" step="0.01" value={form.sale_proceeds} onChange={(e) => setField("sale_proceeds", e.target.value)} placeholder="0.00" /></div>
                    <div><Label className="text-xs text-muted-foreground mb-1 block">Cost basis</Label><Input aria-label="Cost basis" type="number" min="0" step="0.01" value={form.cost_basis} onChange={(e) => setField("cost_basis", e.target.value)} placeholder="0.00" /></div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
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
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground">Recommended tax savings</span>
                  <span className="font-semibold text-foreground">{fmt(investmentRec.estimatedTax)}</span>
                </div>
                <Collapsible open={howCalcOpen} onOpenChange={setHowCalcOpen}>
                  <CollapsibleTrigger className="flex w-full items-center justify-between text-[11px] text-muted-foreground hover:text-foreground">
                    <span>How was this calculated?</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", howCalcOpen && "rotate-180")} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] pt-1 border-t border-border">
                      <span className="text-muted-foreground">Taxable amount</span>
                      <span className="text-right font-medium">{fmt(investmentRec.taxableAmount)}</span>
                      <span className="text-muted-foreground">Tax method</span>
                      <span className="text-right font-medium">{investmentRec.methodLabel}</span>
                      <span className="text-muted-foreground">Tax rate used</span>
                      <span className="text-right font-medium">{investmentRec.rateLabel}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Long-term gains use capital gains rates. Short-term gains are taxed like ordinary income.</p>
                  </CollapsibleContent>
                </Collapsible>
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
