import { useEffect, useMemo, useRef, useState } from "react";
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
const MONTH_LABELS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function Bar({
  row,
  isCurrent,
  isFocused,
  isDimmed,
  max,
  onSelect,
}: {
  row: MonthBreakdown;
  isCurrent: boolean;
  isFocused: boolean;
  isDimmed: boolean;
  max: number;
  onSelect: (month: number) => void;
}) {
  const total = row.actual + row.planned;
  const heightPct = max > 0 ? Math.max(2, (total / max) * 100) : 2;
  const actualPct = total > 0 ? (row.actual / total) * 100 : 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(row.month);
      }}
      aria-label={`${MONTH_LABELS_FULL[row.month]}: ${fmt(total)} total`}
      aria-pressed={isFocused}
      className={cn(
        "group flex flex-1 flex-col items-center gap-1.5 min-w-0 rounded-md py-1 -my-1 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        isDimmed && "opacity-40",
      )}
    >
      <div className="relative w-full flex justify-center items-end h-32">
        <div
          className={cn(
            "w-6 sm:w-7 rounded-t-md overflow-hidden bg-success/20 flex flex-col-reverse transition-all",
            isFocused && "ring-2 ring-success ring-offset-1 ring-offset-card",
          )}
          style={{ height: `${heightPct}%` }}
        >
          <div className="w-full bg-success" style={{ height: `${actualPct}%` }} />
        </div>
      </div>
      <span
        className={cn(
          "text-[10px] sm:text-xs font-medium",
          isFocused || isCurrent ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {MONTH_LABELS[row.month]}
      </span>
      <span className="text-[10px] tabular-nums text-muted-foreground/80">
        {total > 0 ? fmt(total) : "—"}
      </span>
    </button>
  );
}

export default function MonthlyIncomeCard({ months, currentMonth, ytdIncome }: Props) {
  const isMobile = useIsMobile();
  const [expandedOnMobile, setExpandedOnMobile] = useState(false);
  const [focusedMonth, setFocusedMonth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Dismiss focus on outside tap.
  useEffect(() => {
    if (focusedMonth === null) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocusedMonth(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocusedMonth(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [focusedMonth]);

  const handleSelect = (m: number) => {
    setFocusedMonth((prev) => (prev === m ? null : m));
  };

  const focusedRow = focusedMonth !== null ? months[focusedMonth] : null;
  const currentRow = months[currentMonth];
  const remainingThisMonth = currentRow ? currentRow.planned : 0;
  const earnedThisMonth = currentRow ? currentRow.actual : 0;

  return (
    <section
      ref={containerRef}
      className="rounded-2xl bg-card border border-border/60 shadow-sm p-4 sm:p-5"
    >
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

      {/* Tooltip / focused-month detail */}
      <div
        aria-live="polite"
        className={cn(
          "mt-3 overflow-hidden transition-all duration-200",
          focusedRow ? "max-h-24 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {focusedRow && (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">
                {MONTH_LABELS_FULL[focusedRow.month]}
              </p>
              <button
                type="button"
                onClick={() => setFocusedMonth(null)}
                className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                aria-label="Clear month selection"
              >
                Clear
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-2 text-[11px]">
              <div>
                <p className="text-muted-foreground">Actual</p>
                <p className="font-semibold tabular-nums text-foreground">{fmt(focusedRow.actual)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Planned</p>
                <p className="font-semibold tabular-nums text-foreground">{fmt(focusedRow.planned)}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Total</p>
                <p className="font-semibold tabular-nums text-foreground">
                  {fmt(focusedRow.actual + focusedRow.planned)}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-end gap-1 sm:gap-2">
        {visibleMonths.map((row) => (
          <Bar
            key={row.month}
            row={row}
            isCurrent={row.month === currentMonth}
            isFocused={focusedMonth === row.month}
            isDimmed={focusedMonth !== null && focusedMonth !== row.month}
            max={max}
            onSelect={handleSelect}
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
