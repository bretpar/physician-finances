import { Card, CardContent } from "@/components/ui/card";

interface Props {
  totalIncome: number;
  taxableIncome: number;
  estimatedTax: number;
  effectiveRate: number; // 0-1
  mode?: "actual" | "forecast";
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function SummaryCards({ totalIncome, taxableIncome, estimatedTax, effectiveRate, mode = "actual" }: Props) {
  const helper =
    mode === "forecast" ? "Includes planned income" : "Estimated · current year";
  const items = [
    { label: "Total Income", value: fmt(totalIncome), tone: "default" },
    { label: "Taxable Income", value: fmt(taxableIncome), tone: "default" },
    { label: "Estimated Tax", value: fmt(estimatedTax), tone: "destructive" },
    { label: "Effective Tax Rate", value: `${(effectiveRate * 100).toFixed(1)}%`, tone: "primary" },
  ] as const;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {items.map((it) => (
        <Card key={it.label}>
          <CardContent className="pt-5 pb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{it.label}</p>
            <p
              className={`text-2xl font-bold tabular-nums mt-1.5 ${
                it.tone === "destructive"
                  ? "text-destructive"
                  : it.tone === "primary"
                    ? "text-primary"
                    : "text-foreground"
              }`}
            >
              {it.value}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{helper}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
