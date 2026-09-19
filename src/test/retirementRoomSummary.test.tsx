import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RetirementRoomSummary } from "@/components/retirement/RetirementRoomSummary";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";

const room = computeRetirementRoomView({
  taxYear: 2026,
  age: 45,
  filingStatus: "single",
  magi: 85_000,
  eligibleTaxableCompensation: 200_000,
  coveredByWorkplacePlan: true,
  companies: [
    { id: "a", name: "Independent Consulting", companyType: "1099_schedule_c" },
    { id: "b", name: "Unknown Comp Co", companyType: "w2" },
  ],
  paychecks: [{ incomeEntryId: "pay", companyId: "b", employee: 7_500, employer: 0, wages: 100_000 }],
  standalone: [
    { id: "solo", companyId: "a", accountType: "solo_401k", contributionType: "employee", annualAmount: 5_000 },
    { id: "employer", companyId: "a", accountType: "solo_401k", contributionType: "employer", annualAmount: 8_000 },
  ],
  ira: { traditionalContributed: 1_000, rothContributed: 500 },
  actualNetProfitByCompany: new Map([["a", 50_000]]),
  remainingPlannedGrossByCompany: new Map([["a", 20_000]]),
});

const setup = (hasPlannerAccess: boolean) =>
  render(
    <RetirementRoomSummary
      room={room}
      hasPlannerAccess={hasPlannerAccess}
    />,
  );

describe("RetirementRoomSummary UI", () => {
  it("shows the validated employee aggregate and remaining room", () => {
    setup(true);
    expect(screen.getByText(/\$12,500/)).toBeInTheDocument();
    expect(screen.getByText(/of \$24,500/)).toBeInTheDocument();
    expect(screen.getByText(/\$12,000/)).toBeInTheDocument();
  });

  it("uses projected employer opportunity by default when available", () => {
    setup(true);
    expect(screen.getByText("Based on projected 2026 income")).toBeInTheDocument();
  });

  it("shows unknown employer capacity without inventing a dollar amount", () => {
    setup(true);
    expect(screen.getByText("Additional employer contribution depends on your employer's plan.")).toBeInTheDocument();
    expect(screen.getByText(/Additional employer opportunity may be available for 1 plan/)).toBeInTheDocument();
  });

  it("falls back to current employer opportunity without Planner access", () => {
    setup(false);
    expect(screen.queryByText("Based on projected 2026 income")).toBeNull();
  });

  it("distinguishes Traditional IRA contributed and deductible amounts", () => {
    setup(true);
    expect(screen.getByText("$1,000 contributed")).toBeInTheDocument();
    expect(screen.getByText("$600")).toBeInTheDocument();
  });

  it("reveals canonical reason explanations without raw codes", () => {
    setup(true);
    fireEvent.click(screen.getByLabelText("Show Unknown Comp Co details"));
    expect(screen.getByText("More plan information is needed to calculate this opportunity.")).toBeInTheDocument();
    expect(screen.queryByText("unknown_plan_data")).toBeNull();
  });
});
