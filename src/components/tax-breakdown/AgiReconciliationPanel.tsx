import { useState } from "react";
import { ChevronDown, CircleDollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaxBreakdownResult } from "@/hooks/useTaxBreakdown";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

interface ReconciliationRow {
  id: string;
  label: string;
  amount: number;
  op: "start" | "subtract" | "equals";
  details: { label: string; value: number | string }[];
}

function DrillRow({ row }: { row: ReconciliationRow }) {
  const [open, setOpen] = useState(false);
  const sign = row.op === "subtract" ? "−" : row.op === "equals" ? "=" : "";

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button className="w-full rounded-md px-3 py-2 text-left transition-colors hover:bg-muted/60">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="w-4 shrink-0 text-center font-mono text-xs text-muted-foreground">{sign}</span>
              <span className={cn("text-sm", row.op === "equals" ? "font-semibold text-foreground" : "text-muted-foreground")}>{row.label}</span>
              {row.details.length > 0 && <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />}
            </div>
            <span className={cn("shrink-0 tabular-nums text-sm", row.op === "equals" ? "font-bold text-foreground" : "font-medium text-foreground")}>
              {fmt(row.amount)}
            </span>
          </div>
        </button>
      </CollapsibleTrigger>
      {row.details.length > 0 && (
        <CollapsibleContent className="px-9 pb-2">
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-1.5">
            {row.details.map((detail) => (
              <div key={detail.label} className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">{detail.label}</span>
                <span className="text-right font-medium tabular-nums text-foreground">
                  {typeof detail.value === "number" ? fmt(detail.value) : detail.value}
                </span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export default function AgiReconciliationPanel({ data }: { data: TaxBreakdownResult }) {
  const rows: ReconciliationRow[] = [
    {
      id: "return-income",
      label: "Total return income",
      amount: data.totalReturnIncomeBeforeAdjustments,
      op: "start",
      details: [
        { label: "Net business profit", value: data.totalBusinessProfit },
        { label: "W-2 gross income", value: data.totalW2Income },
        { label: "W-2 pre-tax deductions already removed", value: data.w2PreTaxDeductions },
        { label: "W-2 taxable income after payroll deductions", value: data.w2TaxableIncomeBase },
        { label: "Other income", value: data.totalOtherIncome + data.totalShortTermGains + data.totalLongTermGains },
      ],
    },
    {
      id: "non-w2-pretax",
      label: "Non-W-2 pre-tax deductions",
      amount: data.preTaxDeductions,
      op: "subtract",
      details: [
        { label: "Non-W-2 pre-tax deductions only", value: data.preTaxDeductions },
        { label: "Deduction source breakdown", value: data.deductionSourceBreakdown || "No source breakdown available" },
      ],
    },
    {
      id: "retirement",
      label: "Retirement contributions",
      amount: data.retirement401k,
      op: "subtract",
      details: [
        { label: "Total retirement contributions included", value: data.retirement401k },
        { label: "Planned retirement portion", value: data.plannedRetirement },
      ],
    },
    {
      id: "health",
      label: "Health insurance deduction",
      amount: data.healthInsuranceDeduction,
      op: "subtract",
      details: [
        { label: "Actual health insurance deduction", value: data.actualHealthInsuranceDeduction },
        { label: "Projected health insurance deduction", value: data.projectedHealthInsuranceDeduction },
      ],
    },
    {
      id: "half-se",
      label: "½ self-employment tax deduction",
      amount: data.seDeductibleHalf,
      op: "subtract",
      details: [
        { label: "Net SE income", value: data.seTax.netSEIncome },
        { label: "SE tax base", value: data.seTax.seBase },
        { label: "Total SE tax", value: data.seTax.total },
        { label: "Deductible half", value: data.seDeductibleHalf },
      ],
    },
    {
      id: "agi",
      label: "Adjusted Gross Income (AGI)",
      amount: data.agi,
      op: "equals",
      details: [
        { label: "Formula", value: "Total return income − adjustments above" },
      ],
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              How adjusted gross income is calculated
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Click any row to see the values behind it.</p>
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px]">{data.mode === "forecast" ? "Planned" : "Actual"}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-1">
        {rows.map((row) => <DrillRow key={row.id} row={row} />)}
        <div className="pt-2">
          <Button variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground hover:bg-transparent">
            AGI then flows into taxable income after standard or itemized deductions.
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}