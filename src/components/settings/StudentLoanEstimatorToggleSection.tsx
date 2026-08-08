import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { SectionCard } from "@/components/settings/SectionCard";
import { useTaxSettings, useUpdateTaxSettings } from "@/hooks/useTaxSettings";
import { GraduationCap } from "lucide-react";

/**
 * Enable/disable the Student Loan Estimator (a USER PREFERENCE — never an
 * access gate; the release entitlement is `studentLoanPlanner`).
 *
 * The switch is write-through: flipping it persists immediately to the
 * canonical `tax_settings.student_loan_estimator_enabled` column. The previous
 * draft-based version only mutated local state until an explicit Save press,
 * so the toggle looked ON but never reached the server and reverted to OFF on
 * the next sign-in.
 */
export function StudentLoanEstimatorToggleSection({ bare = false }: { bare?: boolean } = {}) {
  const { data, isLoading } = useTaxSettings();
  const updateMutation = useUpdateTaxSettings();
  const [savedTick, setSavedTick] = useState(false);
  // Optimistic value shown only while the write is in flight; cleared on
  // settle so the UI always falls back to the server-loaded truth.
  const [pending, setPending] = useState<boolean | null>(null);

  const serverValue = !!data?.studentLoanEstimatorEnabled;
  const checked = pending ?? serverValue;

  const handleChange = async (next: boolean) => {
    if (!data?.id) return;
    setPending(next);
    try {
      await updateMutation.mutateAsync({ id: data.id, studentLoanEstimatorEnabled: next } as any);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 2000);
    } catch {
      // useUpdateTaxSettings surfaces the error toast; never claim success.
    } finally {
      setPending(null);
    }
  };

  if (!isLoading && !data) {
    return (
      <SectionCard bare={bare} title="Student Loan Estimator" icon={<GraduationCap className="h-5 w-5" />}>
        <p className="text-xs text-muted-foreground">
          Save your tax profile first to enable the Student Loan Estimator.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      bare={bare}
      title="Student Loan Estimator"
      icon={<GraduationCap className="h-5 w-5" />}
      description="Optional tool for estimating federal student loan payments and comparing filing status."
      isSaving={updateMutation.isPending}
      justSaved={savedTick}
    >
      <div>
        <Label className="text-xs text-muted-foreground mb-1.5 block">
          Enable Student Loan Estimator
        </Label>
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs text-muted-foreground leading-relaxed flex-1">
            Adds a Student Loans tab that estimates monthly payments across
            federal repayment plans (Standard, Graduated, PAYE, IBR, ICR, SAVE)
            and can compare Married Filing Jointly vs Married Filing Separately
            for student loan strategy. Off by default.
          </p>
          <Switch
            checked={checked}
            disabled={updateMutation.isPending || !data?.id}
            onCheckedChange={handleChange}
            aria-label="Toggle Student Loan Estimator"
            data-testid="student-loan-estimator-switch"
          />
        </div>
      </div>
    </SectionCard>
  );
}
