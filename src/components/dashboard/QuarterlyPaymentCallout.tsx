import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, ExternalLink } from "lucide-react";
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
  const Icon = overdue ? AlertTriangle : Clock;
  const tone = overdue
    ? "border-amber-400/40 bg-amber-50/60 dark:bg-amber-950/20"
    : "border-primary/30 bg-primary/[0.04]";
  const title = overdue
    ? `${recommendation.quarterLabel} Payment Overdue`
    : `${recommendation.quarterLabel} Payment Due`;
  const recommendedRemaining = recommendation.recommendedPaymentToMake;
  const amountLabel = overdue
    ? `Recommended payment: ${fmt(recommendedRemaining)}`
    : `Recommended payment: ${fmt(recommendedRemaining)} by ${recommendation.deadlineLabel}`;

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
    <Card className={cn("border-2", tone)}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-6 w-6 shrink-0", overdue ? "text-amber-600" : "text-primary")} />
          <div className="min-w-0 w-full">
            <p className="font-semibold text-foreground">{title}</p>
            <p className={cn("text-sm tabular-nums mt-0.5", overdue ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>
              {amountLabel}
            </p>
            <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground tabular-nums sm:grid-cols-2">
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt>Total {recommendation.quarterLabel} tax target</dt>
                <dd>{fmt(recommendation.quarterTarget)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>W-2 withholding paid</dt>
                <dd>{fmt(recommendation.w2WithheldThisQuarter)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Estimated payments made</dt>
                <dd>{fmt(recommendation.estimatedPaymentsMade)}</dd>
              </div>
              <div className="flex justify-between gap-2 sm:col-span-2">
                <dt>Saved/reserved but not paid</dt>
                <dd>{fmt(recommendation.savedThisQuarter)}</dd>
              </div>
              <div className="flex justify-between gap-2 sm:col-span-2 font-medium text-foreground">
                <dt>Recommended payment remaining</dt>
                <dd>{fmt(recommendedRemaining)}</dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground mt-2">
              Saved/reserved cash is shown separately — it isn't subtracted from the payment to make.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={goToLogPayment}>
            Log {recommendation.quarterLabel} Payment
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigate("/taxes#quarterly-estimator")}>
            View Details
          </Button>
          <Button size="sm" variant="ghost" asChild>
            <a href="https://www.irs.gov/payments/direct-pay" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" /> IRS Direct Pay
            </a>
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
