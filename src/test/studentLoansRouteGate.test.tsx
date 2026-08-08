import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import type { StagedAccessStatus } from "@/hooks/useFeatureAccess";

const state: { status: StagedAccessStatus; estimatorEnabled: boolean } = {
  status: "pending",
  estimatorEnabled: true,
};

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({
    data: { id: "s1", studentLoanEstimatorEnabled: state.estimatorEnabled, filingStatus: "single" },
    isLoading: false,
  }),
}));
vi.mock("@/hooks/useStudentLoans", () => ({
  useStudentLoans: () => ({ data: [], isLoading: false }),
  useUpsertStudentLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteStudentLoan: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useTaxEstimate", () => ({ useTaxEstimate: () => ({ forecastEstimate: null }) }));
vi.mock("@/hooks/useFeatureAccess", () => ({
  useFeatureAccess: () => ({
    accessStatus: () => state.status,
    can: () => state.status === "allowed",
    isRoleResolved: state.status !== "pending",
    isLoading: state.status === "pending",
  }),
}));

import StudentLoans from "@/pages/StudentLoans";

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/student-loans"]}>
      <Routes>
        <Route path="/student-loans" element={<StudentLoans />} />
        <Route path="/" element={<div>dashboard-page</div>} />
        <Route path="/settings" element={<div>settings-page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("/student-loans staged-release route guard", () => {
  beforeEach(() => {
    state.status = "pending";
    state.estimatorEnabled = true;
  });

  it("shows loading instead of redirecting while the role is unresolved", () => {
    renderPage();
    expect(screen.getByTestId("student-loans-loading")).toBeTruthy();
    expect(screen.queryByText("settings-page")).toBeNull();
    expect(screen.queryByText("dashboard-page")).toBeNull();
  });

  it("stays accessible once the role resolves to developer", () => {
    state.status = "allowed";
    renderPage();
    expect(screen.queryByTestId("student-loans-loading")).toBeNull();
    expect(screen.queryByText("dashboard-page")).toBeNull();
    expect(screen.queryByText("settings-page")).toBeNull();
  });

  it("redirects when the role resolves to a denied role", () => {
    state.status = "denied";
    renderPage();
    expect(screen.getByText("dashboard-page")).toBeTruthy();
  });

  it("redirects to settings only after access is allowed but the toggle is off", () => {
    state.status = "allowed";
    state.estimatorEnabled = false;
    renderPage();
    expect(screen.getByText("settings-page")).toBeTruthy();
  });
});
