import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const auth = { user: null as null | { id: string }, loading: false };
const role = { isDeveloper: false, isResolved: true };
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useAccountRole", () => ({ useAccountRole: () => role }));
vi.mock("@/pages/admin/TaxValidation", () => ({ default: () => <div>TAX_DIAG</div> }));
vi.mock("@/pages/admin/StudentLoanValidation", () => ({ default: () => <div>SL_DIAG</div> }));

import { DeveloperRoute } from "@/components/auth/DeveloperRoute";
import TaxValidation from "@/pages/admin/TaxValidation";
import StudentLoanValidation from "@/pages/admin/StudentLoanValidation";
import Privacy from "@/pages/Privacy";
import Terms from "@/pages/Terms";

const ROUTES = [
  ["/admin/tax-validation", <TaxValidation />, "TAX_DIAG"],
  ["/admin/student-loan-validation", <StudentLoanValidation />, "SL_DIAG"],
] as const;

function renderAt(path: string, el: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<DeveloperRoute>{el}</DeveloperRoute>} />
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/" element={<div>HOME</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  auth.user = null; auth.loading = false; role.isDeveloper = false; role.isResolved = true;
  localStorage.clear();
});

describe.each(ROUTES)("%s authorization", (path, el, marker) => {
  it("signed-out visitor is sent to sign-in", () => {
    renderAt(path, el);
    expect(screen.getByText("LOGIN")).toBeTruthy();
    expect(screen.queryByText(marker)).toBeNull();
  });
  it("ordinary user is redirected home, even with diagnostics localStorage flags set", () => {
    auth.user = { id: "u1" };
    localStorage.setItem("debug:taxEngine", "1");
    localStorage.setItem("debug:studentLoan", "1");
    renderAt(path, el);
    expect(screen.getByText("HOME")).toBeTruthy();
    expect(screen.queryByText(marker)).toBeNull();
  });
  it("shows nothing while the role is still resolving", () => {
    auth.user = { id: "u1" }; role.isDeveloper = true; role.isResolved = false;
    renderAt(path, el);
    expect(screen.queryByText(marker)).toBeNull();
  });
  it("developer may load the page", () => {
    auth.user = { id: "d1" }; role.isDeveloper = true;
    renderAt(path, el);
    expect(screen.getByText(marker)).toBeTruthy();
  });
});

describe("public legal pages", () => {
  it.each([["/privacy", <Privacy />, "Privacy Policy"], ["/terms", <Terms />, "Terms of Use"]] as const)(
    "%s renders signed out with Privacy/Terms links",
    (path, el, heading) => {
      render(<MemoryRouter initialEntries={[path]}>{el}</MemoryRouter>);
      expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Privacy" }).getAttribute("href")).toBe("/privacy");
      expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
    },
  );
});
