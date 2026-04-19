import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TaxBreakdownResult } from "@/hooks/useTaxBreakdown";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function Row({
  label,
  value,
  bold,
  muted,
  negative,
  highlight,
  planned,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  negative?: boolean;
  highlight?: boolean;
  planned?: boolean;
}) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className={cn(muted ? "text-muted-foreground" : "text-foreground", bold && "font-semibold", planned && "italic")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          bold ? "font-bold" : "font-medium",
          negative && "text-muted-foreground",
          highlight && "text-destructive",
          planned && "text-primary",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function TaxSummary({ data }: { data: TaxBreakdownResult }) {
  const showPlanned = data.mode === "forecast" && data.plannedTotalIncome > 0;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Income Summary
            {showPlanned && (
              <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                Includes planned
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5">
          {showPlanned ? (
            <>
              <Row label="Actual business revenue" value={fmt(data.actualBusinessRevenue)} muted />
              {data.plannedBusinessRevenue > 0 && (
                <Row label="Planned business revenue" value={`+${fmt(data.plannedBusinessRevenue)}`} planned />
              )}
              <Row label="Total business revenue used" value={fmt(data.totalBusinessRevenue)} />
            </>
          ) : (
            <Row label="Total business revenue" value={fmt(data.totalBusinessRevenue)} muted />
          )}
          <Row label="Total business expenses" value={`−${fmt(data.totalBusinessExpenses)}`} negative />
          <div className="border-t border-border my-1.5" />
          <Row label="Total business profit" value={fmt(data.totalBusinessProfit)} bold />
          <div className="h-2" />
          {showPlanned ? (
            <>
              <Row label="Actual W-2 income" value={fmt(data.actualW2Income)} muted />
              {data.plannedW2Income > 0 && (
                <Row label="Planned W-2 income" value={`+${fmt(data.plannedW2Income)}`} planned />
              )}
              <Row label="Total W-2 income used" value={fmt(data.totalW2Income)} />
            </>
          ) : (
            <Row label="Total W-2 income" value={fmt(data.totalW2Income)} muted />
          )}
          <Row label="Total capital gains" value={fmt(data.totalShortTermGains + data.totalLongTermGains)} muted />
          {showPlanned ? (
            <>
              <Row label="Actual other income" value={fmt(data.actualOtherIncome)} muted />
              {data.plannedOtherIncome > 0 && (
                <Row label="Planned other income" value={`+${fmt(data.plannedOtherIncome)}`} planned />
              )}
            </>
          ) : (
            <Row label="Total other income" value={fmt(data.totalOtherIncome)} muted />
          )}
          <div className="border-t border-border my-1.5" />
          <Row label="Total gross income" value={fmt(data.totalGrossIncome)} bold />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tax Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-0.5">
          <Row label="Pre-tax deductions" value={`−${fmt(data.preTaxDeductions)}`} negative />
          <Row label="Retirement contributions" value={`−${fmt(data.retirement401k)}`} negative />
          <Row label="½ SE tax deduction" value={`−${fmt(data.seDeductibleHalf)}`} negative />
          <Row
            label={data.deductionType === "itemized" ? "Itemized deduction" : "Standard deduction"}
            value={`−${fmt(data.deductionApplied)}`}
            negative
          />
          <div className="border-t border-border my-1.5" />
          <Row label="Total taxable income" value={fmt(data.totalTaxableIncome)} bold />
          <div className="h-2" />
          <Row label="Ordinary income tax" value={fmt(data.ordinaryBracketCalc.total)} muted />
          {data.ltcgBracketCalc.total > 0 && (
            <Row label="Long-term capital gains tax" value={fmt(data.ltcgBracketCalc.total)} muted />
          )}
          <Row label="Federal tax before credits" value={fmt(data.federalTaxBeforeCredits)} />
          {(data.qualifyingChildrenCount > 0 || data.otherDependentsCount > 0) && (
            <Row
              label={`Child & dependent credits${data.qualifyingChildrenCount + data.otherDependentsCount > 0 ? ` (${data.qualifyingChildrenCount} child${data.qualifyingChildrenCount === 1 ? "" : "ren"}, ${data.otherDependentsCount} other)` : ""}`}
              value={`−${fmt(data.dependentCredits)}`}
              negative
            />
          )}
          <Row label="Self-employment tax" value={fmt(data.seTax.total)} muted />
          {(data.personalStateTax > 0 || data.businessStateTax > 0) && (
            <>
              {data.personalStateTax > 0 && (
                <Row label="Personal state tax" value={fmt(data.personalStateTax)} muted />
              )}
              {data.businessStateTax > 0 && (
                <Row label="Business state tax" value={fmt(data.businessStateTax)} muted />
              )}
            </>
          )}
          <div className="border-t border-border my-1.5" />
          <Row label="Total estimated tax" value={fmt(data.totalEstimatedTax)} bold highlight />
          <Row
            label="Effective tax rate"
            value={`${(data.effectiveRate * 100).toFixed(1)}%`}
            muted
          />
          <Row
            label="Marginal tax rate"
            value={`${(data.marginalRate * 100).toFixed(0)}%`}
            muted
          />
          {data.withholdingOverrideType !== "none" && (
            <>
              <div className="border-t border-border my-1.5" />
              <Row
                label="Recommended (annual)"
                value={fmt(data.totalEstimatedTax)}
                muted
              />
              <Row
                label={
                  data.withholdingOverrideType === "percent"
                    ? `Your target (${data.withholdingOverridePercent ?? 0}%)`
                    : `Your target ($${(data.withholdingOverrideAmount ?? 0).toLocaleString()}/mo × 12)`
                }
                value={fmt(data.targetAnnualWithholding)}
                bold
              />
              <p className="text-[11px] text-muted-foreground pt-1 italic">
                Override is for planning only. Doesn't change estimated tax owed.
              </p>
            </>
          )}
          {showPlanned && (
            <p className="text-[11px] text-muted-foreground pt-2 italic">
              Based on current plan assumptions · planned income may push you into a higher bracket
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
