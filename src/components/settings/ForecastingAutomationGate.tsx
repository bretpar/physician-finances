import { Lock } from "lucide-react";
import { ForecastingAutomationSection } from "@/components/settings/ForecastingAutomationSection";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

/**
 * Entitlement gate for forecasting automation settings. Locked users keep the
 * standard locked-setting presentation instead of the section disappearing.
 */
export function ForecastingAutomationGate() {
  const { can, isLocked } = useFeatureAccess();
  if (can("forecastingAutomation")) return <ForecastingAutomationSection bare />;
  if (!isLocked("forecastingAutomation")) return null;

  return (
    <div data-testid="forecasting-automation-locked" className="space-y-1">
      <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" /> Forecasting Automation
      </p>
      <p className="text-xs text-muted-foreground">
        Premium unlocks automatic conversion of planned future income into your ledger.
      </p>
    </div>
  );
}
