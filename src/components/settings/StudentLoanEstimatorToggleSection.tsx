import { useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/settings/SectionCard";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import { useSectionDraft } from "@/hooks/useSectionDraft";
import { GraduationCap } from "lucide-react";

interface Draft {
  studentLoanEstimatorEnabled: boolean;
}

export function StudentLoanEstimatorToggleSection() {
  const { data } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const [savedTick, setSavedTick] = useState(false);

  const source: Draft = useMemo(
    () => ({ studentLoanEstimatorEnabled: !!data?.studentLoanEstimatorEnabled }),
    [data?.studentLoanEstimatorEnabled],
  );

  const draft = useSectionDraft<Draft>({
    source,
    onSave: async (next) => {
      if (!data?.id) throw new Error("Tax settings not loaded");
      await updateMutation.mutateAsync({ id: data.id, ...(next as any) });
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    },
  });

  return (
    <SectionCard
      title="Optional Tools"
      icon={<GraduationCap className="h-5 w-5" />}
      description="Enable additional planning tools that appear in the main navigation."
      isDirty={draft.isDirty}
      isSaving={draft.isSaving}
      justSaved={savedTick}
      onSave={draft.save}
      onCancel={draft.cancel}
    >
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">
          Student Loan Estimator
        </Label>
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs text-muted-foreground leading-relaxed flex-1">
            Adds a Student Loans tab that estimates monthly payments across
            federal repayment plans and can compare Married Filing Jointly
            vs Married Filing Separately for student loan strategy. Off by
            default.
          </p>
          <Switch
            checked={draft.draft.studentLoanEstimatorEnabled}
            onCheckedChange={(v) => draft.patch({ studentLoanEstimatorEnabled: v })}
            aria-label="Toggle Student Loan Estimator"
          />
        </div>
      </div>
    </SectionCard>
  );
}
