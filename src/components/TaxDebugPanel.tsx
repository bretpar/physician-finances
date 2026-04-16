import { type TaxDebugBreakdown } from "@/lib/taxCalculationService";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

interface Props {
  debug: TaxDebugBreakdown;
  label?: string;
}

export default function TaxDebugPanel({ debug, label = "Tax Calculation Debug" }: Props) {
  const [open, setOpen] = useState(false);

  const rows: [string, string][] = [
    ["Projected income included?", debug.includeProjectedIncome ? "Yes" : "No"],
    ["Actual income (YTD)", fmt(debug.actualIncome)],
    ["Projected future income", fmt(debug.projectedIncome)],
    ["Total gross income", fmt(debug.totalGrossIncome)],
    ["Total deductions", fmt(debug.totalDeductions)],
    ["Taxable income", fmt(debug.totalTaxableIncome)],
    ["Estimated annual tax", fmt(debug.estimatedAnnualTax)],
    ["Taxes already withheld", fmt(debug.taxesAlreadyWithheld)],
    ["Quarterly payments made", fmt(debug.quarterlyPayments)],
    ["Tax savings set aside", fmt(debug.taxSavings)],
    ["Tax reserves (not paid)", fmt(debug.taxReserves)],
    ["Remaining estimated tax", fmt(debug.remainingEstimatedTax)],
    ["Recommended set-aside/paycheck", fmt(debug.recommendedSetAside)],
  ];

  return (
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
  );
}
