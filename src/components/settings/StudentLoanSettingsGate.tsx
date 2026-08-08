import { Separator } from "@/components/ui/separator";
import { StudentLoanEstimatorToggleSection } from "@/components/settings/StudentLoanEstimatorToggleSection";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

/** Entitlement-only gate. The estimator preference belongs inside the section. */
export function StudentLoanSettingsGate() {
  const { can } = useFeatureAccess();
  if (!can("studentLoanPlanner")) return null;

  return (
    <>
      <Separator className="my-2" />
      <StudentLoanEstimatorToggleSection bare />
    </>
  );
}