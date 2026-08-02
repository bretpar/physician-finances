import { Fragment, useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Info, Pencil, Plus, Trash2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
import { formatDate, formatDateShort } from "@/lib/localDate";
import { Switch } from "@/components/ui/switch";
import { TransactionDetailSheet, type DetailSection } from "@/components/TransactionDetailSheet";

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
  const { data: taxSettings } = useTaxSettings();
  const { forecastEstimate, actualEstimate } = useTaxEstimate();
  const investmentEnabled = taxSettings?.householdIncomeStreams?.investmentIncome !== false;
  const filingStatus = taxSettings?.filingStatus ?? "single";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailEntry, setDetailEntry] = useState<InvestmentIncomeEntry | null>(null);
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

  // Single source of truth: stack this entry's slice on top of the live engine's
  // taxable income (excluding this entry to avoid double-counting). LTCG/qualified
  // dividends use LTCG brackets; short-term/non-qualified use ordinary brackets —
  // both via blended marginal slice math identical to the Tax Overview engine.
  const baseEstimate = forecastEstimate ?? actualEstimate;
  const projectedOrdinaryTaxableIncome = Math.max(
    0,
    (baseEstimate?.taxableIncome ?? 0) - (computedTaxable > 0 ? computedTaxable : 0),
  );

  const investmentRec = computedTaxable > 0
    ? calculateInvestmentTaxRecommendation({
        type: form.investment_income_type,
        taxableAmount: computedTaxable,
        isQualifiedDividend: form.is_qualified_dividend,
        filingStatus,
        projectedOrdinaryTaxableIncome,
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
    <div className="space-y-4 max-w-5xl mx-auto px-4 md:px-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <BarChart3 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground leading-tight">Investment Income</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Investment sales and dividends affecting your taxes</p>
          </div>
        </div>
        <Button
          data-testid="investment-add-entry"
          size="sm"
          onClick={openAdd}
          disabled={!investmentEnabled}
          className="gap-1 shrink-0 h-9 px-3"
        >
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      {!investmentEnabled && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Badge variant="outline" className="mr-2">Disabled income type</Badge>
          Investment income is turned off in your Household Income Profile. Existing entries are preserved for history; new entries are blocked. Enable it in Settings → Household Income Profile to add new investment activity.
        </div>
      )}

      {/* Primary summary card */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">Investment Taxable Income</p>
          <p className="text-3xl font-bold tracking-tight text-foreground mt-0.5">
            {fmt(summary.totalTaxableIncome)} <span className="text-sm font-medium text-muted-foreground">YTD</span>
          </p>
          <dl className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-x-4 divide-y divide-border sm:divide-y-0">
            {[
              { label: "Long-term gains", value: summary.longTermSales },
              { label: "Short-term gains", value: summary.shortTermSales },
              { label: "Dividends", value: summary.dividends },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between sm:block py-1.5 sm:py-0">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className={cn("text-sm font-semibold tabular-nums sm:mt-0.5", amountTone(row.value))}>{fmt(row.value)}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            onClick={() => setExplainOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary hover:underline min-h-[44px] sm:min-h-0 sm:py-1"
          >
            <Info className="h-3.5 w-3.5" /> How investment taxes are calculated
          </button>
        </CardContent>
      </Card>

      {/* Investment activity */}
      <div className="space-y-2">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Investment Activity</h2>
          <p className="text-xs text-muted-foreground">
            {entries.length} {entries.length === 1 ? "entry" : "entries"} • {fmt(summary.totalTaxableIncome)} taxable YTD
          </p>
        </div>

        {entries.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-1">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={cn(
                  "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  filter === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        <Card>
          <CardContent className="p-0">
            {entries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No investment income entries yet</div>
            ) : visibleEntries.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">No entries match this filter</div>
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
                      {visibleEntries.map((entry) => {
                        const amount = Number(entry.taxable_amount || 0);
                        const dividend = entry.investment_income_type === "dividend";
                        const recommended = Number(entry.tax_recommendation || 0);
                        const actualSavedRaw = entry.actual_tax_saved;
                        const hasActual = actualSavedRaw != null && (actualSavedRaw as any) !== "";
                        const actualSaved = Number(actualSavedRaw || 0);
                        const isExpanded = expandedId === entry.id;
                        const label = splitEntryLabel(entry);
                        const toggle = () => setDetailEntry(entry);
                        return (
                          <Fragment key={entry.id}>
                            <TableRow
                              className="cursor-pointer hover:bg-muted/40"
                              onClick={toggle}
                            >
                              <TableCell className="pr-0">
                                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              </TableCell>
                              <TableCell className="whitespace-nowrap">{formatDate(entry.entry_date)}</TableCell>
                              <TableCell className="max-w-[260px]">
                                <span className="block truncate font-medium">{label.primary}</span>
                                <span className="block truncate text-xs text-muted-foreground">{label.secondary}</span>
                              </TableCell>
                              <TableCell className="text-right whitespace-nowrap">{dividend || entry.sale_proceeds == null ? "—" : fmt(Number(entry.sale_proceeds || 0))}</TableCell>
                              <TableCell className={cn("text-right font-semibold whitespace-nowrap", dividend ? "text-foreground" : amountTone(amount))}>{fmt(amount)}</TableCell>
                              <TableCell className={cn("text-right whitespace-nowrap", hasActual ? "font-medium text-foreground" : "text-muted-foreground")}>{hasActual ? fmt(actualSaved) : "—"}</TableCell>
                              <TableCell onClick={(e) => e.stopPropagation()}>
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="icon" aria-label={`Edit ${entry.asset_name_or_ticker}`} onClick={() => openEdit(entry)}><Pencil className="h-4 w-4" /></Button>
                                  <Button variant="ghost" size="icon" aria-label={`Delete ${entry.asset_name_or_ticker}`} onClick={() => setDeleteId(entry.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          </Fragment>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile list */}
                <ul className="md:hidden divide-y divide-border">
                  {visibleEntries.map((entry) => {
                    const amount = Number(entry.taxable_amount || 0);
                    const dividend = entry.investment_income_type === "dividend";
                    const recommended = Number(entry.tax_recommendation || 0);
                    const actualSavedRaw = entry.actual_tax_saved;
                    const hasActual = actualSavedRaw != null && (actualSavedRaw as any) !== "";
                    const actualSaved = Number(actualSavedRaw || 0);
                    const isExpanded = expandedId === entry.id;
                    const label = splitEntryLabel(entry);
                    const shortDate = formatDateShort(entry.entry_date);
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                          className="w-full flex items-center gap-3 px-4 py-2.5 min-h-[56px] text-left hover:bg-muted/40"
                          aria-expanded={isExpanded}
                        >
                          <span className="flex-1 min-w-0">
                            <span className="block text-xs text-muted-foreground">{shortDate}</span>
                            <span className="block truncate text-sm font-medium text-foreground">{label.primary}</span>
                            <span className="block truncate text-xs text-muted-foreground">{label.secondary}</span>
                          </span>
                          <span className={cn("text-sm font-semibold tabular-nums text-right shrink-0", dividend ? "text-foreground" : amountTone(amount))}>
                            {gainLossLabel(amount, dividend)}
                          </span>
                          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                        </button>
                        {isExpanded && (
                          <div className="px-4 pb-3 pt-1 bg-muted/20">
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                              <div><dt className="text-muted-foreground">Sale proceeds</dt><dd className="font-medium text-foreground">{dividend || entry.sale_proceeds == null ? "—" : fmt(Number(entry.sale_proceeds || 0))}</dd></div>
                              <div><dt className="text-muted-foreground">Cost basis</dt><dd className="font-medium text-foreground">{dividend || entry.cost_basis == null ? "—" : fmt(Number(entry.cost_basis || 0))}</dd></div>
                              <div><dt className="text-muted-foreground">{dividend ? "Taxable dividend" : "Gain or loss"}</dt><dd className={cn("font-medium", dividend ? "text-foreground" : amountTone(amount))}>{gainLossLabel(amount, dividend)}</dd></div>
                              <div><dt className="text-muted-foreground">Holding period</dt><dd className="font-medium text-foreground">{holdingPeriodLabel(entry.investment_income_type)}</dd></div>
                              {dividend && (
                                <div><dt className="text-muted-foreground">Dividend classification</dt><dd className="font-medium text-foreground">{entry.is_qualified_dividend === false ? "Non-qualified" : "Qualified"}</dd></div>
                              )}
                              <div><dt className="text-muted-foreground">Recommended tax amount</dt><dd className="font-medium text-foreground">{recommended > 0 ? fmt(recommended) : "—"}</dd></div>
                              {hasActual && (
                                <div><dt className="text-muted-foreground">Actual tax saved</dt><dd className="font-medium text-foreground">{fmt(actualSaved)}</dd></div>
                              )}
                              {entry.notes && (
                                <div className="col-span-2"><dt className="text-muted-foreground">Notes</dt><dd className="text-foreground whitespace-pre-wrap">{entry.notes}</dd></div>
                              )}
                            </dl>
                            <div className="flex items-center justify-end gap-2 pt-3">
                              <Button variant="outline" size="sm" className="min-h-[44px]" onClick={() => openEdit(entry)}>
                                <Pencil className="h-4 w-4 mr-1.5" /> Edit
                              </Button>
                              <Button variant="ghost" size="sm" className="min-h-[44px] text-destructive hover:text-destructive" onClick={() => setDeleteId(entry.id)}>
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
      </div>

      {/* How investment taxes are calculated */}
      <Dialog open={explainOpen} onOpenChange={setExplainOpen}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] rounded-lg">
          <DialogHeader><DialogTitle className="text-base">How investment taxes are calculated</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <div>
              <p className="font-semibold text-foreground">Tax treatment</p>
              <ul className="mt-1 list-disc pl-4 space-y-1 text-muted-foreground">
                <li>Short-term gains and non-qualified dividends are taxed as ordinary income.</li>
                <li>Long-term gains and qualified dividends use long-term capital-gains brackets.</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-foreground">Current limitation</p>
              <ul className="mt-1 list-disc pl-4 space-y-1 text-muted-foreground">
                <li>Cross-category capital-loss netting and the annual $3,000 loss limit are not fully modeled yet.</li>
              </ul>
            </div>
          </div>
          <div className="flex justify-end pt-1">
            <Button size="sm" onClick={() => setExplainOpen(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>


      <Dialog open={showForm} onOpenChange={(open) => { if (!open) setEditingId(null); setShowForm(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] p-0 flex flex-col gap-0">
          <DialogHeader className="px-6 pt-6 pb-2 shrink-0"><DialogTitle>{editingId ? "Edit" : "Add"} Investment Income</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><Label className="text-xs text-muted-foreground mb-1 block">Investment income type</Label><Select value={form.investment_income_type} onValueChange={(v) => setField("investment_income_type", v as InvestmentIncomeType)}><SelectTrigger data-testid="investment-entry-type" aria-label="Investment income type"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="short_term_sale">Short-term sale</SelectItem><SelectItem value="long_term_sale">Long-term sale</SelectItem><SelectItem value="dividend">Dividend</SelectItem></SelectContent></Select></div>
              <div><Label className="text-xs text-muted-foreground mb-1 block">Date</Label><DateField value={form.entry_date} onChange={(v) => setField("entry_date", v)} /></div>
            </div>
            <div><Label className="text-xs text-muted-foreground mb-1 block">Stock / asset name or ticker</Label><Input aria-label="Stock / asset name or ticker" value={form.asset_name_or_ticker} onChange={(e) => setField("asset_name_or_ticker", e.target.value)} placeholder={isDividend ? "e.g. VTI dividend" : "e.g. AAPL"} /></div>
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Label className="text-xs text-muted-foreground">{isDividend ? "Taxable dividend amount" : "Taxable amount"}</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-[240px]">
                      {isDividend
                        ? "Used for dividend tax calculations."
                        : taxableIsCalculated
                          ? "Calculated from sale proceeds minus cost basis."
                          : "Enter the taxable gain or loss for this investment."}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Input
                data-testid="investment-taxable-amount"
                aria-label={isDividend ? "Taxable dividend amount" : "Taxable amount"}
                type="number"
                step="0.01"
                value={form.taxable_amount}
                onChange={(e) => setField("taxable_amount", e.target.value)}
                placeholder="0.00"
                disabled={taxableIsCalculated}
                className={cn(!isDividend && computedTaxable < 0 ? "text-destructive" : "text-foreground")}
              />
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

      {detailEntry && (() => {
        const e = detailEntry;
        const dividend = e.investment_income_type === "dividend";
        const taxable = Number(e.taxable_amount || 0);
        const recommended = Number(e.tax_recommendation || 0);
        const actualSavedRaw = e.actual_tax_saved;
        const hasActual = actualSavedRaw != null && (actualSavedRaw as any) !== "";
        const actualSaved = Number(actualSavedRaw || 0);
        const sections: DetailSection[] = [
          {
            title: "Basic details",
            fields: [
              { label: "Type", value: investmentIncomeTypeLabels[e.investment_income_type] },
              { label: "Asset", value: e.asset_name_or_ticker },
              ...(e.notes ? [{ label: "Notes", value: e.notes }] : []),
            ],
          },
          {
            title: "Tax details",
            fields: [
              ...(dividend || e.sale_proceeds == null ? [] : [{ label: "Proceeds", value: fmt(Number(e.sale_proceeds || 0)), mono: true }]),
              ...(dividend || e.cost_basis == null ? [] : [{ label: "Cost basis", value: fmt(Number(e.cost_basis || 0)), mono: true }]),
              { label: "Gross", value: fmt(taxable), mono: true },
              { label: "Net received", value: fmt(taxable - (hasActual ? actualSaved : 0)), mono: true },
              ...(recommended > 0 ? [{ label: "Recommended set-aside", value: fmt(recommended), mono: true }] : []),
              ...(hasActual && actualSaved > 0 ? [{ label: "Amount saved for taxes", value: fmt(actualSaved), mono: true }] : []),
            ],
          },
        ];
        return (
          <TransactionDetailSheet
            open={!!detailEntry}
            onOpenChange={(o) => { if (!o) setDetailEntry(null); }}
            header={{
              title: e.asset_name_or_ticker,
              subtitle: investmentIncomeTypeLabels[e.investment_income_type],
              date: formatDate(e.entry_date),
              amount: taxable,
              amountTone: dividend ? "neutral" : taxable < 0 ? "expense" : "income",
            }}
            sections={sections}
            onEdit={() => { const t = e; setDetailEntry(null); openEdit(t); }}
            onDelete={() => { setDeleteId(e.id); setDetailEntry(null); }}
          />
        );
      })()}
    </div>
  );
}
