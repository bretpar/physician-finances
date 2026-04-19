import { useState } from "react";
import {
  DollarSign, TrendingUp, TrendingDown, ShieldCheck, AlertTriangle,
  CheckCircle2, PiggyBank, Calculator, Receipt, Target, ArrowRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTaxSettings, useUpdateTaxSettings, type TaxRates } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  BRACKETS_SINGLE, BRACKETS_MFJ, STANDARD_DEDUCTION,
  type TaxBracket,
} from "@/lib/taxEngine";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const pct = (n: number) => `${n.toFixed(1)}%`;

function BracketTable({ brackets, taxableIncome }: { brackets: TaxBracket[]; taxableIncome: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-2 text-muted-foreground font-medium">Bracket</th>
            <th className="text-right py-2 px-2 text-muted-foreground font-medium">Rate</th>
            <th className="text-right py-2 px-2 text-muted-foreground font-medium">Tax</th>
          </tr>
        </thead>
        <tbody>
          {brackets.map((b, i) => {
            if (taxableIncome <= b.min) return null;
            const taxable = Math.min(taxableIncome, b.max) - b.min;
            const tax = taxable * b.rate;
            const upper = b.max === Infinity ? "+" : fmt(b.max);
            return (
              <tr key={i} className="border-b border-border/50">
                <td className="py-1.5 px-2">{fmt(b.min)} – {upper}</td>
                <td className="py-1.5 px-2 text-right">{(b.rate * 100).toFixed(0)}%</td>
                <td className="py-1.5 px-2 text-right font-medium">{fmt(tax)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function getTrackingColor(status: string) {
  switch (status) {
    case "ahead": return "text-emerald-600 dark:text-emerald-400";
    case "on_track": return "text-emerald-600 dark:text-emerald-400";
    case "slightly_behind": return "text-amber-600 dark:text-amber-400";
    case "behind": return "text-red-600 dark:text-red-400";
    default: return "text-muted-foreground";
  }
}

function getTrackingIcon(status: string) {
  switch (status) {
    case "ahead": return CheckCircle2;
    case "on_track": return CheckCircle2;
    case "slightly_behind": return Target;
    case "behind": return AlertTriangle;
    default: return Target;
  }
}

function getTrackingBorderColor(status: string) {
  switch (status) {
    case "ahead": return "border-emerald-400/40";
    case "on_track": return "border-emerald-400/40";
    case "slightly_behind": return "border-amber-400/40";
    case "behind": return "border-red-400/40";
    default: return "border-border";
  }
}

function getTrackingBg(status: string) {
  switch (status) {
    case "ahead": return "bg-emerald-50/50 dark:bg-emerald-950/20";
    case "on_track": return "bg-emerald-50/50 dark:bg-emerald-950/20";
    case "slightly_behind": return "bg-amber-50/50 dark:bg-amber-950/20";
    case "behind": return "bg-red-50/50 dark:bg-red-950/20";
    default: return "";
  }
}

export default function EstimatedTax() {
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const updateSettings = useUpdateTaxSettings();
  const { estimate, isLoading } = useTaxEstimate();
  const [editingSettings, setEditingSettings] = useState(false);

  if (isLoading || ratesLoading) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Loading tax estimate…</p></div>;
  }

  if (!estimate || !rates) {
    return <div className="flex items-center justify-center py-20"><p className="text-muted-foreground">Add income entries to see tax estimates.</p></div>;
  }

  const e = estimate;
  const t = e.tracking;
  const brackets = rates.filingStatus === "married_filing_jointly" ? BRACKETS_MFJ : BRACKETS_SINGLE;
  const TrackingIcon = getTrackingIcon(t.status);
  const SafeHarborStatusIcon = t.safeHarborMet ? ShieldCheck : AlertTriangle;

  const handleFilingChange = (value: string) => {
    if (!rates.id) return;
    updateSettings.mutate({ id: rates.id, filingStatus: value as TaxRates["filingStatus"] });
  };

  const handleLastYearTax = (value: string) => {
    if (!rates.id) return;
    updateSettings.mutate({ id: rates.id, lastYearTax: parseFloat(value) || 0 });
  };

  // Quarterly breakdown
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const quarters = [
    { label: "Q1 (Apr 15)", due: currentQuarter <= 1 },
    { label: "Q2 (Jun 15)", due: currentQuarter <= 2 },
    { label: "Q3 (Sep 15)", due: currentQuarter <= 3 },
    { label: "Q4 (Jan 15)", due: true },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Time-Based Tracking Hero */}
      <Card className={`border-2 ${getTrackingBorderColor(t.status)} ${getTrackingBg(t.status)}`}>
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <div className="h-14 w-14 rounded-full bg-background flex items-center justify-center shrink-0 border border-border">
              <TrackingIcon className={`h-7 w-7 ${getTrackingColor(t.status)}`} />
            </div>
            <div className="flex-1 text-center sm:text-left">
              <p className={`text-2xl font-bold ${getTrackingColor(t.status)}`}>
                {t.statusLabel}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                Day {t.daysElapsed} of {t.daysInYear} — {pct(t.yearProgress * 100)} through the year
              </p>
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Expected taxes to date</span>
                  <span className="font-medium">{fmt(t.expectedTaxToDate)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Total paid / withheld</span>
                  <span className="font-medium">{fmt(t.totalPaid)}</span>
                </div>
                <Progress value={Math.min(100, t.paidVsExpectedPercent)} className="h-2.5 mt-2" />
                <p className="text-xs text-muted-foreground text-right">
                  {pct(t.paidVsExpectedPercent)} of expected taxes paid
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Forward-looking recommendation */}
      {t.suggestedMonthlyPayment > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-5 pb-5 flex flex-col sm:flex-row items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <ArrowRight className="h-6 w-6 text-primary" />
            </div>
            <div className="text-center sm:text-left">
              <p className="text-sm text-muted-foreground">To stay on track, consider paying</p>
              <p className="text-3xl font-bold text-primary">{fmt(t.suggestedMonthlyPayment)}<span className="text-lg font-normal text-muted-foreground">/month</span></p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {fmt(t.remainingTax)} remaining across {t.monthsRemaining} month{t.monthsRemaining !== 1 ? "s" : ""}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              <p className="text-sm text-muted-foreground">Total Income</p>
            </div>
            <p className="text-2xl font-bold">{fmt(e.totalIncome)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">W-2: {fmt(e.w2Income)} · SE: {fmt(e.seIncome)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="h-4 w-4 text-primary" />
              <p className="text-sm text-muted-foreground">Taxable Income</p>
            </div>
            <p className="text-2xl font-bold">{fmt(e.taxableIncome)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">AGI: {fmt(e.agi)} − {fmt(e.standardDeduction)} std ded</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Estimated Annual Tax</p>
            </div>
            <p className="text-2xl font-bold">{fmt(e.totalTaxLiability)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Effective rate: {pct(e.effectiveRate)}</p>
          </CardContent>
        </Card>
        <Card className={getTrackingBorderColor(t.status)}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2 mb-1">
              <TrackingIcon className={`h-4 w-4 ${getTrackingColor(t.status)}`} />
              <p className="text-sm text-muted-foreground">Remaining</p>
            </div>
            <p className="text-2xl font-bold">{fmt(t.remainingTax)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">Paid: {fmt(t.totalPaid)}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Tax breakdown */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tax Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Federal Income Tax</span>
              <span className="font-medium">{fmt(e.federalTax)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Self-Employment Tax</span>
              <span className="font-medium">{fmt(e.seTax.total)}</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Social Security</span><span>{fmt(e.seTax.ssTax)}</span></div>
              <div className="flex justify-between"><span>Medicare</span><span>{fmt(e.seTax.medicareTax)}</span></div>
              {e.seTax.additionalMedicare > 0 && (
                <div className="flex justify-between"><span>Additional Medicare</span><span>{fmt(e.seTax.additionalMedicare)}</span></div>
              )}
              <div className="flex justify-between"><span>Deductible half (reduces AGI)</span><span>−{fmt(e.seTax.deductibleHalf)}</span></div>
            </div>
            {(e.personalStateTax > 0 || e.businessStateTax > 0) && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">State Tax</span>
                <span className="font-medium">{fmt(e.stateTax)}</span>
              </div>
            )}
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Total Estimated Tax</span>
              <span>{fmt(e.totalTaxLiability)}</span>
            </div>
            <div className="flex justify-between text-sm text-emerald-600">
              <span>Total Paid / Withheld</span>
              <span>−{fmt(t.totalPaid)}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-semibold text-lg">
              <span>Remaining</span>
              <span className={t.remainingTax > 0 ? "text-amber-600" : "text-emerald-600"}>
                {fmt(t.remainingTax)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Income & deductions summary */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Income & Deductions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Gross Income</span>
              <span className="font-medium">{fmt(e.totalIncome)}</span>
            </div>
            <div className="pl-4 space-y-1 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>W-2 Income</span><span>{fmt(e.w2Income)}</span></div>
              <div className="flex justify-between"><span>1099/K-1 Income</span><span>{fmt(e.seIncome)}</span></div>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Pre-Tax Deductions</span>
              <span className="font-medium">−{fmt(e.preTaxDeductions)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">401k Contributions</span>
              <span className="font-medium">−{fmt(e.retirement401k)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">SE Tax Deduction (½)</span>
              <span className="font-medium">−{fmt(e.seTax.deductibleHalf)}</span>
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Adjusted Gross Income (AGI)</span>
              <span>{fmt(e.agi)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Standard Deduction ({rates?.filingStatus === "married_filing_jointly" ? "MFJ" : "Single"})</span>
              <span className="font-medium">−{fmt(e.standardDeduction)}</span>
            </div>
            {e.businessDeductions > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Business Expenses</span>
                <span className="font-medium">−{fmt(e.businessDeductions)}</span>
              </div>
            )}
            {e.mileageDeduction > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Mileage Deduction</span>
                <span className="font-medium">−{fmt(e.mileageDeduction)}</span>
              </div>
            )}
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Taxable Income</span>
              <span>{fmt(e.taxableIncome)}</span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground pt-1">
              <span>Marginal Rate</span>
              <span>{pct(e.marginalRate)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Safe Harbor */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Safe Harbor Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-muted-foreground">
              IRS safe harbor: pay ≥ 90% of current year tax OR 100% of last year's tax (110% if AGI &gt; $150k) to avoid underpayment penalties.
            </p>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Safe Harbor Target</span>
                <span className="font-medium">{fmt(t.safeHarborTarget)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Paid</span>
                <span className="font-medium">{fmt(t.totalPaid)}</span>
              </div>
              <Progress value={t.safeHarborProgress} className="h-2" />
              <div className="flex items-center gap-2">
                <SafeHarborStatusIcon className={`h-4 w-4 ${t.safeHarborMet ? "text-emerald-600" : "text-amber-500"}`} />
                <span className={`text-sm font-semibold ${t.safeHarborMet ? "text-emerald-600" : "text-amber-500"}`}>
                  {t.safeHarborLabel}
                </span>
              </div>
              {!t.safeHarborMet && t.safeHarborTarget > 0 && (
                <p className="text-xs text-muted-foreground">
                  {fmt(Math.max(0, t.safeHarborTarget - t.totalPaid))} more needed to reach safe harbor
                </p>
              )}
            </div>
            <div className="border-t border-border pt-3 space-y-2">
              <Label className="text-xs text-muted-foreground">Last Year's Total Tax</Label>
              <Input
                type="number"
                min="0"
                step="100"
                defaultValue={rates?.lastYearTax || 0}
                onBlur={(ev) => handleLastYearTax(ev.target.value)}
                className="max-w-[200px]"
              />
            </div>
          </CardContent>
        </Card>

        {/* Quarterly estimates */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="h-4 w-4" /> Quarterly Estimates
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {quarters.map((q, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className={!q.due ? "line-through text-muted-foreground" : ""}>{q.label}</span>
                  {!q.due && <Badge variant="outline" className="text-xs">Passed</Badge>}
                  {q.due && i === currentQuarter - 1 && <Badge className="text-xs">Due Next</Badge>}
                </div>
                <span className="font-medium">{fmt(e.quarterlyEstimate)}</span>
              </div>
            ))}
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Total Remaining</span>
              <span>{fmt(t.remainingTax)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Progressive bracket visualization */}
        <Card className="xl:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Federal Tax Brackets ({rates?.filingStatus === "married_filing_jointly" ? "Married Filing Jointly" : "Single"})</CardTitle>
              <Select value={rates?.filingStatus || "single"} onValueChange={handleFilingChange}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">Single</SelectItem>
                  <SelectItem value="married_filing_jointly">Married Filing Jointly</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <BracketTable brackets={brackets} taxableIncome={e.taxableIncome} />
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span>Effective Rate: <strong className="text-foreground">{pct(e.effectiveRate)}</strong></span>
              <span>Marginal Rate: <strong className="text-foreground">{pct(e.marginalRate)}</strong></span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Configuration section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Tax Configuration</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setEditingSettings(!editingSettings)}>
              {editingSettings ? "Done" : "Edit Settings"}
            </Button>
          </div>
        </CardHeader>
        {editingSettings && rates?.id && (
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">SS Wage Cap</Label>
                <Input
                  type="number" step="100" min="0"
                  defaultValue={rates.ssWageCap}
                  onBlur={(ev) => updateSettings.mutate({ id: rates.id!, ssWageCap: parseFloat(ev.target.value) || 168600 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Standard Deduction Override</Label>
                <Input
                  type="number" step="100" min="0"
                  placeholder={String(STANDARD_DEDUCTION[rates.filingStatus])}
                  defaultValue={rates.standardDeductionOverride ?? ""}
                  onBlur={(ev) => {
                    const val = ev.target.value ? parseFloat(ev.target.value) : null;
                    updateSettings.mutate({ id: rates.id!, standardDeductionOverride: val as number });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Last Year's Tax</Label>
                <Input
                  type="number" step="100" min="0"
                  defaultValue={rates.lastYearTax}
                  onBlur={(ev) => updateSettings.mutate({ id: rates.id!, lastYearTax: parseFloat(ev.target.value) || 0 })}
                />
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
