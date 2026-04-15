import { CheckCircle2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { IncomeRecommendation, RecommendationStatus } from "@/hooks/useIncomeRecommendation";
import { isFeatureEnabled } from "@/lib/featureFlags";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const STATUS_CONFIG: Record<RecommendationStatus, { label: string; color: string; icon: typeof TrendingUp }> = {
  ahead: { label: "Ahead", color: "text-emerald-600 dark:text-emerald-400", icon: TrendingUp },
  on_track: { label: "On Track", color: "text-blue-600 dark:text-blue-400", icon: Minus },
  behind: { label: "Behind", color: "text-amber-600 dark:text-amber-400", icon: TrendingDown },
};

interface Props {
  open: boolean;
  onClose: () => void;
  onApplyRecommendation: () => void;
  recommendation: IncomeRecommendation | null;
  entryTitle: string;
}

export function RecommendationModal({ open, onClose, onApplyRecommendation, recommendation, entryTitle }: Props) {
  if (!recommendation) return null;

  const showDynamic = isFeatureEnabled("dynamic_paycheck_recommendation");
  const showQuarterly = isFeatureEnabled("quarterly_payment_tracking");

  const statusCfg = STATUS_CONFIG[recommendation.recommendationStatus];
  const StatusIcon = statusCfg.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            Income Saved
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <strong>{entryTitle}</strong> has been saved successfully.
          </p>

          {/* Base estimate — always shown */}
          <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Base tax estimate for this paycheck</span>
              <span className="text-sm font-semibold">{fmt(recommendation.baseTaxEstimate)}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {recommendation.methodLabel} · {recommendation.effectiveRate.toFixed(1)}% effective rate
            </p>
          </div>

          {/* Dynamic recommendation — premium feature */}
          {showDynamic && recommendation.isDynamicEnabled && (
            <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
              {recommendation.quarterlyAdjustmentAmount > 0 ? (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Quarterly adjustment recommendation</span>
                  <span className="text-sm font-semibold text-amber-600 dark:text-amber-400">
                    +{fmt(recommendation.quarterlyAdjustmentAmount)}
                  </span>
                </div>
              ) : (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Quarterly adjustment recommendation</span>
                  <span className="text-sm font-semibold">{fmt(0)}</span>
                </div>
              )}

              <div className="flex justify-between items-center border-t border-border pt-2">
                <span className="text-sm font-medium">Total suggested tax reserve</span>
                <span className="text-sm font-bold">{fmt(recommendation.totalSuggestedReserve)}</span>
              </div>
            </div>
          )}

          {/* Quarterly status — premium feature */}
          {showQuarterly && recommendation.isDynamicEnabled && (
            <div className="rounded-lg border border-border p-3 space-y-2 bg-muted/20">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Status for next estimated payment</span>
                <Badge variant="outline" className={`${statusCfg.color} gap-1`}>
                  <StatusIcon className="h-3 w-3" />
                  {statusCfg.label}
                </Badge>
              </div>

              {recommendation.recommendationStatus === "behind" && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Shortfall for next estimated payment: {fmt(Math.abs(recommendation.shortfallOrSurplus))}
                </p>
              )}
              {recommendation.recommendationStatus === "ahead" && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  You are currently ahead for the next estimated payment. No additional tax reserve is needed at this time.
                </p>
              )}
              {recommendation.recommendationStatus === "on_track" && (
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  You are on track for the next estimated payment.
                </p>
              )}
            </div>
          )}

          {/* Recommended additional tax reserve */}
          {recommendation.recommendedAdditionalReserve > 0 && (
            <div className="rounded-lg border-2 border-primary/30 p-3 bg-primary/5">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Recommended Additional tax reserve</span>
                <span className="text-base font-bold text-primary">{fmt(recommendation.recommendedAdditionalReserve)}</span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                This is the amount above your actual withholding that we recommend setting aside.
              </p>
            </div>
          )}

          {recommendation.recommendedAdditionalReserve <= 0 && (
            <div className="rounded-lg border border-border p-3 bg-muted/20">
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Your current withholding covers the estimated tax. No additional reserve is needed.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {recommendation.recommendedAdditionalReserve > 0 && (
            <Button onClick={onApplyRecommendation} className="w-full sm:w-auto">
              Apply recommendation
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="w-full sm:w-auto">
            Return to transactions
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
