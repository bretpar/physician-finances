import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RetirementRoomSummary } from "@/components/retirement/RetirementRoomSummary";
import { SimpleTaxReminderModal } from "@/components/SimpleTaxReminderModal";
import { buildInsights, filterInsightsByAccess, INSIGHT_FEATURE_KEYS } from "@/lib/insights";
import { resolveRequiredAccess } from "@/lib/featureRegistry";

const employeeRoom = {
  employeeContributionTotal: 1000,
  employeeDeferralLimit: 24500,
  employeeRemainingRoom: 23500,
  employeeUsedFraction: 1000 / 24500,
};

const plans = [
  {
    companyId: "c1",
    companyName: "Acme Health",
    planType: "w2",
    employeeContribution: 1000,
    employerContribution: 500,
    planContributionTotal: 1500,
    planCurrentCapacity: 20000,
    planProjectedCapacity: 40000,
  },
];

const renderRoom = (access: { capacity: boolean; planner: boolean; employer: boolean }) =>
  render(
    <RetirementRoomSummary
      taxYear={2026}
      employeeRoom={employeeRoom as never}
      employerContributionTotal={500}
      plans={plans as never}
      hasPlannerAccess={access.planner}
      hasEmployerOpportunityAccess={access.employer}
      hasCapacityAccess={access.capacity}
    />,
  );

describe("Retirement premium intelligence gating", () => {
  it("keeps basic contribution tracking available for a Free user", () => {
    renderRoom({ capacity: false, planner: false, employer: false });
    expect(screen.getByTestId("retirement-room-summary")).toBeTruthy();
    expect(screen.getByTestId("employee-room").textContent).toContain("$1,000");
    expect(screen.getByTestId("employee-room").textContent).toContain("$24,500");
    expect(screen.getByTestId("plan-capacity-card").textContent).toContain("$500");
  });

  it("gates projected capacity, remaining room and employer opportunity for a Free user", () => {
    renderRoom({ capacity: false, planner: false, employer: false });
    expect(screen.queryByTestId("employee-remaining-room")).toBeNull();
    expect(screen.getByTestId("employee-remaining-room-locked")).toBeTruthy();
    expect(screen.queryByTestId("plan-capacity-row")).toBeNull();
    expect(screen.queryByTestId("projected-opportunity")).toBeNull();
    expect(screen.queryByText("Projected year end")).toBeNull();
  });

  it("gates Income Planner-derived capacity even if planner access is granted alone", () => {
    renderRoom({ capacity: false, planner: true, employer: true });
    expect(screen.queryByText("Projected year end")).toBeNull();
    expect(screen.queryByTestId("projected-opportunity")).toBeNull();
  });

  it("keeps full functionality for a Premium user", () => {
    renderRoom({ capacity: true, planner: true, employer: true });
    expect(screen.getByTestId("employee-remaining-room")).toBeTruthy();
    expect(screen.getByTestId("plan-capacity-row")).toBeTruthy();
    expect(screen.getByTestId("projected-opportunity")).toBeTruthy();
  });

  it("keeps the retirement premium keys Premium in the registry", () => {
    expect(resolveRequiredAccess("projectedContributionCapacity", {})).toBe("premium");
    expect(resolveRequiredAccess("employerContributionOpportunity", {})).toBe("premium");
    expect(resolveRequiredAccess("advancedWithholdingGuide", {})).toBe("premium");
  });
});

describe("advanced reserve recommendation gating", () => {
  it("renders the exact recommendation and action only when open", () => {
    const { rerender } = render(
      <SimpleTaxReminderModal
        open={false}
        onClose={() => {}}
        onApply={() => {}}
        recommendedSavings={706.5}
        actualSaved={0}
        entryTitle="1099 payment"
      />,
    );
    // Free user: the gate passes open={false}, so nothing renders.
    expect(screen.queryByText("Stay on pace with taxes")).toBeNull();
    expect(screen.queryByText(/Add \$706\.50 to reserve/)).toBeNull();

    rerender(
      <SimpleTaxReminderModal
        open
        onClose={() => {}}
        onApply={() => {}}
        recommendedSavings={706.5}
        actualSaved={0}
        entryTitle="1099 payment"
      />,
    );
    // Premium user: unchanged behavior and unchanged math.
    expect(screen.getByText("Stay on pace with taxes")).toBeTruthy();
    expect(screen.getByText(/Add \$706\.50 to reserve/)).toBeTruthy();
  });
});

describe("insight entitlement mapping", () => {
  const input = {
    isReady: true,
    projectedAnnualIncome: 300000,
    annualTaxLiability: 80000,
    savingsCoverageRatio: 0.5,
    stillNeedToSave: 5000,
    quarterLabel: "Q3",
    deadlineLabel: "September 15",
    daysUntilDue: 10,
    showQuarterly: true,
    hasRetirement: false,
    hasHsa: false,
    hasHomeOffice: false,
    hasMileage: false,
    hasStudentLoanInterest: false,
    incomeChange: 0,
  };

  it("maps pace and deduction recommendations to existing premium keys", () => {
    expect(INSIGHT_FEATURE_KEYS["tax-savings-behind"]).toBe("quarterlySavingsPace");
    expect(INSIGHT_FEATURE_KEYS.retirement).toBe("taxSavingsOpportunities");
    expect(INSIGHT_FEATURE_KEYS["quarterly-due-soon"]).toBeUndefined();
    expect(resolveRequiredAccess("quarterlySavingsPace", {})).toBe("premium");
    expect(resolveRequiredAccess("taxSavingsOpportunities", {})).toBe("premium");
  });

  it("removes premium recommendation insights for a Free user but keeps notifications", () => {
    const all = buildInsights(input as never);
    const free = filterInsightsByAccess(all, () => false);
    expect(free.some((i) => i.id === "quarterly-due-soon")).toBe(true);
    expect(free.some((i) => i.id === "tax-savings-behind")).toBe(false);
    expect(free.some((i) => ["retirement", "hsa", "home-office", "mileage"].includes(i.id))).toBe(false);
  });

  it("leaves every insight for a Premium user", () => {
    const all = buildInsights(input as never);
    expect(filterInsightsByAccess(all, () => true)).toHaveLength(all.length);
  });
});
