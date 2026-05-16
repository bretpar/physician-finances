import { Briefcase, Building2, LineChart, Coins } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  to: string;
}

function Cell({ label, value, Icon, to }: CellProps) {
  const navigate = useNavigate();
  const negative = value < 0;
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="text-left rounded-2xl bg-card border border-border/60 shadow-sm p-4 transition hover:border-primary/40 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`View ${label}`}
    >
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
    </button>
  );
}

/**
 * 2x2 grid of small income-source cards. Values are passed in by the parent —
 * computed from the same dashboard data sources as the rest of the page.
 */
export default function IncomeBreakdownCards({ businessProfit, w2Total, investments, other }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4">
      <Cell label="Business Profit" value={businessProfit} Icon={Briefcase} to="/business-activity" />
      <Cell label="W-2 Total" value={w2Total} Icon={Building2} to="/personal-income" />
      <Cell label="Investments" value={investments} Icon={LineChart} to="/investments" />
      <Cell label="Other" value={other} Icon={Coins} to="/personal-income" />
    </div>
  );
}
