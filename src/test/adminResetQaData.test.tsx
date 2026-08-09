import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const rpc = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
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
    isResolved: true,
    resolvedRole: mockRole,
    userEmail: "dev@example.com",
  }),
}));


vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "dev-id" } }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toastSpy(...a) }));

import Admin from "@/pages/admin/Admin";

const TARGET_ID = "11111111-2222-3333-4444-555555555555";

const renderAdmin = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Admin />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  invoke.mockReset();
  rpc.mockReset();
  toastSpy.mockReset();
  rpc.mockResolvedValue({
    data: [
      {
        user_id: TARGET_ID,
        email: "qa+dev@example.com",
        display_name: "QA Dev",
        account_role: "developer",
        created_at: "2026-01-01T00:00:00Z",
        last_sign_in_at: "2026-02-01T00:00:00Z",
      },
    ],
    error: null,
  });
});

describe("Admin → Reset QA Data", () => {
  it("requires typing RESET before the reset button is enabled", async () => {
    renderAdmin();
    const buttons = await screen.findAllByTestId("reset-qa-data-button");
    fireEvent.click(buttons[0]);

    const confirmBtn = await screen.findByTestId("reset-qa-confirm-button");
    expect(confirmBtn).toBeDisabled();
    expect(screen.getByTestId("reset-qa-dialog").textContent).toContain("qa+dev@example.com");

    fireEvent.change(screen.getByTestId("reset-qa-confirm-input"), { target: { value: "reset" } });
    expect(screen.getByTestId("reset-qa-confirm-button")).toBeDisabled();

    fireEvent.change(screen.getByTestId("reset-qa-confirm-input"), { target: { value: "RESET" } });
    expect(screen.getByTestId("reset-qa-confirm-button")).not.toBeDisabled();
  });

  it("calls the dedicated reset endpoint — never the account delete endpoint", async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        user_id: TARGET_ID,
        email: "qa+dev@example.com",
        auth_account_preserved: true,
        roles_preserved: ["developer"],
        deleted_by_table: { companies: 2, transactions: 5 },
        total_rows_deleted: 7,
        attachments_removed: 0,
        settings_reset: true,
        onboarding_reset: true,
        failed_tables: [],
        preserved: ["auth.users", "user_roles"],
      },
      error: null,
    });

    renderAdmin();
    fireEvent.click((await screen.findAllByTestId("reset-qa-data-button"))[0]);
    fireEvent.change(screen.getByTestId("reset-qa-confirm-input"), { target: { value: "RESET" } });
    fireEvent.click(screen.getByTestId("reset-qa-confirm-button"));

    await waitFor(() => expect(invoke).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("admin-reset-user-data", {
      body: { user_id: TARGET_ID, confirm: "RESET" },
    });
    expect(invoke.mock.calls.some(([name]) => name === "admin-delete-users")).toBe(false);

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const description = String(toastSpy.mock.calls.at(-1)?.[0]?.description ?? "");
    expect(description).toContain("Login and Developer access preserved");
    expect(description).toContain("onboarding reset");
  });

  it("surfaces a failure without clearing the dialog state silently", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Forbidden") });

    renderAdmin();
    fireEvent.click((await screen.findAllByTestId("reset-qa-data-button"))[0]);
    fireEvent.change(screen.getByTestId("reset-qa-confirm-input"), { target: { value: "RESET" } });
    fireEvent.click(screen.getByTestId("reset-qa-confirm-button"));

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    expect(toastSpy.mock.calls.at(-1)?.[0]?.title).toBe("Reset failed");
  });
});
