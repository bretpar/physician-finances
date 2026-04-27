import { type TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  debug: TaxDebugBreakdown;
  label?: string;
  /** When provided, shows a consistency check comparing this debug to `compareDebug` */
  compareDebug?: TaxDebugBreakdown | null;
  compareLabel?: string;
}

type FieldDef = { key: keyof TaxDebugBreakdown; label: string; isBool?: boolean; isText?: boolean; isPercent?: boolean };

const FIELDS: FieldDef[] = [
  { key: "includeProjectedIncome", label: "Projected income included?", isBool: true },
  { key: "filingStatus", label: "Filing status", isText: true },
  { key: "grossBusinessIncome", label: "Gross business income" },
  { key: "businessExpenses", label: "− Business expenses" },
  { key: "netBusinessProfit", label: "= Net business profit" },
  { key: "w2Income", label: "+ W-2 gross income" },
  { key: "w2PreTaxDeductions", label: "− W-2 pre-tax deductions" },
  { key: "w2TaxableIncomeBase", label: "= W-2 taxable income after payroll deductions" },
  { key: "otherIncome", label: "+ Other income" },
  { key: "totalReturnIncomeBeforeAdjustments", label: "= Total return income" },
  { key: "preTaxDeductions", label: "− Non-W-2 pre-tax deductions" },
  { key: "deductionSourceBreakdown", label: "Deduction source breakdown", isText: true },
  { key: "retirementContributions", label: "− Retirement contributions" },
  { key: "healthInsuranceDeduction", label: "− Health insurance deduction" },
  { key: "halfSETaxDeduction", label: "− ½ SE tax deduction" },
  { key: "agi", label: "= Adjusted Gross Income (AGI)" },
  { key: "deductionApplied", label: "− Standard/itemized deduction" },
  { key: "totalTaxableIncome", label: "= Taxable income" },
  { key: "federalIncomeTax", label: "Federal income tax" },
  { key: "selfEmploymentTax", label: "+ Self-employment tax" },
  { key: "personalStateTax", label: "+ Personal state income tax" },
  { key: "businessStateTax", label: "+ Business state tax" },
  { key: "stateTax", label: "+ Total state tax" },
  { key: "totalEstimatedTax", label: "= Total estimated tax" },
  { key: "canonicalEffectiveTaxRate", label: "Canonical effective tax rate", isPercent: true },
  { key: "taxOverviewRateSource", label: "Tax Overview rate source", isText: true },
  { key: "advancedBreakdownRateSource", label: "Advanced Breakdown rate source", isText: true },
  { key: "personalRecommendationsRateSource", label: "Personal recommendations rate source", isText: true },
  { key: "businessRecommendationsRateSource", label: "Business recommendations rate source", isText: true },
  { key: "flatManualWithholdingActive", label: "Flat/manual withholding active?", isBool: true },
  { key: "federalTaxBeforeCredits", label: "  (Federal before credits)" },
  { key: "taxCredits", label: "  (Child/Dependent credits)" },
  // ── Credits against tax (explicit) ──
  { key: "actualFederalWithheld", label: "− Actual federal withheld" },
  { key: "actualStateWithheld", label: "− Actual state withheld" },
  { key: "projectedFederalWithheld", label: "− Projected federal withheld (future W-2)" },
  { key: "projectedStateWithheld", label: "− Projected state withheld (future W-2)" },
  { key: "estimatedPaymentsMade", label: "− Estimated tax payments made" },
  { key: "countedCreditsTotal", label: "= Counted credits total" },
  { key: "taxSavingsSetAside", label: "  (Tax savings set aside — NOT counted)" },
  { key: "nonCountedSavingsTotal", label: "  (Non-counted savings total)" },
  { key: "remainingTaxDue", label: "= Remaining tax due" },
  { key: "recommendedSetAside", label: "Recommended set-aside/paycheck" },
  { key: "targetSetAside", label: "User-target set-aside (override)" },
];

function formatValue(val: unknown, isBool?: boolean, isPercent?: boolean): string {
  if (isBool) return val ? "Yes" : "No";
  if (typeof val === "string") return val.replace(/_/g, " ");
  if (isPercent) return `${Number(val || 0).toFixed(2)}%`;
  return fmt(val as number);
}

function getMismatches(a: TaxDebugBreakdown, b: TaxDebugBreakdown): FieldDef[] {
  return FIELDS.filter((f) => {
    const va = a[f.key];
    const vb = b[f.key];
    if (f.isBool) return va !== vb;
    if (f.isText) return va !== vb;
    return Math.abs((va as number) - (vb as number)) > 0.01;
  });
}

export default function TaxDebugPanel({ debug, label = "Tax Calculation Debug", compareDebug, compareLabel = "Income Planner" }: Props) {
  const [open, setOpen] = useState(false);

  const rows: [string, string][] = FIELDS.map((f) => [f.label, formatValue(debug[f.key], f.isBool, f.isPercent)]);

  const mismatches = compareDebug ? getMismatches(debug, compareDebug) : [];
  const isConsistent = compareDebug ? mismatches.length === 0 : null;

  return (
    <div className="space-y-2">
      {/* Consistency check banner */}
      {compareDebug && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium",
            isConsistent
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300"
          )}
        >
          {isConsistent ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Consistency check passed — Taxes tab and {compareLabel} use identical inputs and produce the same estimated annual tax.
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Consistency mismatch — {mismatches.length} field(s) differ between Taxes tab and {compareLabel}. Expand debug below for details.
            </>
          )}
        </div>
      )}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground gap-1 text-xs">
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            {label}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-2 border-dashed">
            <CardHeader className="pb-2 pt-3">
              <CardTitle className="text-xs font-mono text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="pb-3 space-y-1">
              {/* If comparing, show side-by-side for mismatched fields */}
              {compareDebug && mismatches.length > 0 && (
                <div className="mb-3 space-y-1 border-b border-dashed pb-3">
                  <div className="flex justify-between text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-1">
                    <span>Mismatched Field</span>
                    <span className="flex gap-6">
                      <span className="w-24 text-right">Taxes Tab</span>
                      <span className="w-24 text-right">{compareLabel}</span>
                    </span>
                  </div>
                  {mismatches.map((f) => (
                    <div key={f.key} className="flex justify-between text-xs font-mono">
                      <span className="text-amber-600 dark:text-amber-400">{f.label}</span>
                      <span className="flex gap-6">
                        <span className="w-24 text-right font-medium">{formatValue(debug[f.key], f.isBool, f.isPercent)}</span>
                        <span className="w-24 text-right font-medium">{formatValue(compareDebug[f.key], f.isBool, f.isPercent)}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between text-xs font-mono">
                  <span className="text-muted-foreground">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
