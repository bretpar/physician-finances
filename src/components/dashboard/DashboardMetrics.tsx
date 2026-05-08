import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { useCountUp } from "@/hooks/useCountUp";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

interface DashboardMetricsProps {
  /** YTD total income (W2 + 1099 + K-1 + other). From useDashboardSummary.totalIncome. */
  totalIncomeYTD: number;
  /** YTD business profit = business revenue – business expenses. From useDashboardSummary.businessNetIncome. */
  businessProfitYTD: number;
  w2Only?: boolean;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Top-of-dashboard metrics card.
 *
 * IMPORTANT: All "annual" / "projected" income values come from the SAME
 * unified tax engine that powers the Taxes tab (`useTaxEstimate`). This is
 * what guarantees the Dashboard's "Expected Annual Income" matches the Taxes
 * tab's "Total Gross Income" when Planned Income mode is on. Do NOT recompute
 * income locally here — the engine already aggregates:
 *   - W-2 actual + projected (income_entries + planner streams)
 *   - 1099 / K-1 actual + projected (transactions + planner streams)
 *   - Personal income entries (spouse W-2, side income, rental, etc.)
 *   - Investment dividends and stock capital gains
 *   - YTD catch-up entries
 */
export default function DashboardMetrics({
  totalIncomeYTD,
  businessProfitYTD,
  w2Only = false,
}: DashboardMetricsProps) {
  const isPremium = isFeatureEnabled("premium_visibility");
  const [projection, setProjection] = useState(true);

  const { forecastDebug, actualDebug } = useTaxEstimate();

  // Single source of truth: the unified tax engine's gross totals.
  // forecastDebug = actual YTD + planned future. actualDebug = actual only.
  const expectedAnnualIncome = forecastDebug?.totalGrossIncome ?? 0;
  const projectedBusinessProfit = forecastDebug?.netBusinessProfit ?? 0;
  const ytdGrossFromEngine = actualDebug?.totalGrossIncome ?? totalIncomeYTD;

  const primaryValue = w2Only
    ? expectedAnnualIncome
    : (projection ? expectedAnnualIncome : ytdGrossFromEngine);
  const secondaryValue = w2Only
    ? (forecastDebug?.totalTaxableIncome ?? 0)
    : (projection ? projectedBusinessProfit : businessProfitYTD);
  const primaryLabel = w2Only
    ? "Projected Household Income"
    : (projection ? "Expected Annual Income" : "Total Income (YTD)");
  const secondaryLabel = w2Only
    ? "Projected Taxable Income"
    : (projection ? "Projected Business Profit" : "Business Profit (YTD)");
  const primaryTooltip = w2Only
    ? "Total household gross income for the year — actual YTD plus planned future paychecks from all earners. Matches 'Total Gross Income' on the Taxes tab when Planned Income mode is on."
    : (projection
        ? "Full-year projected gross income from every source (W-2, 1099, K-1, personal income, dividends, capital gains, rental, YTD catch-ups, plus planned future paychecks). Same number as 'Total Gross Income' on the Taxes tab in Planned Income mode — before any deductions."
        : "Actual gross income received so far this year, across every source. This will be lower than 'Total Gross Income' on the Taxes tab if that tab is in Planned Income mode (which also adds future planned paychecks).");

  const primaryAnim = useCountUp(primaryValue);
  const secondaryAnim = useCountUp(secondaryValue);

  return (
    <section className="px-1">
      {/* Header row: subtle, with optional premium toggle on the right */}
      {isPremium && !w2Only && (
        <div className="flex items-center justify-end gap-2 mb-3">
          <Label
            htmlFor="projection-toggle"
            className="text-[11px] uppercase tracking-wider text-muted-foreground cursor-pointer"
          >
            Projection View
          </Label>
          <Switch
            id="projection-toggle"
            checked={projection}
            onCheckedChange={setProjection}
            aria-label="Toggle projection view"
          />
        </div>
      )}

      {/* Stacked metrics — dominant numbers, soft containers, accent bars */}
      <div
        key={projection ? "proj" : "ytd"}
        className="space-y-3 animate-fade-in"
      >
        {/* Primary metric — Total / Expected Income */}
        <div className="relative flex items-center gap-3 rounded-2xl bg-card px-4 py-4 sm:py-5 overflow-hidden">
          <span
            aria-hidden
            className="absolute left-0 top-3 bottom-3 w-1 rounded-r-full bg-primary"
          />
          <div className="pl-2 min-w-0 flex-1">
            <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2 inline-flex items-center gap-1.5">
              {primaryLabel}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="text-muted-foreground hover:text-foreground" aria-label="What's included in this number?">
                      <Info className="h-3 w-3" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-relaxed normal-case tracking-normal">
                    {primaryTooltip}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </p>
            <p className="text-[34px] leading-none sm:text-5xl font-bold tabular-nums tracking-tight text-foreground">
              {fmt(primaryAnim)}
            </p>
          </div>
        </div>

        {/* Secondary metric */}
        <div className="relative flex items-center gap-3 rounded-2xl bg-card px-4 py-3.5 sm:py-4 overflow-hidden">
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-3 bottom-3 w-1 rounded-r-full",
              secondaryValue < 0 ? "bg-destructive" : "bg-success",
            )}
          />
          <div className="pl-2 min-w-0 flex-1">
            <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2">
              {secondaryLabel}
            </p>
            <p
              className={cn(
                "text-[26px] leading-none sm:text-[32px] font-semibold tabular-nums tracking-tight",
                secondaryValue < 0 ? "text-destructive" : "text-foreground",
              )}
            >
              {fmt(secondaryAnim)}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
