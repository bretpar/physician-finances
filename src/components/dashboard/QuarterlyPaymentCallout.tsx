import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  computeQuarterRecommendation,
  shouldShowDashboardPaymentCallout,
  type QuarterRecommendationInput,
  type QuarterRecommendation,
} from "@/lib/quarterRecommendation";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

interface Props extends Omit<QuarterRecommendationInput, "year" | "quarter"> {
  onLogPayment?: () => void;
}

function currentQuarter(now: Date): { year: number; quarter: 1 | 2 | 3 | 4 } {
  return { year: now.getFullYear(), quarter: (Math.floor(now.getMonth() / 3) + 1) as 1 | 2 | 3 | 4 };
}

/**
 * Compact dashboard callout for the current estimated-tax quarter.
 * Decide whether to render via `shouldShowDashboardPaymentCallout`; pass the
 * resulting `QuarterRecommendation` to keep the component pure.
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
    ? `${recommendation.label} estimated tax payment may be overdue`
    : `${recommendation.label} estimated tax payment due soon`;
  const amountLabel = overdue
    ? `Recommended payment remaining: ${fmt(recommendation.recommendedQuarterlyPayment)}`
    : `Recommended payment: ${fmt(recommendation.recommendedQuarterlyPayment)} by ${recommendation.deadlineLabel}`;
  const subcopy = overdue
    ? "Log a payment once submitted."
    : "This accounts for W-2 withholding, estimated payments, and amounts you marked as saved.";

  return (
    <Card className={cn("border-2", tone)}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          <Icon className={cn("h-6 w-6 shrink-0", overdue ? "text-amber-600" : "text-primary")} />
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{title}</p>
            <p className={cn("text-sm tabular-nums mt-0.5", overdue ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>
              {amountLabel}
            </p>
            <p className="text-xs text-muted-foreground mt-1">{subcopy}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {onLogPayment ? (
            <Button size="sm" onClick={onLogPayment}>Log Tax Payment</Button>
          ) : (
            <Button size="sm" onClick={() => navigate("/taxes#quarterly-estimator")}>Log Tax Payment</Button>
          )}
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
 * Convenience wrapper that computes the recommendation from raw dashboard
 * inputs and returns either the callout, `null` (window not active), or
 * passes through to a fallback via the `fallback` render prop.
 */
export default function DashboardQuarterlyPaymentCallout({
  fallback,
  ...input
}: Props & { fallback?: () => JSX.Element | null }) {
  const now = useMemo(() => new Date(), []);
  const { year, quarter } = currentQuarter(now);
  const recommendation = useMemo(
    () => computeQuarterRecommendation({ year, quarter, ...input }),
    [year, quarter, input],
  );
  const { show, overdue } = shouldShowDashboardPaymentCallout(recommendation, now);
  if (!show) return fallback ? fallback() : null;
  return <QuarterlyPaymentCallout recommendation={recommendation} overdue={overdue} />;
}
