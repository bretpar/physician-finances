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

type FieldDef = { key: keyof TaxDebugBreakdown; label: string; isBool?: boolean };

const FIELDS: FieldDef[] = [
  { key: "includeProjectedIncome", label: "Projected income included?", isBool: true },
  { key: "actualIncome", label: "Actual income (YTD)" },
  { key: "projectedIncome", label: "Projected future income" },
  { key: "totalGrossIncome", label: "Total gross income" },
  { key: "preTaxDeductions", label: "Pre-tax deductions" },
  { key: "businessExpenses", label: "Business expenses (reduce profit)" },
  { key: "ownerDeductions", label: "Owner deductions (reduce taxable income)" },
  { key: "deductionApplied", label: "Standard/Itemized deduction applied" },
  { key: "totalDeductions", label: "Total deductions" },
  { key: "totalTaxableIncome", label: "Taxable income" },
  { key: "federalTaxBeforeCredits", label: "Federal tax (before credits)" },
  { key: "taxCredits", label: "Child/Dependent credits applied" },
  { key: "estimatedAnnualTax", label: "Estimated annual tax (after credits)" },
  { key: "taxesAlreadyWithheld", label: "Taxes already withheld" },
  { key: "quarterlyPayments", label: "Quarterly payments made" },
  { key: "taxSavings", label: "Tax savings set aside" },
  { key: "taxReserves", label: "Tax reserves (not paid)" },
  { key: "remainingEstimatedTax", label: "Remaining estimated tax" },
  { key: "recommendedSetAside", label: "Recommended set-aside/paycheck" },
  { key: "targetSetAside", label: "User-target set-aside (override)" },
];

function formatValue(val: unknown, isBool?: boolean): string {
  if (isBool) return val ? "Yes" : "No";
  return fmt(val as number);
}

function getMismatches(a: TaxDebugBreakdown, b: TaxDebugBreakdown): FieldDef[] {
  return FIELDS.filter((f) => {
    const va = a[f.key];
    const vb = b[f.key];
    if (f.isBool) return va !== vb;
    return Math.abs((va as number) - (vb as number)) > 0.01;
  });
}

export default function TaxDebugPanel({ debug, label = "Tax Calculation Debug", compareDebug, compareLabel = "Income Planner" }: Props) {
  const [open, setOpen] = useState(false);

  const rows: [string, string][] = FIELDS.map((f) => [f.label, formatValue(debug[f.key], f.isBool)]);

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
                        <span className="w-24 text-right font-medium">{formatValue(debug[f.key], f.isBool)}</span>
                        <span className="w-24 text-right font-medium">{formatValue(compareDebug[f.key], f.isBool)}</span>
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
