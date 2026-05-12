import { TrendingUp } from "lucide-react";
import { useCountUp } from "@/hooks/useCountUp";

interface Props {
  amount: number;
  /** "Planned" | "Actual (YTD)" descriptor shown beneath the number. */
  modeLabel: string;
  subtext?: string;
  /** Optional toggle element rendered in the card header (e.g. Actual/Full year switch). */
  toggle?: React.ReactNode;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

/**
 * Hero "Total Annual Income" card. Soft-green tint, large display number.
 * Receives the value already chosen by the parent based on the Planned/Actual toggle —
 * does NOT recompute income locally.
 */
export default function AnnualIncomeHero({ amount, modeLabel, subtext, toggle }: Props) {
  const animated = useCountUp(amount);
  return (
    <section
      className="relative overflow-hidden rounded-2xl bg-success/10 px-5 py-6 sm:px-6 sm:py-7 shadow-sm"
      aria-label="Total annual income"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs sm:text-sm font-medium text-foreground/70">Total Annual Income</p>
            {toggle && <div className="shrink-0">{toggle}</div>}
          </div>
          <p className="mt-2 text-4xl sm:text-5xl font-bold tabular-nums tracking-tight text-foreground">
            {fmt(animated)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {modeLabel}
            {subtext && subtext !== modeLabel ? ` · ${subtext}` : ""}
          </p>
        </div>
        <div className="hidden sm:flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-success/20 text-success">
          <TrendingUp className="h-6 w-6" />
        </div>
      </div>
    </section>
  );
}

