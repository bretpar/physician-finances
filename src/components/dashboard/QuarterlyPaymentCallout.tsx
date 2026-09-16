import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  useQuarterDashboardState,
  useDismissQuarterCallout,
  useFreezeQuarterTarget,
  findQuarterState,
} from "@/hooks/useQuarterDashboardState";
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
  onDoneWithQuarter,
  nextQuarterLabel,
}: {
  recommendation: QuarterRecommendation;
  overdue: boolean;
  onLogPayment?: () => void;
  /** Present only once the next quarter's income period has begun. */
  onDoneWithQuarter?: () => void;
  nextQuarterLabel?: string;
}) {
  const navigate = useNavigate();
  const [confirmOpen, setConfirmOpen] = useState(false);
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
            type="button"
            onClick={() => navigate("/taxes#quarterly-estimator")}
            aria-label={`View ${recommendation.quarterLabel} tax details`}
            className={cn(
              "text-sm tabular-nums cursor-pointer bg-transparent border-0 p-0 underline underline-offset-2 focus-visible:outline-none",
              overdue ? "text-amber-700 dark:text-amber-400" : "text-primary"
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
        <div className="flex flex-col items-center gap-1">
          <Button size="sm" onClick={goToLogPayment}>
            Log {recommendation.quarterLabel} Payment
          </Button>
          {onDoneWithQuarter && (
            <>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Done with {recommendation.quarterLabel}
              </button>
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Move on to {nextQuarterLabel ?? "the next quarter"}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This will not mark the remaining {recommendation.quarterLabel} amount as paid.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => {
                        setConfirmOpen(false);
                        onDoneWithQuarter();
                      }}
                    >
                      Move on
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
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
  const { data: states } = useQuarterDashboardState();
  const dismiss = useDismissQuarterCallout();
  const freeze = useFreezeQuarterTarget();
  const state = findQuarterState(states, active.year, active.quarter);

  const recommendation = useMemo(
    () =>
      buildQuarterRecommendation({
        ...input,
        now,
        year: active.year,
        quarter: active.quarter,
        frozenQuarterTarget: state?.frozen_quarter_target ?? null,
      }),
    [input, now, active.year, active.quarter, state?.frozen_quarter_target],
  );

  // The next quarter's income period has begun (e.g. Sep 1 for Q3).
  const periodClosed = now >= recommendation.end;

  // Snapshot the closed quarter's target once so later-quarter income cannot
  // retroactively increase it.
  const frozeRef = useRef(false);
  useEffect(() => {
    if (!periodClosed) return;
    if (!states) return;
    if (state?.frozen_quarter_target != null) return;
    if (frozeRef.current) return;
    if (!(recommendation.quarterTarget > 0)) return;
    frozeRef.current = true;
    freeze.mutate({
      taxYear: active.year,
      quarter: active.quarter,
      target: Number(recommendation.quarterTarget.toFixed(2)),
    });
  }, [
    periodClosed,
    states,
    state?.frozen_quarter_target,
    recommendation.quarterTarget,
    active.year,
    active.quarter,
  ]);

  const dismissed = !!state?.dismissed_at;
  if (dismissed || !recommendation.showDashboardPaymentCallout) {
    return fallback ? fallback() : null;
  }

  const nextQuarterLabel = recommendation.quarter === 4 ? "Q1" : `Q${recommendation.quarter + 1}`;

  return (
    <QuarterlyPaymentCallout
      recommendation={recommendation}
      overdue={recommendation.dashboardCalloutMode === "overdue"}
      onLogPayment={onLogPayment}
      nextQuarterLabel={nextQuarterLabel}
      onDoneWithQuarter={
        periodClosed
          ? () => dismiss.mutate({ taxYear: active.year, quarter: active.quarter })
          : undefined
      }
    />
  );
}
