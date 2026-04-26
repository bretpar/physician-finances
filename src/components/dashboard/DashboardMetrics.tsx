import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useCountUp } from "@/hooks/useCountUp";
import { useIncomeEntries } from "@/hooks/useIncome";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import {
  useProjectedStreams,
  useProjectedBonuses,
  useStreamOverrides,
  generateProjectedPaychecks,
  getProjectedTotals,
} from "@/hooks/useProjectedIncome";
import { isFeatureEnabled } from "@/lib/featureFlags";
import { cn } from "@/lib/utils";

interface DashboardMetricsProps {
  /** YTD total income (W2 + 1099 + K-1 + other). From useDashboardSummary.totalIncome. */
  totalIncomeYTD: number;
  /** YTD business profit = business revenue – business expenses. From useDashboardSummary.businessNetIncome. */
  businessProfitYTD: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

/**
 * Top-of-dashboard metrics card with an optional premium "Projection View" toggle.
 *
 * Default view:
 *  - Total Income (YTD)
 *  - Business Profit (YTD)
 *
 * Projection View (premium toggle ON):
 *  - Expected Annual Income — same formula as Income Planner
 *    (`actualYTD.income + projectedTotals.grossIncome`)
 *  - Projected Business Profit — `forecastDebug.netBusinessProfit` from the
 *    unified tax engine, which already mirrors Income Planner's projection math.
 */
export default function DashboardMetrics({
  totalIncomeYTD,
  businessProfitYTD,
}: DashboardMetricsProps) {
  const isPremium = isFeatureEnabled("premium_visibility");
  const [projection, setProjection] = useState(true);

  // ── Pull the EXACT same inputs Income Planner uses ──────────────────────
  const { data: incomeEntries } = useIncomeEntries();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { forecastDebug } = useTaxEstimate();

  // Mirror ProjectedIncome.tsx (lines 249–278) exactly.
  const projectedPaychecks = useMemo(() => {
    if (!streams || !bonuses) return [];
    return generateProjectedPaychecks(
      streams,
      bonuses,
      incomeEntries || [],
      overrides || [],
    );
  }, [streams, bonuses, incomeEntries, overrides]);

  const projectedTotals = useMemo(
    () => getProjectedTotals(projectedPaychecks),
    [projectedPaychecks],
  );

  const actualYTD = useMemo(() => {
    if (!incomeEntries) return { income: 0 };
    const year = new Date().getFullYear();
    const ytd = incomeEntries.filter((e) =>
      e.income_date.startsWith(String(year)),
    );
    return {
      income: ytd.reduce((s, e) => s + Number(e.paycheck_amount), 0),
    };
  }, [incomeEntries]);

  const expectedAnnualIncome = actualYTD.income + projectedTotals.grossIncome;
  const projectedBusinessProfit = forecastDebug?.netBusinessProfit ?? 0;

  const primaryValue = projection ? expectedAnnualIncome : totalIncomeYTD;
  const secondaryValue = projection ? projectedBusinessProfit : businessProfitYTD;
  const primaryLabel = projection ? "Expected Annual Income" : "Total Income (YTD)";
  const secondaryLabel = projection ? "Projected Business Profit" : "Business Profit (YTD)";

  const primaryAnim = useCountUp(primaryValue);
  const secondaryAnim = useCountUp(secondaryValue);

  return (
    <section className="px-1">
      {/* Header row: subtle, with optional premium toggle on the right */}
      {isPremium && (
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
            <p className="text-[10px] sm:text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground mb-2">
              {primaryLabel}
            </p>
            <p className="text-[34px] leading-none sm:text-5xl font-bold tabular-nums tracking-tight text-foreground">
              {fmt(primaryAnim)}
            </p>
          </div>
        </div>

        {/* Secondary metric — Business Profit */}
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
