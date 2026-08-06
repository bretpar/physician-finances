import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { filterAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";

const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

let mockRole = "developer";
vi.mock("@/hooks/useAccountRole", () => ({
  useAccountRole: () => ({
    role: mockRole,
    isDeveloper: mockRole === "developer",
    canAccessPremium: mockRole !== "free",
    canAccessBeta: mockRole === "developer" || mockRole === "premium_beta",
    canAccessFree: true,
    isLoading: false,
    userEmail: "dev@paycheckmd.com",
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "dev-1", email: "dev@paycheckmd.com" } }),
}));

import Admin from "@/pages/admin/Admin";

const users = [
  {
    user_id: "dev-1",
    email: "dev@paycheckmd.com",
    display_name: "Dev One",
    account_role: "developer",
    created_at: "2026-01-01T00:00:00Z",
    last_sign_in_at: "2026-08-01T00:00:00Z",
  },
  {
    user_id: "u-2",
    email: "premium@example.com",
    display_name: null,
    account_role: "premium",
    created_at: "2026-02-01T00:00:00Z",
    last_sign_in_at: null,
  },
];

function renderAdmin() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Admin />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("admin users page", () => {
  beforeEach(() => {
    rpc.mockReset();
    mockRole = "developer";
  });

  it("renders the user list and role action for a developer", async () => {
    rpc.mockResolvedValue({ data: users, error: null });
    renderAdmin();

    await waitFor(() => expect(screen.getAllByText("premium@example.com").length).toBeGreaterThan(0));
    expect(screen.getAllByText("dev@paycheckmd.com").length).toBeGreaterThan(0);
    expect(rpc).toHaveBeenCalledWith("admin_list_users");
    expect(screen.getAllByLabelText(/Change role for/).length).toBeGreaterThan(0);
  });

  it("does not list users for a non-developer", async () => {
    mockRole = "premium";
    rpc.mockResolvedValue({ data: users, error: null });
    renderAdmin();

    await waitFor(() => expect(rpc).not.toHaveBeenCalled());
    expect(screen.queryAllByText("premium@example.com").length).toBe(0);
  });

  it("surfaces a server authorization error instead of user data", async () => {
    rpc.mockResolvedValue({ data: null, error: new Error("not authorized") });
    renderAdmin();
    await waitFor(() => expect(screen.getByText("not authorized")).toBeInTheDocument());
  });
});

describe("filterAdminUsers", () => {
  const rows: AdminUserRow[] = [
    { userId: "1", email: "a@x.com", displayName: "Alice Smith", role: "free", createdAt: null, lastSignInAt: null },
    { userId: "2", email: "bob@y.com", displayName: null, role: "premium", createdAt: null, lastSignInAt: null },
  ];

  it("matches email and display name case-insensitively", () => {
    expect(filterAdminUsers(rows, "ALICE").map((r) => r.userId)).toEqual(["1"]);
    expect(filterAdminUsers(rows, "bob@").map((r) => r.userId)).toEqual(["2"]);
    expect(filterAdminUsers(rows, "  ").length).toBe(2);
    expect(filterAdminUsers(rows, "zzz").length).toBe(0);
  });
});
