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
  federalEffectiveRate?: number;
  effectiveRate?: number;
  seEffectiveRate?: number;
  additionalSETaxReserve?: number;
  showAdditionalSETaxReserve?: boolean;
}

export default function TaxWidget({
  estimatedTax,
  seTax,
  quarterlyEstimate,
  w2Withheld,
  totalTaxLiability,
  remainingLiability,
  federalEffectiveRate,
  effectiveRate,
  seEffectiveRate,
  additionalSETaxReserve = 0,
  showAdditionalSETaxReserve = false,
}: TaxWidgetProps) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const pct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div className="glass-card rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-card-foreground">Tax Estimates — April 2026</h3>
      <TaxLine label="Federal income tax estimate" value={fmt(estimatedTax)} />
      {federalEffectiveRate !== undefined && (
        <TaxLine label="Effective federal tax rate" value={pct(federalEffectiveRate)} percent={federalEffectiveRate} />
      )}
      <TaxLine label="Self-employment tax estimate" value={fmt(seTax)} percent={seEffectiveRate} />
      {showAdditionalSETaxReserve && additionalSETaxReserve > 0 && (
        <TaxLine label="Additional SE tax reserve" value={fmt(additionalSETaxReserve)} variant="warning" />
      )}
      <div className="pt-3 border-t border-border space-y-3">
        <TaxLine label="Total Tax Liability" value={fmt(totalTaxLiability)} />
        <TaxLine label="W-2 Withholdings" value={`−${fmt(w2Withheld)}`} variant="success" />
        <TaxLine label="Remaining to Set Aside" value={fmt(remainingLiability)} variant="warning" />
        <TaxLine label="Quarterly Estimate" value={fmt(quarterlyEstimate)} />
        {effectiveRate !== undefined && <TaxLine label="Effective tax rate" value={pct(effectiveRate)} percent={effectiveRate} />}
      </div>
    </div>
  );
}
