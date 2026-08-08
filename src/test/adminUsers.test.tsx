import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { filterAdminUsers, type AdminUserRow } from "@/hooks/useAdminUsers";

const rpc = vi.fn();
const invokeFn = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invokeFn(...args) },
  },
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

describe("admin features tab", () => {
  beforeEach(() => {
    mockRole = "developer";
    rpc.mockResolvedValue({ data: users, error: null });
  });

  it("renders the read-only feature registry for developers", async () => {
    const { default: FeaturesPanel } = await import("@/pages/admin/FeaturesPanel");
    render(<FeaturesPanel />);
    expect((await screen.findAllByText("Mileage Deduction")).length).toBeGreaterThan(0);
    expect(screen.getByText(/Feature registry \(/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });

  it("keeps the Features tab behind developer protection", async () => {
    mockRole = "premium_beta";
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <Admin />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.queryByText("Features")).toBeNull());
  });
});

describe("admin bulk selection and delete", () => {
  beforeEach(() => {
    mockRole = "developer";
    rpc.mockResolvedValue({ data: users, error: null });
    invokeFn.mockReset();
  });

  it("selects a user, shows the count, and requires typing DELETE", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText("premium@example.com").length).toBeGreaterThan(0));

    await user.click(screen.getAllByLabelText("Select premium@example.com")[0]);
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 user selected");

    await user.click(screen.getByRole("button", { name: /delete selected users/i }));
    const confirmBtn = screen.getByRole("button", { name: /delete permanently/i });
    expect(confirmBtn).toBeDisabled();

    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");
    expect(confirmBtn).toBeEnabled();

    invokeFn.mockResolvedValue({ data: { ok: true, deleted: ["u-2"], skipped: [], failed: [], orphaned_tables: [] }, error: null });
    await user.click(confirmBtn);
    await waitFor(() =>
      expect(invokeFn).toHaveBeenCalledWith("admin-delete-users", { body: { user_ids: ["u-2"] } }),
    );
  });

  it("lists failures inline and keeps successful deletions applied", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAdmin();
    await waitFor(() => expect(screen.getAllByText("premium@example.com").length).toBeGreaterThan(0));

    await user.click(screen.getAllByLabelText("Select premium@example.com")[0]);
    await user.click(screen.getAllByLabelText("Select dev@paycheckmd.com")[0]);
    await user.click(screen.getByRole("button", { name: /delete selected users/i }));
    await user.type(screen.getByLabelText(/type delete to confirm/i), "DELETE");

    invokeFn.mockResolvedValue({
      data: {
        ok: true,
        deleted: ["u-2"],
        skipped: [{ user_id: "dev-1", reason: "cannot delete yourself" }],
        failed: [{ user_id: "u-2", error: "auth delete failed" }],
        orphaned_tables: [],
      },
      error: null,
    });
    await user.click(screen.getByRole("button", { name: /delete permanently/i }));

    const panel = await screen.findByTestId("bulk-delete-issues");
    expect(panel).toHaveTextContent("2 of the selected accounts could not be deleted");
    expect(screen.getByTestId("bulk-delete-failed-row")).toHaveTextContent("auth delete failed");
    expect(screen.getByTestId("bulk-delete-skipped-row")).toHaveTextContent("cannot delete yourself");
    // Successful deletion is applied: u-2 is no longer selected, dev-1 remains.
    expect(screen.getByTestId("selection-count")).toHaveTextContent("1 user selected");

    await user.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(screen.queryByTestId("bulk-delete-issues")).toBeNull();
  });



  it("hides bulk delete controls from non-developers", async () => {
    mockRole = "premium";
    renderAdmin();
    await waitFor(() => expect(screen.queryByRole("button", { name: /delete selected users/i })).toBeNull());
    expect(invokeFn).not.toHaveBeenCalled();
  });
});
