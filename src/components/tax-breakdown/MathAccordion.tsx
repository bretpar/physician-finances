import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TaxBreakdownResult } from "@/hooks/useTaxBreakdown";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const fmtSmall = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

function Step({
  label,
  value,
  op,
  bold,
  planned,
}: {
  label: string;
  value: string;
  op?: "add" | "subtract" | "equals";
  bold?: boolean;
  planned?: boolean;
}) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <div className="flex items-center gap-2">
        {op && (
          <span className="w-4 text-center text-muted-foreground font-mono text-xs">
            {op === "add" ? "+" : op === "subtract" ? "−" : "="}
          </span>
        )}
        <span className={cn(bold ? "font-semibold" : "text-muted-foreground", planned && "italic")}>{label}</span>
      </div>
      <span className={cn("tabular-nums", bold ? "font-bold" : "font-medium", planned && "text-primary")}>{value}</span>
    </div>
  );
}

export default function MathAccordion({ data }: { data: TaxBreakdownResult }) {
  const filingLabel =
    data.filingStatus === "married_filing_jointly" ? "Married Filing Jointly" : "Single";
  const showPlanned = data.mode === "forecast" && data.plannedTotalIncome > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Show calculation details
          {showPlanned && (
            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
              Actual + Planned
            </Badge>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Filing status: <span className="font-medium text-foreground">{filingLabel}</span> · 2025 tax year
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion type="multiple" className="w-full">
          {/* A. Taxable income */}
          <AccordionItem value="taxable">
            <AccordionTrigger className="text-sm">A. Taxable income calculation</AccordionTrigger>
            <AccordionContent className="space-y-0">
              {showPlanned ? (
                <>
                  {(data.actualW2Income > 0 || data.plannedW2Income > 0) && (
                    <>
                      <Step label="Actual W-2 wages" value={fmt(data.actualW2Income)} op="add" />
                      {data.plannedW2Income > 0 && (
                        <Step label="Planned W-2 wages" value={fmt(data.plannedW2Income)} op="add" planned />
                      )}
                    </>
                  )}
                  {(data.actualBusinessRevenue > 0 || data.plannedBusinessRevenue > 0) && (
                    <>
                      <Step label="Actual business profit" value={fmt(data.actualBusinessRevenue - data.totalBusinessExpenses)} op="add" />
                      {data.plannedBusinessRevenue > 0 && (
                        <Step label="Planned business revenue" value={fmt(data.plannedBusinessRevenue)} op="add" planned />
                      )}
                    </>
                  )}
                  {data.totalShortTermGains > 0 && (
                    <Step label="Short-term capital gains" value={fmt(data.totalShortTermGains)} op="add" />
                  )}
                  {data.totalLongTermGains > 0 && (
                    <Step label="Long-term capital gains" value={fmt(data.totalLongTermGains)} op="add" />
                  )}
                  {(data.actualOtherIncome > 0 || data.plannedOtherIncome > 0) && (
                    <>
                      <Step label="Actual other income" value={fmt(data.actualOtherIncome)} op="add" />
                      {data.plannedOtherIncome > 0 && (
                        <Step label="Planned other income" value={fmt(data.plannedOtherIncome)} op="add" planned />
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {data.totalW2Income > 0 && <Step label="W-2 wages" value={fmt(data.totalW2Income)} op="add" />}
                  {data.totalBusinessProfit !== 0 && (
                    <Step label="Business profit" value={fmt(data.totalBusinessProfit)} op="add" />
                  )}
                  {data.totalShortTermGains > 0 && (
                    <Step label="Short-term capital gains" value={fmt(data.totalShortTermGains)} op="add" />
                  )}
                  {data.totalLongTermGains > 0 && (
                    <Step label="Long-term capital gains" value={fmt(data.totalLongTermGains)} op="add" />
                  )}
                  {data.totalOtherIncome > 0 && (
                    <Step label="Other income" value={fmt(data.totalOtherIncome)} op="add" />
                  )}
                </>
              )}
              <div className="border-t border-border my-1" />
              <Step label="Total gross income" value={fmt(data.totalGrossIncome)} op="equals" bold />
              <div className="h-2" />
              {data.preTaxDeductions > 0 && (
                <Step label="Pre-tax deductions" value={fmt(data.preTaxDeductions)} op="subtract" />
              )}
              {data.retirement401k > 0 && (
                <Step label="Retirement contributions" value={fmt(data.retirement401k)} op="subtract" />
              )}
              {data.healthInsuranceDeduction > 0 && (
                <Step label="Health insurance deduction" value={fmt(data.healthInsuranceDeduction)} op="subtract" />
              )}
              {data.seDeductibleHalf > 0 && (
                <Step label="½ self-employment tax" value={fmt(data.seDeductibleHalf)} op="subtract" />
              )}
              <div className="border-t border-border my-1" />
              <Step label="Adjusted Gross Income (AGI)" value={fmt(data.agi)} op="equals" bold />
              <div className="h-2" />
              <Step
                label={data.deductionType === "itemized" ? "Itemized deduction" : "Standard deduction"}
                value={fmt(data.deductionApplied)}
                op="subtract"
              />
              <div className="border-t border-border my-1" />
              <Step label="Taxable ordinary income" value={fmt(data.taxableOrdinaryIncome)} op="equals" />
              {data.taxableLTCG > 0 && (
                <Step label="Taxable long-term gains" value={fmt(data.taxableLTCG)} op="equals" />
              )}
              <Step label="Total taxable income" value={fmt(data.totalTaxableIncome)} op="equals" bold />
              <div className="h-2" />
              <Step label="Federal tax before credits" value={fmt(data.federalTaxBeforeCredits)} op="equals" />
              {data.dependentCredits > 0 && (
                <Step
                  label={`Child & dependent credits (${data.qualifyingChildrenCount} child${data.qualifyingChildrenCount === 1 ? "" : "ren"}, ${data.otherDependentsCount} other)`}
                  value={fmt(data.dependentCredits)}
                  op="subtract"
                />
              )}
              {showPlanned && (
                <p className="text-[11px] text-muted-foreground italic pt-2">
                  Planned amounts are projected · based on current plan assumptions
                </p>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* B. Bracket breakdown */}
          <AccordionItem value="brackets">
            <AccordionTrigger className="text-sm">B. Tax bracket breakdown</AccordionTrigger>
            <AccordionContent className="space-y-2">
              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <span>Filing status:</span>
                <Badge variant="secondary" className="text-[10px]">{filingLabel}</Badge>
                {showPlanned && (
                  <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">
                    Includes planned income
                  </Badge>
                )}
              </div>
              {showPlanned && (
                <p className="text-xs text-muted-foreground">
                  Planned income is added to taxable income, which may push you into a higher bracket.
                </p>
              )}
              {data.ordinaryBracketCalc.lines.length === 0 ? (
                <p className="text-sm text-muted-foreground">No taxable ordinary income.</p>
              ) : (
                <div className="space-y-1">
                  {data.ordinaryBracketCalc.lines.map((line, i) => (
                    <div key={i} className="flex justify-between text-sm py-1">
                      <span className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {(line.rate * 100).toFixed(0)}%
                        </span>{" "}
                        bracket: {fmt(line.amountInBracket)} taxed
                      </span>
                      <span className="tabular-nums font-medium">{fmtSmall(line.taxInBracket)}</span>
                    </div>
                  ))}
                  <div className="border-t border-border pt-1.5 flex justify-between text-sm font-semibold">
                    <span>Total ordinary income tax</span>
                    <span className="tabular-nums">{fmt(data.ordinaryBracketCalc.total)}</span>
                  </div>
                </div>
              )}
              {data.taxableLTCG > 0 && (
                <div className="mt-3 pt-3 border-t border-border space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Long-term capital gains
                  </p>
                  <p className="text-xs text-muted-foreground">
                    LTCG sits on top of ordinary income and uses its own 0% / 15% / 20% bracket schedule.
                  </p>
                  <div className="flex justify-between text-sm font-semibold pt-1">
                    <span>Long-term capital gains tax</span>
                    <span className="tabular-nums">{fmt(data.ltcgBracketCalc.total)}</span>
                  </div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* C. SE tax */}
          {data.seTax.total > 0 && (
            <AccordionItem value="se">
              <AccordionTrigger className="text-sm">C. Self-employment tax breakdown</AccordionTrigger>
              <AccordionContent className="space-y-0">
                <p className="text-xs text-muted-foreground pb-2">
                  Estimated · based on current inputs{showPlanned && " (includes planned income)"}
                </p>
                <Step label="Net self-employment income" value={fmt(data.seTax.netSEIncome)} op="equals" />
                <Step label="× 92.35% (SE base)" value={fmt(data.seTax.seBase)} op="equals" />
                <div className="border-t border-border my-1" />
                <Step label="Social Security (12.4% on SE base, capped)" value={fmt(data.seTax.ssTax)} op="add" />
                <Step label="Medicare (2.9% on SE base)" value={fmt(data.seTax.medicareTax)} op="add" />
                <div className="border-t border-border my-1" />
                <Step label="Total self-employment tax" value={fmt(data.seTax.total)} op="equals" bold />
                <Step label="Half is deductible above the line" value={fmt(data.seTax.deductibleHalf)} op="equals" />
              </AccordionContent>
            </AccordionItem>
          )}

          {/* D. Capital gains */}
          {(data.totalShortTermGains > 0 || data.totalLongTermGains > 0) && (
            <AccordionItem value="capgains">
              <AccordionTrigger className="text-sm">D. Capital gains breakdown</AccordionTrigger>
              <AccordionContent className="space-y-0">
                {data.totalShortTermGains > 0 && (
                  <Step label="Short-term gains (taxed as ordinary income)" value={fmt(data.totalShortTermGains)} />
                )}
                {data.totalLongTermGains > 0 && (
                  <Step label="Long-term gains (preferential rates)" value={fmt(data.totalLongTermGains)} />
                )}
                <div className="border-t border-border my-1" />
                <Step
                  label="Net gains used in tax calculation"
                  value={fmt(data.totalShortTermGains + data.totalLongTermGains)}
                  op="equals"
                  bold
                />
                <p className="text-xs text-muted-foreground pt-2">
                  Short-term gains are folded into ordinary income. Long-term gains are taxed separately at 0%, 15%, or 20% based on total taxable income.
                </p>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      </CardContent>
    </Card>
  );
}
