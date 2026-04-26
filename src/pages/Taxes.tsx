import { useState, useMemo } from "react";
import { format } from "date-fns";
import {
  Info, Plus, Pencil, Trash2, CalendarIcon, ExternalLink, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import TaxBreakdown from "@/components/tax-breakdown/TaxBreakdown";
import { cn } from "@/lib/utils";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import TaxDebugPanel from "@/components/TaxDebugPanel";
import { useTaxSavings, useAddTaxSaving, useUpdateTaxSaving, useDeleteTaxSaving } from "@/hooks/useTaxSavings";
import { useTaxPayments, useAddTaxPayment, useUpdateTaxPayment, useDeleteTaxPayment } from "@/hooks/useTaxPayments";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useCompanies } from "@/contexts/CompanyContext";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks } from "@/hooks/useProjectedIncome";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const paymentYear = new Date().getFullYear();
const PAYMENT_QUARTERS = [
  { key: "Q1", label: "Q1", dueLabel: "Apr 15" },
  { key: "Q2", label: "Q2", dueLabel: "Jun 15" },
  { key: "Q3", label: "Q3", dueLabel: "Sep 15" },
  { key: "Q4", label: "Q4", dueLabel: "Jan 15" },
];

export default function Taxes() {
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { estimate, isLoading: estLoading, taxMode, setTaxMode, actualEstimate, forecastEstimate, actualDebug, forecastDebug } = useTaxEstimate();
  const { data: savings = [] } = useTaxSavings();
  const { data: payments = [] } = useTaxPayments();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { companies } = useCompanies();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();

  const addSaving = useAddTaxSaving();
  const updateSaving = useUpdateTaxSaving();
  const deleteSaving = useDeleteTaxSaving();
  const addPayment = useAddTaxPayment();
  const updatePayment = useUpdateTaxPayment();
  const deletePayment = useDeleteTaxPayment();

  // Savings form
  const [savingsOpen, setSavingsOpen] = useState(false);
  const [savingsEditId, setSavingsEditId] = useState<string | null>(null);
  const [savingsDate, setSavingsDate] = useState<Date>(new Date());
  const [savingsAmount, setSavingsAmount] = useState("");
  const [savingsSource, setSavingsSource] = useState("manual");
  const [savingsNotes, setSavingsNotes] = useState("");
  const [savingsDeleteId, setSavingsDeleteId] = useState<string | null>(null);

  // Payment form
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentEditId, setPaymentEditId] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState<Date>(new Date());
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentQuarter, setPaymentQuarter] = useState("Q1");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentDeleteId, setPaymentDeleteId] = useState<string | null>(null);

  const [showHow, setShowHow] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isLoading = ratesLoading || estLoading || txLoading || incLoading || piLoading;

  const e = estimate;
  const debug = taxMode === "actual" ? actualDebug : forecastDebug;
  const totalSetAside = savings.reduce((s, sv) => s + Number(sv.amount), 0);

  // Use the unified debug breakdown as the source of truth so UI matches engine.
  const estimatedOwed = debug?.totalEstimatedTax ?? e?.totalTaxLiability ?? 0;
  const totalGrossIncome = e?.totalIncome ?? ((e?.w2Income ?? 0) + (e?.grossBusinessIncome ?? 0) + (e?.otherIncome ?? 0));
  const overviewProfile = getSelectedWithholdingProfileRate({
    taxSettings: rates,
    actualEstimate,
    forecastEstimate: taxMode === "actual" ? actualEstimate : forecastEstimate,
  });
  const overviewEffectiveRate = rates?.withholdingMethod === "flat_estimate"
    ? overviewProfile.federalProfileRate
    : e?.effectiveRate ?? overviewProfile.canonicalEffectiveTaxRate;
  const estPaymentsMade = debug?.estimatedPaymentsMade ?? 0;
  const totalCovered = debug?.countedCreditsTotal ?? 0;
  const remainingTax = debug?.remainingTaxDue ?? Math.max(0, estimatedOwed - totalCovered);
  const projectedPaychecks = useMemo(
    () =>
      generateProjectedPaychecks(streams || [], bonuses || [], incomeEntries).map((p) => ({
        date: p.date,
        grossAmount: Number(p.grossAmount || 0),
      })),
    [streams, bonuses, incomeEntries],
  );
  const method = rates?.withholdingMethod ?? "dynamic_actual";
  const trackerEstimate = method === "flat_estimate" ? actualEstimate : (forecastEstimate ?? actualEstimate);
  const personalRate = getSavingsRateForIncomeBucket({
    incomeBucket: "personal",
    incomeType: "W2",
    taxSettings: rates,
    actualEstimate,
    forecastEstimate,
  }).rate;
  const businessRate = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: rates,
    actualEstimate,
    forecastEstimate,
    includeSETaxInRecommendation: true,
  }).rate;
  const annualTaxLiability = Math.max(0, Number(trackerEstimate?.totalTaxLiability || 0));
  const trackerEffectiveTaxRate = method === "flat_estimate" ? overviewProfile.federalProfileRate : overviewProfile.canonicalEffectiveTaxRate;

  const resetSavingsForm = () => { setSavingsDate(new Date()); setSavingsAmount(""); setSavingsSource("manual"); setSavingsNotes(""); setSavingsEditId(null); };
  const resetPaymentForm = () => { setPaymentDate(new Date()); setPaymentAmount(""); setPaymentQuarter("Q1"); setPaymentNotes(""); setPaymentEditId(null); };

  const handleSavingsSubmit = () => {
    const amt = Number(savingsAmount);
    if (!amt || amt <= 0) return;
    const payload = { savings_date: format(savingsDate, "yyyy-MM-dd"), amount: amt, source: savingsSource, notes: savingsNotes };
    if (savingsEditId) {
      updateSaving.mutate({ id: savingsEditId, ...payload }, { onSuccess: () => { setSavingsOpen(false); resetSavingsForm(); } });
    } else {
      addSaving.mutate(payload, { onSuccess: () => { setSavingsOpen(false); resetSavingsForm(); } });
    }
  };

  const handlePaymentSubmit = () => {
    const amt = Number(paymentAmount);
    if (!amt || amt <= 0) return;
    const payload = { payment_date: format(paymentDate, "yyyy-MM-dd"), amount: amt, quarter: paymentQuarter, notes: paymentNotes };
    if (paymentEditId) {
      updatePayment.mutate({ id: paymentEditId, ...payload }, { onSuccess: () => { setPaymentOpen(false); resetPaymentForm(); } });
    } else {
      addPayment.mutate(payload, { onSuccess: () => { setPaymentOpen(false); resetPaymentForm(); } });
    }
  };

  const getQuarterExportRows = (q: (typeof quarterData)[number], statusLabel: string) => [
    ["Section", "Item", "Date", "Amount", "Notes"],
    ["Summary", "Quarter", "", q.label, `Due ${q.dueLabel}`],
    ["Summary", "Status", "", statusLabel, ""],
    ["Summary", "Estimated due", "", q.recommended, ""],
    ["Summary", "Paid", "", q.paidAmount, ""],
    ["Summary", "Saved", "", q.savedAmount, ""],
    ["Summary", "Remaining after saved", "", q.remainingAfterSaved, ""],
    ["Breakdown", "Federal tax portion", "", q.federalPortion, ""],
    ...(rates?.stateTaxEnabled ? [["Breakdown", "State tax portion", "", q.statePortion, ""]] : []),
    ...(q.businessPortion > 0 ? [["Breakdown", "Self-employment/business portion", "", q.businessPortion, ""]] : []),
    ["Income and deductions", "Income included", "", q.incomeIncluded, taxMode === "forecast" ? "Includes planned income where available" : "Actual income only"],
    ["Income and deductions", "Deductions included", "", Math.max(0, q.deductionsIncluded), taxMode === "forecast" ? "Includes planned deductions where available" : "Actual deductions only"],
    ...q.qPayments.map((p) => ["Activity", "Payment", p.payment_date, Number(p.amount), p.notes ?? ""]),
    ...q.qSavings.map((sv) => ["Activity", `Saved - ${sv.source}`, sv.savings_date, Number(sv.amount), sv.notes ?? ""]),
  ];

  const exportQuarterCsv = (q: (typeof quarterData)[number], statusLabel: string) => {
    const rows = getQuarterExportRows(q, statusLabel);
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `tax-summary-${currentYear}-${q.key}.csv`);
  };

  const exportQuarterPdf = (q: (typeof quarterData)[number], statusLabel: string) => {
    const activityLines = q.qPayments.length === 0 && q.qSavings.length === 0
      ? ["No payments or savings have been logged for this quarter yet."]
      : [
          ...q.qPayments.map((p) => `Payment | ${format(new Date(p.payment_date + "T00:00:00"), "MMM d, yyyy")} | ${fmt(Number(p.amount))}${p.notes ? ` | ${p.notes}` : ""}`),
          ...q.qSavings.map((sv) => `Saved (${sv.source}) | ${format(new Date(sv.savings_date + "T00:00:00"), "MMM d, yyyy")} | ${fmt(Number(sv.amount))}${sv.notes ? ` | ${sv.notes}` : ""}`),
        ];

    const lines = [
      `Quarter: ${q.label} (${currentYear})`,
      `Due date: ${q.dueLabel}`,
      `Mode: ${taxMode === "forecast" ? "Actual income + planned income" : "Actual income only"}`,
      `Status: ${statusLabel}`,
      "",
      "Summary",
      `Estimated due: ${fmt(q.recommended)}`,
      `Paid: ${fmt(q.paidAmount)}`,
      `Saved: ${fmt(q.savedAmount)}`,
      `Remaining after saved: ${fmt(q.remainingAfterSaved)}`,
      "",
      "Tax breakdown",
      `Federal tax portion: ${fmt(q.federalPortion)}`,
      ...(rates?.stateTaxEnabled ? [`State tax portion: ${fmt(q.statePortion)}`] : []),
      ...(q.businessPortion > 0 ? [`Self-employment/business portion: ${fmt(q.businessPortion)}`] : []),
      "",
      "Income and deductions",
      `Income included: ${fmt(q.incomeIncluded)}`,
      `Deductions included: ${fmt(Math.max(0, q.deductionsIncluded))}`,
      "",
      "Quarter activity",
      ...activityLines,
    ];
    downloadBlob(createSimplePdfBlob(`${q.label} Tax Summary`, lines), `tax-summary-${currentYear}-${q.key}.pdf`);
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading…</p></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Tax Overview</TabsTrigger>
          <TabsTrigger value="breakdown">Tax Breakdown</TabsTrigger>
        </TabsList>

        <TabsContent value="breakdown" className="mt-0">
          <TaxBreakdown />
        </TabsContent>

        <TabsContent value="overview" className="space-y-6 mt-0">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tax Overview</h1>
          <p className="text-sm text-muted-foreground">Current vs forecasted tax estimates</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/30">
          <button
            onClick={() => setTaxMode("actual")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              taxMode === "actual"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Actual Only
          </button>
          <button
            onClick={() => setTaxMode("forecast")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              taxMode === "forecast"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Include Planned Income
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Total Gross Income</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{fmt(totalGrossIncome)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Before deductions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-muted-foreground">Total Taxable Income</p>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{fmt(e?.taxableIncome ?? 0)}</p>
            <p className="mt-2 text-xs text-muted-foreground">After eligible deductions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-muted-foreground">Effective Tax Rate</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    This is the effective tax rate used to estimate extra tax savings needed from W-2 paychecks. Business income may also have additional self-employment or business taxes calculated separately.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums text-primary">{overviewEffectiveRate.toFixed(1)}%</p>
            <p className="mt-2 text-xs text-muted-foreground">Used for W-2 savings guidance</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Quarterly Tax Progress</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {quarterData.map((q) => {
            const isOpen = expandedQuarter === q.key;
            const statusLabel = q.status === "paid" ? "Paid" : q.status === "attention" ? "Needs attention" : q.status === "partial" ? "Partially paid" : "On track";
            return (
              <Collapsible key={q.key} open={isOpen} onOpenChange={(open) => setExpandedQuarter(open ? q.key : null)}>
                <CollapsibleTrigger asChild>
                  <button className="w-full rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/40">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {q.status === "paid" ? <CheckCircle2 className="h-5 w-5 text-primary" /> : q.status === "attention" ? <AlertTriangle className="h-5 w-5 text-destructive" /> : <Clock className="h-5 w-5 text-muted-foreground" />}
                        <div>
                          <p className="font-semibold text-foreground">{q.label}</p>
                          <p className="text-xs text-muted-foreground">Due {q.dueLabel}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-foreground">{statusLabel}</p>
                        <p className="text-xs text-muted-foreground">{fmt(q.paidAmount)} paid of {fmt(q.recommended)} estimated</p>
                      </div>
                    </div>
                    <Progress value={q.progress} className="mt-3 h-2" />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mx-1 space-y-4 border-x border-b border-border px-4 pb-4 pt-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">Export this quarter’s CPA-ready summary and activity.</p>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => exportQuarterCsv(q, statusLabel)} className="gap-2">
                          <Download className="h-4 w-4" /> CSV
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => exportQuarterPdf(q, statusLabel)} className="gap-2">
                          <Download className="h-4 w-4" /> PDF
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-4">
                      <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Estimated due</p><p className="mt-1 font-semibold tabular-nums text-foreground">{fmt(q.recommended)}</p></div>
                      <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Paid</p><p className="mt-1 font-semibold tabular-nums text-primary">{fmt(q.paidAmount)}</p></div>
                      <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Saved</p><p className="mt-1 font-semibold tabular-nums text-foreground">{fmt(q.savedAmount)}</p></div>
                      <div className="rounded-md bg-muted/40 p-3"><p className="text-xs text-muted-foreground">Still to cover</p><p className="mt-1 font-semibold tabular-nums text-destructive">{fmt(q.remainingAfterSaved)}</p></div>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="font-medium text-foreground">Tax breakdown</h4>
                          <Badge variant="secondary">{statusLabel}</Badge>
                        </div>
                        <div className="space-y-2 rounded-md border border-border p-3">
                          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Federal tax portion</span><span className="font-medium tabular-nums">{fmt(q.federalPortion)}</span></div>
                          {rates?.stateTaxEnabled && <div className="flex justify-between gap-3"><span className="text-muted-foreground">State tax portion</span><span className="font-medium tabular-nums">{fmt(q.statePortion)}</span></div>}
                          {q.businessPortion > 0 && <div className="flex justify-between gap-3"><span className="text-muted-foreground">Self-employment/business portion</span><span className="font-medium tabular-nums">{fmt(q.businessPortion)}</span></div>}
                          <div className="border-t border-border pt-2 flex justify-between gap-3 font-semibold"><span>Estimated total</span><span className="tabular-nums">{fmt(q.recommended)}</span></div>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-medium text-foreground">Income and deductions</h4>
                        <div className="space-y-2 rounded-md border border-border p-3">
                          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Income included</span><span className="font-medium tabular-nums">{fmt(q.incomeIncluded)}</span></div>
                          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Deductions included</span><span className="font-medium tabular-nums">{fmt(Math.max(0, q.deductionsIncluded))}</span></div>
                          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Payments logged</span><span className="font-medium tabular-nums">{q.qPayments.length}</span></div>
                          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Savings entries logged</span><span className="font-medium tabular-nums">{q.qSavings.length}</span></div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border border-border p-3">
                      <h4 className="mb-2 font-medium text-foreground">Quarter activity</h4>
                      <div className="space-y-2">
                        {q.qPayments.length === 0 && q.qSavings.length === 0 ? (
                          <p className="text-xs text-muted-foreground">No payments or savings have been logged for this quarter yet.</p>
                        ) : (
                          <>
                            {q.qPayments.map((p) => <div key={p.id} className="flex justify-between gap-3 text-xs"><span className="text-muted-foreground">Payment · {format(new Date(p.payment_date + "T00:00:00"), "MMM d")}</span><span className="font-medium tabular-nums">{fmt(Number(p.amount))}</span></div>)}
                            {q.qSavings.map((sv) => <div key={sv.id} className="flex justify-between gap-3 text-xs"><span className="text-muted-foreground">Saved · {format(new Date(sv.savings_date + "T00:00:00"), "MMM d")}</span><span className="font-medium tabular-nums">{fmt(Number(sv.amount))}</span></div>)}
                          </>
                        )}
                      </div>
                    </div>

                    {taxMode === "forecast" && <p className="text-xs text-muted-foreground">Includes planned income and planned deductions where available.</p>}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </CardContent>
      </Card>

      {/* ── Actions ── */}
      <div className="flex gap-3 flex-wrap">
        <Button onClick={() => { resetSavingsForm(); setSavingsOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Log Tax Savings
        </Button>
        <Button variant="outline" onClick={() => { resetPaymentForm(); setPaymentOpen(true); }} className="gap-2">
          <Plus className="h-4 w-4" /> Log Tax Payment
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a href="https://www.irs.gov/payments/direct-pay" target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-4 w-4 mr-2" /> IRS Direct Pay
          </a>
        </Button>
      </div>

      {/* ── How This Estimate Works ── */}
      <Collapsible open={showHow} onOpenChange={setShowHow}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showHow && "rotate-180")} />
            How this estimate works
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2">
            <CardContent className="pt-4 pb-4 space-y-2 text-sm text-muted-foreground">
              <p>Your tax estimate is calculated automatically using the following approach:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>We combine your <strong>actual income received</strong> with any <strong>projected future income</strong> to estimate your annual total.</li>
                <li>We subtract deductions — pre-tax contributions, retirement, business expenses, and your standard deduction.</li>
                <li>We apply <strong>federal tax brackets</strong> to your estimated taxable income, plus self-employment tax and state tax where applicable.</li>
                <li>We subtract taxes already withheld from paychecks and any quarterly payments you've made.</li>
                <li>The remaining amount is spread across remaining months to give you a <strong>recommended monthly set-aside</strong>.</li>
              </ul>
              <p>When you add income, we recommend how much to withhold based on this projected annual model — not a simple flat rate.</p>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Advanced Breakdown ── */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showAdvanced && "rotate-180")} />
            Advanced tax breakdown
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 mt-2">
          {e && debug && (
            <Card>
              <CardContent className="pt-4 pb-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Federal tax before credits</span><span className="font-medium">{fmt(debug.federalTaxBeforeCredits)}</span></div>
                {debug.taxCredits > 0 && (
                  <div className="flex justify-between text-primary"><span>Child &amp; dependent credits</span><span>−{fmt(debug.taxCredits)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Federal tax after credits</span><span className="font-medium">{fmt(debug.federalIncomeTax)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Self-Employment Tax</span><span className="font-medium">{fmt(debug.selfEmploymentTax)}</span></div>
                {debug.stateTax > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">State Tax</span><span className="font-medium">{fmt(debug.stateTax)}</span></div>
                )}
                <div className="border-t border-border pt-2 flex justify-between font-semibold">
                  <span>Total Estimated Tax</span><span>{fmt(debug.totalEstimatedTax)}</span>
                </div>
                {debug.federalWithheld > 0 && (
                  <div className="flex justify-between text-primary"><span>Federal withholding paid</span><span>−{fmt(debug.federalWithheld)}</span></div>
                )}
                {debug.stateWithheld > 0 && (
                  <div className="flex justify-between text-primary"><span>State withholding paid</span><span>−{fmt(debug.stateWithheld)}</span></div>
                )}
                {estPaymentsMade > 0 && (
                  <div className="flex justify-between text-primary"><span>Estimated payments made</span><span>−{fmt(estPaymentsMade)}</span></div>
                )}
                <div className="border-t border-border pt-2 flex justify-between font-semibold">
                  <span>Remaining tax due</span>
                  <span className={remainingTax > 0 ? "text-destructive" : "text-primary"}>{fmt(remainingTax)}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>Effective Rate: {overviewEffectiveRate.toFixed(1)}%</span>
                  <span>Marginal Rate: {(e.marginalRate ?? 0).toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* ── Debug Breakdown ── */}
      {(taxMode === "actual" ? actualDebug : forecastDebug) && (
        <TaxDebugPanel
          debug={(taxMode === "actual" ? actualDebug : forecastDebug)!}
          label={`Taxes Tab — ${taxMode === "forecast" ? "Forecast" : "Actual"} Calculation Debug`}
          compareDebug={taxMode === "forecast" ? forecastDebug : undefined}
          compareLabel="Income Planner"
        />
      )}
      {savings.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Tax Savings Log</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {savings.map((sv) => (
                  <TableRow key={sv.id}>
                    <TableCell>{format(new Date(sv.savings_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(sv.amount))}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[200px]">{sv.notes}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => {
                          setSavingsEditId(sv.id);
                          setSavingsDate(new Date(sv.savings_date + "T00:00:00"));
                          setSavingsAmount(String(sv.amount));
                          setSavingsSource(sv.source);
                          setSavingsNotes(sv.notes || "");
                          setSavingsOpen(true);
                        }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setSavingsDeleteId(sv.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ── Payment History ── */}
      {payments.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Payment History</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Quarter</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{format(new Date(p.payment_date + "T00:00:00"), "MMM d, yyyy")}</TableCell>
                    <TableCell>{p.quarter}</TableCell>
                    <TableCell className="text-right font-medium">{fmt(Number(p.amount))}</TableCell>
                    <TableCell className="text-muted-foreground truncate max-w-[200px]">{p.notes}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => {
                          setPaymentEditId(p.id);
                          setPaymentDate(new Date(p.payment_date + "T00:00:00"));
                          setPaymentAmount(String(p.amount));
                          setPaymentQuarter(p.quarter);
                          setPaymentNotes(p.notes || "");
                          setPaymentOpen(true);
                        }}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => setPaymentDeleteId(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* ═══════ Dialogs ═══════ */}
      <Dialog open={savingsOpen} onOpenChange={(v) => { if (!v) resetSavingsForm(); setSavingsOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{savingsEditId ? "Edit" : "Add"} Tax Savings</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(savingsDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={savingsDate} onSelect={(d) => d && setSavingsDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={savingsAmount} onChange={(ev) => setSavingsAmount(ev.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={savingsNotes} onChange={(ev) => setSavingsNotes(ev.target.value)} placeholder="Optional" />
            </div>
            <Button className="w-full" onClick={handleSavingsSubmit} disabled={addSaving.isPending || updateSaving.isPending}>
              {savingsEditId ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={(v) => { if (!v) resetPaymentForm(); setPaymentOpen(v); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{paymentEditId ? "Edit" : "Log"} Tax Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Date *</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left font-normal">
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(paymentDate, "PPP")}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={paymentDate} onSelect={(d) => d && setPaymentDate(d)} initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
            <div>
              <Label>Amount *</Label>
              <Input type="number" min="0" step="0.01" value={paymentAmount} onChange={(ev) => setPaymentAmount(ev.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Quarter *</Label>
              <Select value={paymentQuarter} onValueChange={setPaymentQuarter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {QUARTERS.map((q) => <SelectItem key={q.key} value={q.key}>{q.label} — Due {q.dueLabel}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={paymentNotes} onChange={(ev) => setPaymentNotes(ev.target.value)} placeholder="Optional" />
            </div>
            <Button className="w-full" onClick={handlePaymentSubmit} disabled={addPayment.isPending || updatePayment.isPending}>
              {paymentEditId ? "Update" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!savingsDeleteId} onOpenChange={(v) => { if (!v) setSavingsDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this savings entry?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (savingsDeleteId) deleteSaving.mutate(savingsDeleteId); setSavingsDeleteId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!paymentDeleteId} onOpenChange={(v) => { if (!v) setPaymentDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete this payment?</AlertDialogTitle><AlertDialogDescription>This cannot be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (paymentDeleteId) deletePayment.mutate(paymentDeleteId); setPaymentDeleteId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
        </TabsContent>
      </Tabs>
    </div>
  );
}
