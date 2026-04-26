import { useState, useMemo } from "react";
import { format, isPast, isAfter } from "date-fns";
import {
  CheckCircle2, AlertTriangle, Info,
  Plus, Pencil, Trash2, CalendarIcon, ExternalLink, Clock, ChevronDown,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const currentYear = new Date().getFullYear();
const QUARTERS = [
  { key: "Q1", label: "Q1", due: new Date(currentYear, 3, 15), dueLabel: `Apr 15` },
  { key: "Q2", label: "Q2", due: new Date(currentYear, 5, 15), dueLabel: `Jun 15` },
  { key: "Q3", label: "Q3", due: new Date(currentYear, 8, 15), dueLabel: `Sep 15` },
  { key: "Q4", label: "Q4", due: new Date(currentYear + 1, 0, 15), dueLabel: `Jan 15` },
];

export default function Taxes() {
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const { estimate, isLoading: estLoading, taxMode, setTaxMode, actualEstimate, forecastEstimate, actualDebug, forecastDebug } = useTaxEstimate();
  const { data: savings = [] } = useTaxSavings();
  const { data: payments = [] } = useTaxPayments();

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
  const [expandedQuarter, setExpandedQuarter] = useState<string | null>(null);

  const isLoading = ratesLoading || estLoading;

  const e = estimate;
  const debug = taxMode === "actual" ? actualDebug : forecastDebug;
  const totalSetAside = savings.reduce((s, sv) => s + Number(sv.amount), 0);

  // Use the unified debug breakdown as the source of truth so UI matches engine.
  const estimatedOwed = debug?.totalEstimatedTax ?? e?.totalTaxLiability ?? 0;
  const totalGrossIncome = e?.totalIncome ?? ((e?.w2Income ?? 0) + (e?.grossBusinessIncome ?? 0) + (e?.otherIncome ?? 0));
  const totalReturnIncome = e?.totalReturnIncomeBeforeAdjustments ?? 0;
  const overviewProfile = getSelectedWithholdingProfileRate({
    taxSettings: rates,
    actualEstimate,
    forecastEstimate: taxMode === "actual" ? actualEstimate : forecastEstimate,
  });
  const overviewEffectiveRate = rates?.withholdingMethod === "flat_estimate"
    ? overviewProfile.federalProfileRate
    : e?.effectiveRate ?? overviewProfile.canonicalEffectiveTaxRate;
  const actualFedWH = debug?.actualFederalWithheld ?? 0;
  const actualStateWH = debug?.actualStateWithheld ?? 0;
  const projFedWH = debug?.projectedFederalWithheld ?? 0;
  const projStateWH = debug?.projectedStateWithheld ?? 0;
  const futureW2WH = projFedWH + projStateWH;
  const estPaymentsMade = debug?.estimatedPaymentsMade ?? 0;
  const totalCovered = debug?.countedCreditsTotal ?? 0;
  const remainingTax = debug?.remainingTaxDue ?? Math.max(0, estimatedOwed - totalCovered);

  const now = new Date();
  const monthsLeft = Math.max(1, 12 - now.getMonth());
  const monthlyGuidance = remainingTax > 0 ? remainingTax / monthsLeft : 0;
  const progressPct = estimatedOwed > 0 ? Math.min(100, (totalCovered / estimatedOwed) * 100) : 100;

  // Quarterly data
  const quarterData = useMemo(() => {
    const remainingQs = QUARTERS.filter((q) => isAfter(q.due, now) || q.due.toDateString() === now.toDateString());
    const remainingCount = Math.max(1, remainingQs.length);
    const suggestedPerQ = remainingTax / remainingCount;

    return QUARTERS.map((q, index) => {
      const qPayments = payments.filter((p) => p.quarter === q.key);
      const paidAmount = qPayments.reduce((s, p) => s + Number(p.amount), 0);
      const savedAmount = savings
        .filter((sv) => Math.floor(new Date(sv.savings_date + "T00:00:00").getMonth() / 3) === index)
        .reduce((s, sv) => s + Number(sv.amount), 0);
      const recommended = estimatedOwed > 0 ? estimatedOwed / 4 : suggestedPerQ;
      const remainingDue = Math.max(0, recommended - paidAmount);
      const progress = recommended > 0 ? Math.min(100, (paidAmount / recommended) * 100) : 100;
      let status: "paid" | "on_track" | "partial" | "attention" = "on_track";
      if (paidAmount >= recommended && recommended > 0) status = "paid";
      else if (isPast(q.due) && paidAmount < recommended) status = "attention";
      else if (paidAmount > 0) status = "partial";
      const quarterShare = 0.25;
      return {
        ...q,
        paidAmount,
        savedAmount,
        recommended,
        remainingDue,
        progress,
        status,
        federalPortion: (debug?.federalIncomeTax ?? e?.federalTax ?? 0) * quarterShare,
        statePortion: (debug?.stateTax ?? e?.stateTax ?? 0) * quarterShare,
        businessPortion: (debug?.selfEmploymentTax ?? e?.seTax.total ?? 0) * quarterShare,
        incomeIncluded: totalGrossIncome * quarterShare,
        deductionsIncluded: ((e?.totalIncome ?? 0) - (e?.taxableIncome ?? 0)) * quarterShare,
      };
    });
  }, [payments, savings, remainingTax, estimatedOwed, debug, e, totalGrossIncome, now]);

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

      {/* ── 8 IRS-flow Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Effective Tax Rate</p>
            <p className="text-xl font-bold tabular-nums text-primary">{overviewEffectiveRate.toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">
              {taxMode === "forecast" ? "Includes planned income" : "Actual income only"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Gross Business Income</p>
            <p className="text-xl font-bold tabular-nums">{fmt(e?.grossBusinessIncome ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Business Expenses</p>
            <p className="text-xl font-bold tabular-nums">−{fmt(e?.businessExpenses ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Net Business Profit</p>
            <p className="text-xl font-bold tabular-nums">{fmt(e?.netBusinessProfit ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Return Income</p>
            <p className="text-xl font-bold tabular-nums">{fmt(totalReturnIncome)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Taxable Income</p>
            <p className="text-xl font-bold tabular-nums">{fmt(e?.taxableIncome ?? 0)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Total Estimated Tax</p>
            <p className="text-xl font-bold tabular-nums text-destructive">{fmt(estimatedOwed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Taxes Already Withheld/Paid</p>
            <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(totalCovered)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground">Remaining Tax To Cover</p>
            <p className={cn("text-xl font-bold tabular-nums", remainingTax > 0 ? "text-amber-600" : "text-emerald-600")}>{fmt(remainingTax)}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Progress ── */}
      <Card>
        <CardContent className="pt-4 pb-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Taxes covered so far</span>
            <span className="font-medium">{Math.round(progressPct)}%</span>
          </div>
          <Progress value={progressPct} className="h-3" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{fmt(totalCovered)} covered</span>
            <span>{fmt(estimatedOwed)} estimated total</span>
          </div>
        </CardContent>
      </Card>

      {/* ── Credits Against Tax ── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Credits Against Tax</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Federal withholding already paid</span>
            <span className="font-medium tabular-nums">{fmt(actualFedWH)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">State withholding already paid</span>
            <span className="font-medium tabular-nums">{fmt(actualStateWH)}</span>
          </div>
          {taxMode === "forecast" && futureW2WH > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Future W-2 withholding projected</span>
              <span className="font-medium tabular-nums">{fmt(futureW2WH)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Estimated tax payments made</span>
            <span className="font-medium tabular-nums">{fmt(estPaymentsMade)}</span>
          </div>
          <div className="border-t border-border pt-2 flex justify-between font-semibold">
            <span>Total counted credits</span>
            <span className="text-emerald-600 dark:text-emerald-400 tabular-nums">{fmt(totalCovered)}</span>
          </div>
          <div className="flex justify-between italic text-muted-foreground">
            <span>Savings set aside (not counted)</span>
            <span className="tabular-nums">{fmt(totalSetAside)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground italic pt-1">
            Savings set aside is shown for planning only and is not treated as a submitted tax payment.
          </p>
          <div className="border-t border-border pt-2 flex justify-between font-semibold">
            <span>Total tax liability</span>
            <span className="tabular-nums">{fmt(estimatedOwed)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>Remaining estimated tax due</span>
            <span className={cn("tabular-nums", remainingTax > 0 ? "text-amber-600" : "text-emerald-600")}>
              {fmt(remainingTax)}
            </span>
          </div>
          {remainingTax > 0 && (
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Per remaining quarter (~{Math.max(1, 4 - Math.floor(now.getMonth() / 3))})</span>
              <span className="tabular-nums">{fmt(remainingTax / Math.max(1, 4 - Math.floor(now.getMonth() / 3)))}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Quarterly Overview ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {quarterData.map((q) => (
          <Card key={q.key} className={cn("border",
            q.status === "paid" && "border-emerald-500/30",
            q.status === "overdue" && "border-amber-400/30",
          )}>
            <CardContent className="pt-3 pb-3 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold">{q.label}</span>
                {q.status === "paid" ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> :
                 q.status === "overdue" ? <AlertTriangle className="h-4 w-4 text-amber-600" /> :
                 <Clock className="h-4 w-4 text-muted-foreground" />}
              </div>
              <p className="text-xs text-muted-foreground">Due {q.dueLabel}</p>
              <div className="text-sm">
                <span className="text-muted-foreground">Paid: </span>
                <span className="font-medium">{fmt(q.paidAmount)}</span>
              </div>
              {q.remainingDue > 0 && (
                <p className="text-xs text-amber-600">Remaining: {fmt(q.remainingDue)}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

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
                  <div className="flex justify-between text-emerald-600"><span>Child &amp; dependent credits</span><span>−{fmt(debug.taxCredits)}</span></div>
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
                  <div className="flex justify-between text-emerald-600"><span>Federal withholding paid</span><span>−{fmt(debug.federalWithheld)}</span></div>
                )}
                {debug.stateWithheld > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>State withholding paid</span><span>−{fmt(debug.stateWithheld)}</span></div>
                )}
                {estPaymentsMade > 0 && (
                  <div className="flex justify-between text-emerald-600"><span>Estimated payments made</span><span>−{fmt(estPaymentsMade)}</span></div>
                )}
                <div className="border-t border-border pt-2 flex justify-between font-semibold">
                  <span>Remaining tax due</span>
                  <span className={remainingTax > 0 ? "text-amber-600" : "text-emerald-600"}>{fmt(remainingTax)}</span>
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
