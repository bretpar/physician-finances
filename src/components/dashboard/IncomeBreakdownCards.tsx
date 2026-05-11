import { Briefcase, Building2, LineChart, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  businessProfit: number;
  w2Total: number;
  investments: number;
  other: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface CellProps {
  label: string;
  value: number;
  Icon: typeof Briefcase;
}

function Cell({ label, value, Icon }: CellProps) {
  const negative = value < 0;
  return (
    <div className="rounded-2xl bg-card border border-border/60 shadow-sm p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/10 text-success">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn(
          "mt-3 text-xl sm:text-2xl font-bold tabular-nums tracking-tight",
          negative ? "text-destructive" : "text-foreground",
        )}
      >
        {fmt(value)}
      </p>
    </div>
  );
}

/**
 * 2x2 grid of small income-source cards. Values are passed in by the parent —
 * computed from the same dashboard data sources as the rest of the page.
 */
export default function IncomeBreakdownCards({ businessProfit, w2Total, investments, other }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <Cell label="Business Profit" value={businessProfit} Icon={Briefcase} />
      <Cell label="W-2 Total" value={w2Total} Icon={Building2} />
      <Cell label="Investments" value={investments} Icon={LineChart} />
      <Cell label="Other" value={other} Icon={Coins} />
    </div>
  );
}
