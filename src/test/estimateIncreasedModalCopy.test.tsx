import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SimpleTaxReminderModal } from "@/components/SimpleTaxReminderModal";
import { computeCatchUpRecommendation } from "@/lib/catchUpRecommendation";

describe("estimate-increased modal copy", () => {
  it("compliant prior history + new 1099 event → estimate-increase copy", () => {
    // Prior quarter target fully satisfied, then a $10k 1099 event raises it.
    const priorTarget = 3000;
    const newEventTarget = 2305;
    const r = computeCatchUpRecommendation({
      quarterTarget: priorTarget + newEventTarget,
      coveredSoFar: priorTarget,
      remainingOpportunities: 3,
      baselineQuarterTarget: priorTarget,
    });
    expect(r.recommendationStatus).toBe("estimate_increased");

    render(
      <SimpleTaxReminderModal
        open
        onClose={() => {}}
        onApply={() => {}}
        recommendedSavings={newEventTarget}
        actualSaved={0}
        entryTitle="1099 Consulting"
        coverageStatus={r.recommendationStatus}
      />,
    );
    expect(screen.getByText(/On plan — estimate increased/)).toBeInTheDocument();
  });

  it("genuinely unsatisfied prior history → generic catch-up copy", () => {
    const r = computeCatchUpRecommendation({
      quarterTarget: 5305,
      coveredSoFar: 500,
      remainingOpportunities: 3,
      baselineQuarterTarget: 0,
    });
    expect(r.recommendationStatus).toBe("catch_up_needed");

    render(
      <SimpleTaxReminderModal
        open
        onClose={() => {}}
        onApply={() => {}}
        recommendedSavings={2305}
        actualSaved={0}
        entryTitle="1099 Consulting"
        coverageStatus={r.recommendationStatus}
      />,
    );
    expect(screen.getByText(/Stay on pace with taxes/)).toBeInTheDocument();
  });
});
