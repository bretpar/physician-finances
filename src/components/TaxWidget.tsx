import { Progress } from "@/components/ui/progress";

interface TaxLineProps {
  label: string;
  value: string;
  percent?: number;
  variant?: "default" | "success" | "warning";
}

function TaxLine({ label, value, percent, variant = "default" }: TaxLineProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-semibold ${variant === "success" ? "text-success" : variant === "warning" ? "text-warning" : "text-card-foreground"}`}>{value}</span>
      </div>
      {percent !== undefined && <Progress value={Math.min(percent, 100)} className="h-1.5" />}
    </div>
  );
}

interface TaxWidgetProps {
  estimatedTax: number;
  seTax: number;
  quarterlyEstimate: number;
  netProfit: number;
  w2Withheld: number;
  totalTaxLiability: number;
  remainingLiability: number;
}

export default function TaxWidget({ estimatedTax, seTax, quarterlyEstimate, netProfit, w2Withheld, totalTaxLiability, remainingLiability }: TaxWidgetProps) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const effectiveRate = netProfit > 0 ? (totalTaxLiability / netProfit) * 100 : 0;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-card-foreground">Tax Estimates — April 2026</h3>
      <TaxLine label="Federal (32% all income)" value={fmt(estimatedTax)} percent={32} />
      <TaxLine label="SE Tax (15.3% on 1099/K-1)" value={fmt(seTax)} percent={15.3} />
      <div className="pt-3 border-t border-border space-y-3">
        <TaxLine label="Total Tax Liability" value={fmt(totalTaxLiability)} />
        <TaxLine label="W-2 Withholdings" value={`−${fmt(w2Withheld)}`} variant="success" />
        <TaxLine label="Remaining to Set Aside" value={fmt(remainingLiability)} variant="warning" />
        <TaxLine label="Quarterly Estimate" value={fmt(quarterlyEstimate)} />
        <TaxLine label="Effective Rate" value={`${effectiveRate.toFixed(1)}%`} percent={effectiveRate} />
      </div>
    </div>
  );
}
