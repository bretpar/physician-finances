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
import W4PaycheckAdjustmentCard from "@/components/tax/W4PaycheckAdjustmentCard";
import { cn } from "@/lib/utils";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useCanonicalWithholding } from "@/hooks/useCanonicalWithholding";
import TaxDebugPanel from "@/components/TaxDebugPanel";
import TaxBreakdownDebugToggle from "@/components/TaxBreakdownDebugToggle";
import { useTaxSavings, useAddTaxSaving, useUpdateTaxSaving, useDeleteTaxSaving } from "@/hooks/useTaxSavings";
import { useTaxPayments, useAddTaxPayment, useUpdateTaxPayment, useDeleteTaxPayment } from "@/hooks/useTaxPayments";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useInvestmentIncomeEntries } from "@/hooks/useInvestmentIncome";
import { useCompanies } from "@/contexts/CompanyContext";
import { useProjectedStreams, useProjectedBonuses, generateProjectedPaychecks } from "@/hooks/useProjectedIncome";
import QuarterlyTracker from "@/components/dashboard/QuarterlyTracker";
import { getSavingsRateForIncomeBucket, getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";
import { deriveUserTypeFromIncomeStreams } from "@/lib/entitlements";
import { normalizeFilingType } from "@/lib/filingTypes";
import { isExcludedFromBusiness } from "@/lib/businessExclusion";

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
  const { estimate, isLoading: estLoading, taxMode, setTaxMode, actualEstimate, currentPaceEstimate, forecastEstimate, actualDebug, currentPaceDebug, forecastDebug } = useTaxEstimate();
  // CANONICAL withholding — single source of truth shared with Paychecks and Withholding Guide.
  const canonicalWithholding = useCanonicalWithholding("Taxes");
  const { data: savings = [] } = useTaxSavings();
  const { data: payments = [] } = useTaxPayments();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: investmentEntries, isLoading: investmentLoading } = useInvestmentIncomeEntries();
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
  const [showCalcDetails, setShowCalcDetails] = useState(false);

  const isLoading = ratesLoading || estLoading || txLoading || incLoading || piLoading || investmentLoading;

  const e = estimate;
  const debug = taxMode === "actual" ? actualDebug : forecastDebug;
  const isW2Only = deriveUserTypeFromIncomeStreams(rates?.householdIncomeStreams) === "W2_ONLY";
  const hasIncludedPriorNonW2Income = useMemo(() => {
    return (incomeEntries || []).some((entry) => {
      const type = normalizeFilingType(entry.income_type);
      return type !== "w2" && type !== "scorp_w2";
    }) || (transactions || []).some((t) => t.transaction_type === "income" && !isExcludedFromBusiness(t as any));
  }, [incomeEntries, transactions]);
  const totalSetAside = savings.reduce((s, sv) => s + Number(sv.amount), 0);

  // Use the unified debug breakdown as the source of truth so UI matches engine.
  const estimatedOwed = debug?.totalEstimatedTax ?? e?.totalTaxLiability ?? 0;
  const totalGrossIncome = e?.totalIncome ?? ((e?.w2Income ?? 0) + (e?.grossBusinessIncome ?? 0) + (e?.otherIncome ?? 0));
  const overviewProfile = getSelectedWithholdingProfileRate({
    taxSettings: rates,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate: taxMode === "actual" ? (currentPaceEstimate ?? actualEstimate) : forecastEstimate,
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
  const method = rates?.withholdingMethod ?? "dynamic_planner";
  const trackerEstimate = method === "dynamic_planner" ? (forecastEstimate ?? actualEstimate) : (currentPaceEstimate ?? actualEstimate);
  const personalRate = getSavingsRateForIncomeBucket({
    incomeBucket: "personal",
    incomeType: "W2",
    taxSettings: rates,
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
  }).rate;
  const businessRate = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "1099",
    taxSettings: rates,
    actualEstimate,
    currentPaceEstimate,
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

  if (isLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading…</p></div>;
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview">Tax Overview</TabsTrigger>
          <TabsTrigger value="breakdown">Tax Breakdown</TabsTrigger>
          <TabsTrigger value="w4-calculator">W-4 Calculator</TabsTrigger>
        </TabsList>

        <TabsContent value="breakdown" className="mt-0">
          <TaxBreakdown />
        </TabsContent>

        <TabsContent value="w4-calculator" className="space-y-6 mt-0">
          <div>
            <h1 className="text-xl font-semibold text-foreground">W-4 Calculator</h1>
            <p className="text-sm text-muted-foreground">
              Estimate extra withholding needed on each W-2 paycheck.
            </p>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            This calculator looks at your full-year tax picture after W-2 withholding, estimated payments, actual tax savings, and optional planned non-W-2 reserves. Use the extra per paycheck amount when updating your W-4.
          </p>
          <W4PaycheckAdjustmentCard />
        </TabsContent>

        <TabsContent value="overview" className="space-y-6 mt-0">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tax Overview</h1>
          <p className="text-sm text-muted-foreground">
            {isW2Only ? "Household income, withholding, and projected refund or amount due" : "Current vs forecasted tax estimates"}
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/30">
          <button
            onClick={() => setTaxMode("forecast")}
            className={cn(
              "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
              taxMode === "forecast"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Planned Income
          </button>
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
        </div>
      </div>

      <div data-testid="tax-overview-summary" className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-muted-foreground">{isW2Only ? "Household Income" : "Total Gross Income"}</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What's included?">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Gross income fed into the tax engine before any deductions. Includes W-2, 1099, K-1, personal income entries, dividends, capital gains, rental, and YTD catch-ups. In Planned Income mode it also adds future planned paychecks — that's the same number shown as "Expected Annual Income" on the Dashboard. Switch to "Actual Only" to see just what's been received so far.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums text-foreground">{fmt(totalGrossIncome)}</p>
            <p className="mt-2 text-xs text-muted-foreground">Before deductions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-muted-foreground">Total Taxable Income</p>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What's subtracted?">
                      <Info className="h-4 w-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    Taxable income after the standard or itemized deduction, pre-tax payroll items (401(k), HSA, health premiums), business expenses, mileage, home-office deduction, and the deductible half of SE tax. This is why it's lower than Total Gross Income — and why neither matches the Dashboard's gross "Expected Annual Income" exactly.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
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
                    {isW2Only
                      ? "This is the shared household rate used for paycheck withholding guidance."
                      : "This is the effective tax rate used to estimate extra tax savings needed from W-2 paychecks. Business income may also have additional self-employment or business taxes calculated separately."}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums text-primary">{overviewEffectiveRate.toFixed(1)}%</p>
            <p className="mt-2 text-xs text-muted-foreground">Used for W-2 savings guidance</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Tax Calculation Details ── */}
      <Collapsible open={showCalcDetails} onOpenChange={setShowCalcDetails}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1">
            <ChevronDown className={cn("h-4 w-4 transition-transform", showCalcDetails && "rotate-180")} />
            Tax calculation details
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <Card>
            <CardContent className="pt-4 pb-4 space-y-2 text-sm">
              {(() => {
                const filingLabel =
                  rates?.filingStatus === "married_filing_jointly"
                    ? "Married Filing Jointly"
                    : "Single";
                return (
                  <>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Filing status</span>
                      <span className="font-medium">{filingLabel}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Tax state</span>
                      <span className="font-medium">{rates?.stateOfResidence ? rates.stateOfResidence : "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Gross income</span>
                      <span className="font-medium tabular-nums">{fmt(totalGrossIncome)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Business profit used for tax calculation</span>
                      <span className="font-medium tabular-nums">{fmt(e?.netBusinessProfit ?? 0)}</span>
                    </div>
                    <div className="border-t border-border my-1.5" />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Federal income tax estimate</span>
                      <span className="font-medium tabular-nums">{fmt(debug?.federalIncomeTax ?? e?.federalTax ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Self-employment tax estimate</span>
                      <span className="font-medium tabular-nums">{fmt(debug?.selfEmploymentTax ?? e?.seTax?.total ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">State income tax estimate</span>
                      <span className="font-medium tabular-nums">{fmt(debug?.stateTax ?? e?.stateTax ?? 0)}</span>
                    </div>
                    <div className="border-t border-border my-1.5" />
                    <div className="flex justify-between font-semibold">
                      <span>Total estimated tax</span>
                      <span className="tabular-nums">{fmt(debug?.totalEstimatedTax ?? e?.totalTaxLiability ?? 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Effective tax rate</span>
                      <span className="font-medium tabular-nums">{overviewEffectiveRate.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Recommended reserve / set-aside</span>
                      <span className="font-medium tabular-nums">{fmt(debug?.recommendedSetAside ?? remainingTax)}</span>
                    </div>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {isW2Only && debug && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="text-lg font-semibold text-foreground">Projected Refund / Amount Due</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div><p className="text-xs text-muted-foreground">Estimated total tax</p><p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{fmt(debug.totalEstimatedTax)}</p></div>
              <div><p className="text-xs text-muted-foreground">Withholding and payments</p><p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{fmt(debug.countedCreditsTotal)}</p></div>
              <div><p className="text-xs text-muted-foreground">Extra per paycheck</p><p className="mt-1 text-xl font-semibold tabular-nums text-primary">{fmt(debug.recommendedSetAside)}</p></div>
            </div>
            <p className="text-sm text-muted-foreground">
              {debug.remainingTaxDue > 0
                ? `Based on your projected household income, deductions, taxes, and current withholding, you are projected to be short by ${fmt(debug.remainingTaxDue)}.`
                : debug.countedCreditsTotal > debug.totalEstimatedTax
                  ? `You are projected to have a refund of about ${fmt(debug.countedCreditsTotal - debug.totalEstimatedTax)} if your income and withholding stay on track.`
                  : "Your current withholding appears to be on track based on your projected household income, deductions, and taxes."}
            </p>
            {hasIncludedPriorNonW2Income && (
              <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Earlier income from other sources is labeled as included prior income and remains part of the full-year projection when marked included.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!isW2Only && <section id="quarterly-estimator" className="scroll-mt-6">
        <QuarterlyTracker
          annualTaxLiability={annualTaxLiability}
          payments={payments}
          methodLabel={overviewProfile.label}
          incomeEntries={incomeEntries || []}
          personalEntries={personalEntries || []}
          transactions={transactions || []}
          investmentEntries={investmentEntries || []}
          companies={companies}
          quarterMethod={rates?.quarterlyTrackerMethod ?? "even"}
          projectedPaychecks={projectedPaychecks}
          personalBucketRate={personalRate}
          businessBucketRate={businessRate}
          effectiveTaxRate={trackerEffectiveTaxRate}
          breakdownTitle="This quarter by source"
        />
      </section>}

      {/* ── Actions ── */}
      {!isW2Only && <div className="flex gap-3 flex-wrap">
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
      </div>}

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
                <li>We subtract deductions — pre-tax contributions, retirement, {isW2Only ? "and your standard or itemized deduction" : "business expenses, and your standard deduction"}.</li>
                <li>We apply <strong>federal tax brackets</strong> to your estimated taxable income{isW2Only ? " and state tax where applicable" : ", plus self-employment tax and state tax where applicable"}.</li>
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
                {(taxMode === "actual" ? canonicalWithholding.actual.federal : canonicalWithholding.forecast.federal) > 0 && (
                  <div className="flex justify-between text-primary"><span>Federal withholding paid</span><span>−{fmt(taxMode === "actual" ? canonicalWithholding.actual.federal : canonicalWithholding.forecast.federal)}</span></div>
                )}
                {(taxMode === "actual" ? canonicalWithholding.actual.state : canonicalWithholding.forecast.state) > 0 && (
                  <div className="flex justify-between text-primary"><span>State withholding paid</span><span>−{fmt(taxMode === "actual" ? canonicalWithholding.actual.state : canonicalWithholding.forecast.state)}</span></div>
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
      <div className="flex justify-end">
        <TaxBreakdownDebugToggle />
      </div>
      {(taxMode === "actual" ? actualDebug : forecastDebug) && (
        <TaxDebugPanel
          debug={(taxMode === "actual" ? actualDebug : forecastDebug)!}
          label={taxMode === "forecast" ? "Income Planner — Tax Calculation Debug" : "Taxes Tab — Actual Calculation Debug"}
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
                  {PAYMENT_QUARTERS.map((q) => <SelectItem key={q.key} value={q.key}>{q.label} — Due {q.dueLabel}</SelectItem>)}
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
