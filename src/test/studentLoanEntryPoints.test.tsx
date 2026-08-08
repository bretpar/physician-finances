import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const accessState = { allowed: true };
const settingsState = { studentLoanEstimatorEnabled: false };

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    organizationName: "QA",
    user: { email: "developer@example.com" },
    signOut: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAccountRole", () => ({
  useAccountRole: () => ({ isDeveloper: true }),
}));
vi.mock("@/hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({
    can: (key: string) => key === "studentLoanPlanner" && accessState.allowed,
    featureAccess: {},
  }),
}));
vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: settingsState }),
}));
vi.mock("@/hooks/usePlannerConversion", () => ({ usePlannerConversionFallback: vi.fn() }));
vi.mock("@/components/insights/InsightsBell", () => ({ default: () => null }));
vi.mock("@/components/BrandLogo", () => ({ BrandLogo: () => null }));

import AppLayout from "@/components/AppLayout";

describe("Student Loan Planner entry points", () => {
  beforeEach(() => {
    accessState.allowed = true;
    settingsState.studentLoanEstimatorEnabled = false;
  });

  it("shows the real AppLayout navigation entry for an entitled developer even when disabled", () => {
    render(
      <MemoryRouter>
        <AppLayout><div>content</div></AppLayout>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /Student Loans/i })).toHaveAttribute("href", "/student-loans");
  });

  it("hides the real AppLayout navigation entry for a denied role", () => {
    accessState.allowed = false;
    render(
      <MemoryRouter>
        <AppLayout><div>content</div></AppLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /Student Loans/i })).toBeNull();
  });
});