import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { SectionCard } from "@/components/settings/SectionCard";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import { useSectionDraft } from "@/hooks/useSectionDraft";
import { runPlannerConversionForCurrentUser, getLastPlannerConversionRun } from "@/lib/plannerConversion";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

interface AutomationDraft {
  autoConvertFutureIncomeToLedger: boolean;
}

export function ForecastingAutomationSection({ bare = false }: { bare?: boolean } = {}) {
  const { data, isLoading } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const qc = useQueryClient();
  const [savedTick, setSavedTick] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState(() => getLastPlannerConversionRun());
  useEffect(() => {
    if (!running) setLastRun(getLastPlannerConversionRun());
  }, [running]);

  const source: AutomationDraft = useMemo(
    () => ({
      autoConvertFutureIncomeToLedger: !!data?.autoConvertFutureIncomeToLedger,
    }),
    [data?.autoConvertFutureIncomeToLedger],
  );

  const draft = useSectionDraft<AutomationDraft>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      await updateMutation.mutateAsync({ id: data.id, ...next });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  const isOn = draft.draft.autoConvertFutureIncomeToLedger;

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const result = await runPlannerConversionForCurrentUser();
      if (result.converted > 0) {
        toast.success(
          `${result.converted} ${result.converted === 1 ? "paycheck" : "paychecks"} converted to ledger drafts`,
        );
      } else if (result.duplicateSkipped > 0) {
        toast.info(`${result.duplicateSkipped} skipped as likely duplicates`);
      } else if (result.alreadyConverted > 0) {
        toast.info("Nothing new to convert — everything is already up to date");
      } else {
        toast.info("No eligible planned income to convert right now");
      }
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["personal_income_entries"] });
      qc.invalidateQueries({ queryKey: ["income_entries"] });
    } catch (e) {
      toast.error((e as Error).message || "Conversion failed");
    } finally {
      setRunning(false);
    }
  };

  // Empty state — match the "no settings yet" pattern from sibling sections.
  if (!isLoading && !data) {
    return (
      <SectionCard
        bare={bare}
        title="Forecasting Automation"
        description="Control how planned future income flows into your real ledger."
      >
        <p className="text-xs text-muted-foreground">
          Save your tax profile first to enable forecasting automation.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      bare={bare}
      title="Forecasting Automation"
      description="Control how planned future income flows into your real ledger."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <div className="grid grid-cols-1 gap-4">
        <div>
          <Label className="text-xs text-muted-foreground mb-1.5 block">
            Auto-convert future income to ledger
          </Label>
          <div className="flex items-start justify-between gap-4">
            <p className="text-xs text-muted-foreground leading-relaxed flex-1">
              When enabled, planned income automatically creates a real ledger
              transaction draft on its scheduled date and is marked Needs Review.
              When disabled, future income stays in forecasting only.
            </p>
            <Switch
              checked={isOn}
              onCheckedChange={(v) => draft.patch({ autoConvertFutureIncomeToLedger: v })}
              aria-label="Toggle auto-convert future income"
            />
          </div>
        </div>

        {isOn && (
          <div>
            <Label className="text-xs text-muted-foreground mb-1.5 block">
              Manual conversion
            </Label>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground flex-1">
                Conversion runs daily and on app load. Run it now to catch up immediately.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRunNow}
                disabled={running}
              >
                {running ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Running…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1.5" />
                    Run now
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
