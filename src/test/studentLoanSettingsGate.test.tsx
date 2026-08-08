import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const accessState = { allowed: true };

vi.mock("@/hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({
    can: (key: string) => key === "studentLoanPlanner" && accessState.allowed,
  }),
}));
vi.mock("@/components/settings/StudentLoanEstimatorToggleSection", () => ({
  StudentLoanEstimatorToggleSection: () => <div>Student Loan Estimator</div>,
}));

import { StudentLoanSettingsGate } from "@/components/settings/StudentLoanSettingsGate";

describe("Student Loan Settings entitlement gate", () => {
  it("shows the Settings control for an entitled developer regardless of preference state", () => {
    accessState.allowed = true;
    render(<StudentLoanSettingsGate />);
    expect(screen.getByText("Student Loan Estimator")).toBeTruthy();
  });

  it("hides the Settings control for a denied role", () => {
    accessState.allowed = false;
    render(<StudentLoanSettingsGate />);
    expect(screen.queryByText("Student Loan Estimator")).toBeNull();
  });
});