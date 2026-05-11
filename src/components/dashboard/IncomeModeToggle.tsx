import { cn } from "@/lib/utils";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { isFeatureEnabled } from "@/lib/featureFlags";

interface Props {
  /** Force-show even for non-w2 users when premium gating would normally hide the toggle. */
  alwaysShow?: boolean;
  className?: string;
}

/**
 * Planned vs Actual segmented control. Synced with the Taxes tab via the
 * shared tax-mode store inside useTaxEstimate. Does NOT change calculations
 * — it only switches the active mode that downstream cards read from.
 */
export default function IncomeModeToggle({ alwaysShow = false, className }: Props) {
  const { taxMode, setTaxMode } = useTaxEstimate();
  const isPremium = isFeatureEnabled("premium_visibility");
  if (!alwaysShow && !isPremium) return null;
  const projection = taxMode === "forecast";
  return (
    <div className={cn("flex items-center justify-center", className)}>
      <div
        className="inline-flex items-center gap-1 rounded-full bg-muted p-1"
        role="tablist"
        aria-label="Income mode"
      >
        <button
          type="button"
          role="tab"
          aria-selected={!projection}
          onClick={() => setTaxMode("actual")}
          className={cn(
            "px-4 py-1.5 text-xs font-semibold rounded-full transition-colors",
            !projection ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Actual
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={projection}
          onClick={() => setTaxMode("forecast")}
          className={cn(
            "px-4 py-1.5 text-xs font-semibold rounded-full transition-colors",
            projection ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
        >
          Planned
        </button>
      </div>
    </div>
  );
}
