import { mockTransactions, getSummary } from "@/lib/mockData";
import { Progress } from "@/components/ui/progress";

export default function TaxPlanning() {
  const s = getSummary(mockTransactions);
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const totalTax = s.estimatedTax + s.seTax + s.bnoTax;
  const effectiveRate = s.netProfit > 0 ? (totalTax / s.netProfit) * 100 : 0;

  const quarters = [
    { label: "Q1 — Apr 15", paid: true },
    { label: "Q2 — Jun 15", paid: false },
    { label: "Q3 — Sep 15", paid: false },
    { label: "Q4 — Jan 15", paid: false },
  ];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Summary */}
      <div className="glass-card rounded-xl p-6 space-y-6">
        <h3 className="text-base font-semibold text-card-foreground">2025 Tax Projection</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div>
            <p className="text-sm text-muted-foreground">YTD Net Income</p>
            <p className="text-2xl font-bold text-card-foreground mt-1">{fmt(s.netProfit)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Total Tax Liability</p>
            <p className="text-2xl font-bold text-warning mt-1">{fmt(totalTax)}</p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Effective Rate</p>
            <p className="text-2xl font-bold text-card-foreground mt-1">{effectiveRate.toFixed(1)}%</p>
          </div>
        </div>
      </div>

      {/* Tax breakdown */}
      <div className="glass-card rounded-xl p-6 space-y-5">
        <h3 className="text-base font-semibold text-card-foreground">Tax Breakdown</h3>
        {[
          { label: "Federal Income Tax (32%)", value: s.estimatedTax, pct: 32 },
          { label: "Self-Employment Tax (15.3%)", value: s.seTax, pct: 15.3 },
          { label: "Washington B&O Tax (1.5%)", value: s.bnoTax, pct: 1.5 },
        ].map((item) => (
          <div key={item.label} className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{item.label}</span>
              <span className="font-semibold text-card-foreground">{fmt(item.value)}</span>
            </div>
            <Progress value={item.pct} className="h-2" />
          </div>
        ))}
      </div>

      {/* Quarterly estimates */}
      <div className="glass-card rounded-xl p-6 space-y-4">
        <h3 className="text-base font-semibold text-card-foreground">Quarterly Estimated Payments</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {quarters.map((q) => (
            <div key={q.label} className={`rounded-lg border p-4 ${q.paid ? "border-success/30 bg-success/5" : "border-border"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-card-foreground">{q.label}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${q.paid ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                  {q.paid ? "Paid" : "Due"}
                </span>
              </div>
              <p className="text-lg font-bold text-card-foreground mt-2">{fmt(s.quarterlyEstimate)}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
