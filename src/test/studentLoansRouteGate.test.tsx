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
  useUpdateTaxSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
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

  it("keeps an entitled developer on the planner when the preference is off", () => {
    state.status = "allowed";
    state.estimatorEnabled = false;
    renderPage();
    expect(screen.queryByText("settings-page")).toBeNull();
    expect(screen.queryByText("dashboard-page")).toBeNull();
    // Renders a usable setup/enable state, not a blank page.
    expect(screen.getByTestId("student-loans-setup")).toBeTruthy();
    expect(screen.getByText("Student Loan Estimator")).toBeTruthy();
  });

  it("renders the planner without the setup prompt when the preference is on", () => {
    state.status = "allowed";
    state.estimatorEnabled = true;
    renderPage();
    expect(screen.queryByTestId("student-loans-setup")).toBeNull();
    expect(screen.getByText("Student Loan Estimator")).toBeTruthy();
  });

  it("keeps hook order stable across pending → allowed and OFF ↔ ON re-renders", () => {
    const errors: unknown[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => errors.push(a));
    state.status = "pending";
    const { rerender } = renderPage();
    const view = (
      <MemoryRouter initialEntries={["/student-loans"]}>
        <Routes>
          <Route path="/student-loans" element={<StudentLoans />} />
          <Route path="/" element={<div>dashboard-page</div>} />
        </Routes>
      </MemoryRouter>
    );
    state.status = "allowed";
    state.estimatorEnabled = false;
    rerender(view);
    state.estimatorEnabled = true;
    rerender(view);
    state.estimatorEnabled = false;
    rerender(view);
    spy.mockRestore();
    const joined = JSON.stringify(errors);
    expect(joined).not.toMatch(/Rendered more hooks|Rendered fewer hooks|order of Hooks|#310/);
  });
});
