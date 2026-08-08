import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RetirementRoomSummary } from "@/components/retirement/RetirementRoomSummary";
import {
  computeEmployeeContributionRoom,
  computePlanCapacities,
} from "@/lib/retirementContributionRoom";

const plans = computePlanCapacities(2026, [
  {
    companyId: "a",
    companyName: "Independent Consulting",
    planType: "1099_schedule_c",
    eligibleCompensationYtd: 30_000,
    projectedEligibleCompensation: 45_000,
    employeeContribution: 5_000,
    employerContribution: 8_000,
  },
  {
    companyId: "b",
    companyName: "Unknown Comp Co",
    planType: "w2",
    eligibleCompensationYtd: null,
    employeeContribution: 7_500,
    employerContribution: 0,
  },
]);

const employeeRoom = computeEmployeeContributionRoom({
  taxYear: 2026,
  employeeContributions: [5_000, 7_500],
});

const setup = (hasPlannerAccess: boolean, room = employeeRoom) =>
  render(
    <RetirementRoomSummary
      taxYear={2026}
      employeeRoom={room}
      employerContributionTotal={8_000}
      plans={plans}
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

  it("toggling basis only changes capacity values, not the employee total", () => {
    setup(true);
    expect(screen.getAllByText("Current available capacity")).toHaveLength(2);
    fireEvent.click(screen.getByText("Projected year end"));
    expect(screen.getAllByText("Projected year-end capacity")).toHaveLength(2);
    expect(screen.getByText(/\$12,500/)).toBeInTheDocument();
  });

  it("shows the projected opportunity insight once", () => {
    setup(true);
    expect(screen.getAllByTestId("projected-opportunity")).toHaveLength(1);
  });

  it("hides projected values without Income Planner access", () => {
    setup(false);
    expect(screen.queryByText("Projected year end")).toBeNull();
    expect(screen.queryByTestId("projected-opportunity")).toBeNull();
    expect(screen.getAllByText("Current available capacity")).toHaveLength(2);
    expect(screen.getByText(/Income Planner\./)).toBeInTheDocument();
  });

  it("shows an unavailable state instead of a fabricated capacity", () => {
    setup(true);
    expect(screen.getByText("Contribution capacity unavailable")).toBeInTheDocument();
    expect(screen.getByText(/More plan or compensation information/)).toBeInTheDocument();
  });

  it("clamps remaining room at $0 and shows a subtle over-limit note", () => {
    const over = computeEmployeeContributionRoom({
      taxYear: 2026,
      employeeContributions: [30_000],
    });
    setup(true, over);
    expect(screen.getByTestId("employee-room").textContent).toContain("$0 remaining");
    expect(screen.getByTestId("employee-over-limit").textContent).toContain("$5,500");
  });
});
