import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildQuarterRecommendation,
  getActivePaymentTarget,
  type QuarterRecommendationInput,
  type QuarterRecommendation,
} from "@/lib/quarterRecommendation";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Props extends Omit<QuarterRecommendationInput, "year" | "quarter"> {
  onLogPayment?: () => void;
}

/**
 * Compact dashboard callout for the active estimated-tax quarter. The
 * recommendation must already be computed via `buildQuarterRecommendation`
 * so this component stays pure / presentational.
 */
export function QuarterlyPaymentCallout({
  recommendation,
  overdue,
  onLogPayment,
}: {
  recommendation: QuarterRecommendation;
  overdue: boolean;
  onLogPayment?: () => void;
}) {
  const navigate = useNavigate();
  const recommendedRemaining = recommendation.recommendedPaymentToMake;

  const goToLogPayment = () => {
    if (onLogPayment) return onLogPayment();
    const params = new URLSearchParams({
      logPayment: recommendation.quarterLabel,
      amount: String(Math.round(recommendedRemaining)),
      year: String(recommendation.taxYear),
    });
    navigate(`/taxes?${params.toString()}#quarterly-estimator`);
  };

  return (
    <Card className={cn("border-2", overdue ? "border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20" : "border-primary/30 bg-primary/[0.04]")}>
      <CardContent className="py-4 space-y-4">
        {/* Header row */}
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold text-foreground">
            {recommendation.quarterLabel} Payment
          </p>
          <button
            onClick={() => navigate("/taxes#quarterly-estimator")}
            className={cn(
              "text-sm tabular-nums cursor-pointer bg-transparent border-0 p-0 underline-offset-2 hover:underline",
              overdue ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
            )}
          >
            Due {recommendation.deadlineLabel}
          </button>
        </div>

        {/* Centered amount */}
        <div className="text-center">
          <p className="text-4xl font-bold tabular-nums text-foreground tracking-tight">
            {fmt(recommendedRemaining)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Recommended estimated tax payment
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-center">
          <Button size="sm" onClick={goToLogPayment}>
            Log {recommendation.quarterLabel} Payment
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Convenience wrapper. Selects the active payment quarter via
 * `getActivePaymentTarget` (so the Dashboard surfaces e.g. Q2 on Jun 9
 * even though the calendar quarter is already Q3), then renders either
 * the callout, `null`, or a fallback for the *current calendar quarter*.
 */
export default function DashboardQuarterlyPaymentCallout({
  fallback,
  onLogPayment,
  ...input
}: Props & { fallback?: () => JSX.Element | null }) {
  const now = useMemo(() => input.now ?? new Date(), [input.now]);
  const active = useMemo(() => getActivePaymentTarget(now), [now]);
  const recommendation = useMemo(
    () => buildQuarterRecommendation({ ...input, now, year: active.year, quarter: active.quarter }),
    [input, now, active.year, active.quarter],
  );
  if (!recommendation.showDashboardPaymentCallout) return fallback ? fallback() : null;
  return (
    <QuarterlyPaymentCallout
      recommendation={recommendation}
      overdue={recommendation.dashboardCalloutMode === "overdue"}
      onLogPayment={onLogPayment}
    />
  );
}
