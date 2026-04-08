import { Progress } from "@/components/ui/progress";

interface TaxLineProps {
  label: string;
  value: string;
  percent?: number;
}

function TaxLine({ label, value, percent }: TaxLineProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold text-card-foreground">{value}</span>
      </div>
      {percent !== undefined && <Progress value={percent} className="h-1.5" />}
    </div>
  );
}

interface TaxWidgetProps {
  estimatedTax: number;
  seTax: number;
  quarterlyEstimate: number;
  bnoTax: number;
  netProfit: number;
}

export default function TaxWidget({ estimatedTax, seTax, quarterlyEstimate, bnoTax, netProfit }: TaxWidgetProps) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const totalTaxLiability = estimatedTax + seTax + bnoTax;
  const effectiveRate = netProfit > 0 ? (totalTaxLiability / netProfit) * 100 : 0;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-card-foreground">Tax Estimates — April 2025</h3>
      <TaxLine label="Federal (32%)" value={fmt(estimatedTax)} percent={32} />
      <TaxLine label="Self-Employment (15.3%)" value={fmt(seTax)} percent={15.3} />
      <TaxLine label="WA B&O Tax (1.5%)" value={fmt(bnoTax)} percent={1.5} />
      <div className="pt-3 border-t border-border space-y-3">
        <TaxLine label="Quarterly Estimate" value={fmt(quarterlyEstimate)} />
        <TaxLine label="Total Tax Reserve" value={fmt(totalTaxLiability)} />
        <TaxLine label="Effective Rate" value={`${effectiveRate.toFixed(1)}%`} percent={effectiveRate} />
      </div>
    </div>
  );
}
