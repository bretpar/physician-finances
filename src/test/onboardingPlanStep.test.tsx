import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlanSelectionStep } from "@/components/onboarding/PlanSelectionStep";
import { PLAN_OPTIONS, isSelectablePlan, planRequiresCheckout } from "@/lib/planSelection";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

describe("onboarding plan selection", () => {
  beforeEach(() => rpc.mockReset());

  it("offers exactly Free and Premium — never premium_beta or developer", () => {
    expect(PLAN_OPTIONS.map((o) => o.plan)).toEqual(["free", "premium"]);
    expect(isSelectablePlan("premium_beta")).toBe(false);
    expect(isSelectablePlan("developer")).toBe(false);
  });

  it("renders both cards with the required copy and no pricing", () => {
    render(<PlanSelectionStep selected={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("onboarding-step-plan")).toBeInTheDocument();
    expect(screen.getByText("Track and understand")).toBeInTheDocument();
    expect(screen.getByText("Plan and optimize")).toBeInTheDocument();
    expect(screen.getByText("Best for planning")).toBeInTheDocument();
    expect(screen.getByText("Choose Free")).toBeInTheDocument();
    expect(screen.getByText("Choose Premium")).toBeInTheDocument();
    expect(screen.getByText("You can change your plan later in Settings.")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Premium Beta|Developer/)).not.toBeInTheDocument();
  });

  it("selects Free and Premium via a single tap on the whole card", async () => {
    const onSelect = vi.fn();
    render(<PlanSelectionStep selected={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId("onboarding-plan-option-free"));
    expect(onSelect).toHaveBeenCalledWith("free");
    await userEvent.click(screen.getByTestId("onboarding-plan-option-premium"));
    expect(onSelect).toHaveBeenCalledWith("premium");
  });

  it("marks the selected card so the user has a clear selected state", () => {
    render(<PlanSelectionStep selected="premium" onSelect={vi.fn()} />);
    expect(screen.getByTestId("onboarding-plan-option-premium")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("onboarding-plan-option-free")).toHaveAttribute("data-selected", "false");
  });

  it("stacks vertically on mobile and never forces a horizontal layout", () => {
    render(<PlanSelectionStep selected={null} onSelect={vi.fn()} />);
    const grid = screen.getByTestId("onboarding-plan-option-free").parentElement!;
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).not.toContain("overflow-x");
    expect(grid.className).not.toContain("flex-row");
    for (const plan of ["free", "premium"]) {
      expect(screen.getByTestId(`onboarding-plan-option-${plan}`).className).toContain("w-full");
    }
  });

  it("does not require checkout yet, but keeps the hook in place", () => {
    expect(planRequiresCheckout("premium")).toBe(false);
    expect(planRequiresCheckout("free")).toBe(false);
  });

  it("saves Free and Premium through the canonical select_my_plan RPC", async () => {
    const { useSelectPlan } = await import("@/hooks/useSelectPlan");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { renderHook, waitFor } = await import("@testing-library/react");
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    rpc.mockResolvedValue({ data: "free", error: null });
    const { result } = renderHook(() => useSelectPlan(), { wrapper });
    await result.current.mutateAsync("free");
    expect(rpc).toHaveBeenCalledWith("select_my_plan", { _plan: "free" });

    rpc.mockResolvedValue({ data: "premium", error: null });
    await result.current.mutateAsync("premium");
    expect(rpc).toHaveBeenLastCalledWith("select_my_plan", { _plan: "premium" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it("keeps an elevated role when the server refuses to downgrade it", async () => {
    const { useSelectPlan } = await import("@/hooks/useSelectPlan");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const { renderHook } = await import("@testing-library/react");
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    rpc.mockResolvedValue({ data: "developer", error: null });
    const { result } = renderHook(() => useSelectPlan(), { wrapper });
    await expect(result.current.mutateAsync("free")).resolves.toBe("developer");
  });
});
