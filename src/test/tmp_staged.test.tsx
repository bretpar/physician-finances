import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
vi.mock("@/hooks/useTaxSettings", () => ({ useTaxSettings: () => ({ data: undefined, isLoading: false }) }));
vi.mock("@/hooks/useAccountRole", () => ({ useAccountRole: () => ({ role: "developer", isLoading: false, canAccessPremium: true, canAccessBeta: true, isDeveloper: true, canAccessFree: true, userEmail: null }) }));
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
describe("dev staged", () => {
  it("grants", () => {
    const { result } = renderHook(() => useFeatureAccess());
    expect(result.current.can("studentLoanPlanner")).toBe(true);
  });
});
