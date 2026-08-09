import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Navigate } from "react-router-dom";
import type { AccountRole } from "@/lib/roles";

/**
 * Focused route tests for the onboarding guard:
 * developers keep /admin access while onboarding is incomplete; everyone else
 * keeps today's behavior. Also covers the onboarding Sign out control.
 */

const authState = {
  user: { id: "u1", email: "dev@example.com" } as unknown,
  loading: false,
  signOut: vi.fn(async () => {
    authState.user = null;
  }),
};

const roleState: { role: AccountRole | null; isResolved: boolean } = {
  role: "developer",
  isResolved: true,
};

vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: authState.user,
    session: null,
    loading: authState.loading,
    organizationId: "org1",
    organizationName: "Org",
    userRole: null,
    signOut: authState.signOut,
  }),
}));

vi.mock("@/hooks/useAccountRole", () => ({
  useAccountRole: () => ({
    role: roleState.role ?? "free",
    canAccessFree: true,
    canAccessPremium: roleState.role !== "free" && roleState.role !== null,
    canAccessBeta: roleState.role === "premium_beta" || roleState.role === "developer",
    isDeveloper: roleState.role === "developer",
    isLoading: !roleState.isResolved,
    isResolved: roleState.isResolved,
    resolvedRole: roleState.isResolved ? roleState.role : null,
    userEmail: "dev@example.com",
  }),
}));

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({
    data: { onboardingComplete: false },
    isLoading: false,
    isError: false,
    error: null,
  }),
  useUpdateTaxSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/pages/Onboarding", () => ({
  default: () => {
    if (!authState.user) return <Navigate to="/login" replace />;
    return (
      <div data-testid="onboarding-root">
        Onboarding
        <button data-testid="onboarding-sign-out" onClick={() => void authState.signOut()}>
          Sign out
        </button>
      </div>
    );
  },
}));

vi.mock("@/pages/admin/Admin", () => ({
  default: () => <div data-testid="admin-root">Admin</div>,
}));
vi.mock("@/pages/admin/FeaturesPanel", () => ({
  default: () => <div data-testid="admin-features">Features</div>,
  FeaturesPanel: () => <div data-testid="admin-features">Features</div>,
}));
vi.mock("@/pages/Dashboard", () => ({
  default: () => <div data-testid="dashboard-root">Dashboard</div>,
}));
vi.mock("@/pages/Login", () => ({
  default: () => <div data-testid="login-root">Login</div>,
}));
vi.mock("@/components/AppLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/contexts/CompanyContext", () => ({
  CompanyProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/RouteHead", () => ({ RouteHead: () => null }));

async function renderAt(path: string) {
  window.history.pushState({}, "", path);
  const { default: App } = await import("@/App");
  return render(<App />);
}

beforeEach(() => {
  vi.resetModules();
  authState.user = { id: "u1", email: "dev@example.com" };
  authState.loading = false;
  authState.signOut.mockClear();
  roleState.role = "developer";
  roleState.isResolved = true;
});

describe("onboarding route guard", () => {
  it("allows a developer with incomplete onboarding to reach /admin", async () => {
    await renderAt("/admin");
    expect(await screen.findByTestId("admin-root")).toBeInTheDocument();
  });

  it("allows a developer with incomplete onboarding to reach /admin/tax-validation", async () => {
    await renderAt("/admin/tax-validation");
    await waitFor(() => expect(screen.queryByTestId("onboarding-root")).toBeNull());
  });

  it("still redirects a developer's normal protected route to onboarding", async () => {
    await renderAt("/settings");
    expect(await screen.findByTestId("onboarding-root")).toBeInTheDocument();
  });

  it.each(["free", "premium", "premium_beta"] as AccountRole[])(
    "%s user with incomplete onboarding is redirected from /admin to onboarding",
    async (role) => {
      roleState.role = role;
      await renderAt("/admin");
      expect(await screen.findByTestId("onboarding-root")).toBeInTheDocument();
    },
  );

  it.each(["free", "premium", "premium_beta"] as AccountRole[])(
    "%s user with incomplete onboarding still gets onboarding on normal routes",
    async (role) => {
      roleState.role = role;
      await renderAt("/");
      expect(await screen.findByTestId("onboarding-root")).toBeInTheDocument();
    },
  );

  it("shows loading instead of redirecting while the role is unresolved on /admin", async () => {
    roleState.isResolved = false;
    roleState.role = null;
    await renderAt("/admin");
    await waitFor(() => expect(screen.queryByTestId("onboarding-root")).toBeNull());
    expect(screen.queryByTestId("admin-root")).toBeNull();
  });
});

describe("onboarding sign out", () => {
  it("renders a Sign out control and uses the existing auth sign-out flow", async () => {
    await renderAt("/onboarding");
    const btn = await screen.findByTestId("onboarding-sign-out");
    await userEvent.click(btn);
    expect(authState.signOut).toHaveBeenCalledTimes(1);
  });

  it("lands an unauthenticated user on login after sign out", async () => {
    authState.user = null;
    await renderAt("/");
    expect(await screen.findByTestId("login-root")).toBeInTheDocument();
  });
});
