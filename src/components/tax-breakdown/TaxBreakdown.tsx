import { useState } from "react";
import { useTaxBreakdown, type TaxBreakdownMode } from "@/hooks/useTaxBreakdown";
import SummaryCards from "./SummaryCards";
import IncomeSourceCards from "./IncomeSourceCards";
import TaxSummary from "./TaxSummary";
import AgiReconciliationPanel from "./AgiReconciliationPanel";
import {
  TaxableIncomeMath,
  BracketBreakdownMath,
  W2PayrollTaxMath,
  SETaxMath,
  CapitalGainsMath,
} from "./MathAccordion";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

interface Props {
  filterCompanyName?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

function SummaryRow({
  label,
  value,
  op,
  bold,
  highlight,
  muted,
}: {
  label: string;
  value: string;
  op?: "subtract" | "equals" | "add";
  bold?: boolean;
  highlight?: boolean;
  muted?: boolean;
}) {
  const sign = op === "subtract" ? "−" : op === "equals" ? "=" : op === "add" ? "+" : "";
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <div className="flex min-w-0 items-center gap-2">
        <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">{sign}</span>
        <span className={cn(bold ? "font-semibold text-foreground" : muted ? "text-muted-foreground" : "text-foreground")}>
          {label}
        </span>
      </div>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          bold ? "font-bold" : "font-medium",
          highlight && "text-destructive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function TaxBreakdown({ filterCompanyName }: Props) {
  const [mode, setMode] = useState<TaxBreakdownMode>("forecast");
  const data = useTaxBreakdown(filterCompanyName, mode);

  if (data.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading tax breakdown…</p>
      </div>
    );
  }

  const adjustments =
    data.preTaxDeductions + data.retirement401k + data.healthInsuranceDeduction + data.seDeductibleHalf;
  const showPlanned = mode === "forecast" && data.plannedTotalIncome > 0;
  const hasSE = data.seTax.total > 0;
  const hasState = (data.personalStateTax + data.businessStateTax) > 0;
  const hasInvestments = data.totalShortTermGains > 0 || data.totalLongTermGains > 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tax Breakdown</h2>
          <p className="text-sm text-muted-foreground">
            How your taxes are calculated, in plain English.{" "}
            <Badge variant="secondary" className="ml-1 text-[10px]">Estimated</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {filterCompanyName && (
            <Badge variant="outline" className="text-xs">
              Filtered: {filterCompanyName}
            </Badge>
          )}
          <div className="flex items-center gap-1 rounded-lg border border-border p-1 bg-muted/30">
            <button
              onClick={() => setMode("forecast")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                mode === "forecast"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Planned Income
            </button>
            <button
              onClick={() => setMode("actual")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                mode === "actual"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Actual Only
            </button>
          </div>
        </div>
      </div>

      {showPlanned && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
          <span className="font-medium">Planned income included:</span>{" "}
          <span className="tabular-nums">{fmt(data.plannedTotalIncome)}</span>{" "}
          <span className="text-muted-foreground">· based on current plan assumptions</span>
        </div>
      )}

      {/* 1. Top summary cards */}
      <SummaryCards
        totalIncome={data.totalGrossIncome}
        taxableIncome={data.totalTaxableIncome}
        estimatedTax={data.totalEstimatedTax}
        effectiveRate={data.effectiveRate}
        mode={mode}
      />

      {/* 2. Default visible: Tax calculation summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Tax calculation summary</CardTitle>
          <p className="text-xs text-muted-foreground">
            Income → deductions → taxable income → taxes → payments → remaining tax.
          </p>
        </CardHeader>
        <CardContent className="space-y-0">
          <SummaryRow label="Total income" value={fmt(data.totalGrossIncome)} bold />
          {data.totalBusinessExpenses > 0 && (
            <SummaryRow label="Business expenses" value={fmt(data.totalBusinessExpenses)} op="subtract" />
          )}
          {adjustments > 0 && (
            <SummaryRow
              label="Pre-tax deductions and adjustments"
              value={fmt(adjustments)}
              op="subtract"
            />
          )}
          <div className="border-t border-border my-1" />
          <SummaryRow label="Adjusted gross income" value={fmt(data.agi)} op="equals" bold />
          <SummaryRow
            label={data.deductionType === "itemized" ? "Itemized deduction" : "Standard deduction"}
            value={fmt(data.deductionApplied)}
            op="subtract"
          />
          <div className="border-t border-border my-1" />
          <SummaryRow label="Taxable income" value={fmt(data.totalTaxableIncome)} op="equals" bold />
          <div className="h-2" />
          <SummaryRow label="Federal tax after credits" value={fmt(data.federalTaxAfterCredits)} />
          {hasSE && <SummaryRow label="Self-employment tax" value={fmt(data.seTax.total)} />}
          {hasState && <SummaryRow label="State tax" value={fmt(data.stateTax)} />}
          <div className="border-t border-border my-1" />
          <SummaryRow
            label="Total estimated tax"
            value={fmt(data.totalEstimatedTax)}
            op="equals"
            bold
            highlight
          />
          <div className="h-2" />
          <SummaryRow
            label="Withholding and payments counted"
            value={fmt(data.countedCreditsTotal)}
            op="subtract"
            muted
          />
          <div className="border-t border-border my-1" />
          <SummaryRow
            label="Remaining projected tax"
            value={fmt(data.remainingTaxDue)}
            op="equals"
            bold
          />
          <div className="h-2" />
          <SummaryRow
            label="Effective tax rate"
            value={`${(data.effectiveRate * 100).toFixed(1)}%`}
            muted
          />
        </CardContent>
      </Card>

      {/* 3. Collapsed detail sections */}
      <Card>
        <CardContent className="pt-3 pb-2">
          <Accordion type="multiple" className="w-full">
            <AccordionItem value="income-sources">
              <AccordionTrigger className="text-sm">Income sources</AccordionTrigger>
              <AccordionContent>
                <IncomeSourceCards sources={data.sources} mode={mode} />
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="agi-details">
              <AccordionTrigger className="text-sm">Deductions and AGI details</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <AgiReconciliationPanel data={data} />
                <div className="rounded-lg border border-border p-3">
                  <p className="text-xs font-medium text-muted-foreground mb-2">
                    Taxable income calculation
                  </p>
                  <TaxableIncomeMath data={data} />
                </div>
              </AccordionContent>
            </AccordionItem>

            <AccordionItem value="federal-tax">
              <AccordionTrigger className="text-sm">Federal tax details</AccordionTrigger>
              <AccordionContent>
                <BracketBreakdownMath data={data} />
              </AccordionContent>
            </AccordionItem>

            {hasSE && (
              <AccordionItem value="se-tax">
                <AccordionTrigger className="text-sm">Self-employment tax details</AccordionTrigger>
                <AccordionContent>
                  <SETaxMath data={data} />
                </AccordionContent>
              </AccordionItem>
            )}

            {hasState && (
              <AccordionItem value="state-tax">
                <AccordionTrigger className="text-sm">State tax details</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-0">
                    {data.personalStateTax > 0 && (
                      <SummaryRow label="Personal state tax" value={fmt(data.personalStateTax)} />
                    )}
                    {data.businessStateTax > 0 && (
                      <SummaryRow label="Business state tax" value={fmt(data.businessStateTax)} />
                    )}
                    <div className="border-t border-border my-1" />
                    <SummaryRow label="Total state tax" value={fmt(data.stateTax)} op="equals" bold />
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem value="payments">
              <AccordionTrigger className="text-sm">Payments and withholding</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-0">
                  <SummaryRow label="Federal withholding paid" value={fmt(data.federalWithheldPaid)} />
                  <SummaryRow label="State withholding paid" value={fmt(data.stateWithheldPaid)} />
                  <SummaryRow label="Estimated payments made" value={fmt(data.estimatedPaymentsMade)} />
                  <div className="border-t border-border my-1" />
                  <SummaryRow
                    label="Total counted toward this year"
                    value={fmt(data.countedCreditsTotal)}
                    op="equals"
                    bold
                  />
                  <div className="h-2" />
                  <SummaryRow label="Total estimated tax" value={fmt(data.totalEstimatedTax)} muted />
                  <SummaryRow
                    label="Remaining projected tax"
                    value={fmt(data.remainingTaxDue)}
                    op="equals"
                    bold
                  />
                </div>
              </AccordionContent>
            </AccordionItem>

            {hasInvestments && (
              <AccordionItem value="investments">
                <AccordionTrigger className="text-sm">Investment tax details</AccordionTrigger>
                <AccordionContent>
                  <CapitalGainsMath data={data} />
                </AccordionContent>
              </AccordionItem>
            )}

            {showPlanned && (
              <AccordionItem value="planned">
                <AccordionTrigger className="text-sm">Planned income assumptions</AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-0">
                    <SummaryRow label="Planned business revenue" value={fmt(data.plannedBusinessRevenue)} />
                    <SummaryRow label="Planned W-2 income" value={fmt(data.plannedW2Income)} />
                    <SummaryRow label="Planned other income" value={fmt(data.plannedOtherIncome)} />
                    <div className="border-t border-border my-1" />
                    <SummaryRow
                      label="Total planned income"
                      value={fmt(data.plannedTotalIncome)}
                      op="equals"
                      bold
                    />
                    <p className="text-[11px] text-muted-foreground pt-2 italic">
                      Planned amounts come from your projected income streams and may push you into a
                      higher tax bracket. They are not yet received.
                    </p>
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            <AccordionItem value="advanced">
              <AccordionTrigger className="text-sm">Advanced audit details</AccordionTrigger>
              <AccordionContent className="space-y-4">
                <TaxSummary data={data} />
                {data.totalW2Income > 0 && (
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      W-2 payroll tax (Social Security &amp; Medicare)
                    </p>
                    <W2PayrollTaxMath data={data} />
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center pt-2">
        These numbers are estimated based on your current inputs. They are not your final filed tax return.
      </p>
    </div>
  );
}
