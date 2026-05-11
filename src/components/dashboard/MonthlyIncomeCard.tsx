import { useMemo, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

export interface MonthBreakdown {
  /** 0-11 */
  month: number;
  actual: number;
  planned: number;
}

interface Props {
  /** All 12 months (Jan..Dec) for the selected year. */
  months: MonthBreakdown[];
  /** 0-11 — current month index (used to color the "current" bar specially). */
  currentMonth: number;
  /** Total YTD income to show in optional summary. */
  ytdIncome: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function Bar({ row, isCurrent, max }: { row: MonthBreakdown; isCurrent: boolean; max: number }) {
  const total = row.actual + row.planned;
  const heightPct = max > 0 ? Math.max(2, (total / max) * 100) : 2;
  const actualPct = total > 0 ? (row.actual / total) * 100 : isCurrent ? 0 : 0;
  return (
    <div className="flex flex-1 flex-col items-center gap-1.5 min-w-0">
      <div className="relative w-full flex justify-center items-end h-32" title={`${fmt(total)}`}>
        <div
          className="w-6 sm:w-7 rounded-t-md overflow-hidden bg-success/20 flex flex-col-reverse"
          style={{ height: `${heightPct}%` }}
        >
          {/* Actual portion (dark green) at the bottom */}
          <div
            className="w-full bg-success"
            style={{ height: `${actualPct}%` }}
          />
        </div>
      </div>
      <span
        className={cn(
          "text-[10px] sm:text-xs font-medium",
          isCurrent ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {MONTH_LABELS[row.month]}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground/80">
        {total > 0 ? fmt(total) : "—"}
      </span>
    </div>
  );
}

/**
 * Monthly income bar chart. Dark green = actual income received,
 * light green = planned/projected income. Current month combines both.
 *
 * Mobile default: previous / current / next month.
 * Desktop: full 12 months. Mobile users can tap to expand to all 12.
 */
export default function MonthlyIncomeCard({ months, currentMonth, ytdIncome }: Props) {
  const isMobile = useIsMobile();
  const [expandedOnMobile, setExpandedOnMobile] = useState(false);

  const visibleMonths = useMemo(() => {
    if (!isMobile || expandedOnMobile) return months;
    const prev = (currentMonth - 1 + 12) % 12;
    const next = (currentMonth + 1) % 12;
    const indices = [prev, currentMonth, next];
    return indices.map((i) => months[i]).filter(Boolean);
  }, [months, currentMonth, isMobile, expandedOnMobile]);

  const max = useMemo(
    () => Math.max(1, ...months.map((m) => m.actual + m.planned)),
    [months],
  );

  const currentRow = months[currentMonth];
  const remainingThisMonth = currentRow ? currentRow.planned : 0;
  const earnedThisMonth = currentRow ? currentRow.actual : 0;

  return (
    <section className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <h3 className="text-sm sm:text-base font-semibold text-foreground">Monthly Income</h3>
          <p className="text-xs text-muted-foreground">Actual and planned income by month</p>
        </div>
        {isMobile && (
          <button
            type="button"
            onClick={() => setExpandedOnMobile((v) => !v)}
            className="text-xs font-medium text-primary hover:underline"
          >
            {expandedOnMobile ? "Show less" : "All 12 months"}
          </button>
        )}
      </div>

      <div className="mt-4 flex items-end gap-1 sm:gap-2">
        {visibleMonths.map((row) => (
          <Bar
            key={row.month}
            row={row}
            isCurrent={row.month === currentMonth}
            max={max}
          />
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-success" /> Actual
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-success/30" /> Planned
        </span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-xs">
        <div>
          <p className="text-muted-foreground">This month</p>
          <p className="font-semibold tabular-nums text-foreground">{fmt(earnedThisMonth)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Planned remaining</p>
          <p className="font-semibold tabular-nums text-foreground">{fmt(remainingThisMonth)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">YTD</p>
          <p className="font-semibold tabular-nums text-foreground">{fmt(ytdIncome)}</p>
        </div>
      </div>
    </section>
  );
}
