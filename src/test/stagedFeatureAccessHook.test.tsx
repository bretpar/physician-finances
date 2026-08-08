import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { AccountRole } from "@/lib/roles";
import { getRoleAccess } from "@/lib/roles";

const roleState: { resolvedRole: AccountRole | null; isResolved: boolean } = {
  resolvedRole: "free",
  isResolved: true,
};

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: { householdIncomeStreams: undefined }, isLoading: false }),
}));

vi.mock("@/hooks/useAccountRole", () => ({
  useAccountRole: () => ({
    ...getRoleAccess(roleState.resolvedRole),
    resolvedRole: roleState.resolvedRole,
    isResolved: roleState.isResolved,
    isLoading: !roleState.isResolved,
    userEmail: null,
  }),
}));

import { useFeatureAccess } from "@/hooks/useFeatureAccess";

function access(role: AccountRole | null, isResolved = true) {
  roleState.resolvedRole = role;
  roleState.isResolved = isResolved;
  return renderHook(() => useFeatureAccess()).result.current;
}

describe("useFeatureAccess staged-release runtime path", () => {
  beforeEach(() => {
    roleState.resolvedRole = "free";
    roleState.isResolved = true;
  });

  it("grants studentLoanPlanner to a resolved developer", () => {
    const a = access("developer");
    expect(a.can("studentLoanPlanner")).toBe(true);
    expect(a.accessStatus("studentLoanPlanner")).toBe("allowed");
  });

  it("denies premium_beta, premium and free", () => {
    for (const role of ["premium_beta", "premium", "free"] as AccountRole[]) {
      const a = access(role);
      expect(a.can("studentLoanPlanner")).toBe(false);
      expect(a.accessStatus("studentLoanPlanner")).toBe("denied");
    }
  });

  it("stays pending (not granted, not denied) while the role is unresolved", () => {
    const a = access(null, false);
    expect(a.can("studentLoanPlanner")).toBe(false);
    expect(a.accessStatus("studentLoanPlanner")).toBe("pending");
    expect(a.isRoleResolved).toBe(false);
  });

  it("keeps legacy FREE/PREMIUM tier behavior unchanged", () => {
    const free = access("free");
    expect(free.subscriptionTier).toBe("FREE");
    expect(free.can("mileageDeduction")).toBe(false);
    expect(free.can("basicTaxOverview")).toBe(true);

    const premium = access("premium");
    expect(premium.subscriptionTier).toBe("PREMIUM");
    expect(premium.can("mileageDeduction")).toBe(true);
    expect(premium.accessStatus("mileageDeduction")).toBe("allowed");
  });

  it("never returns pending for non-staged features", () => {
    const a = access(null, false);
    expect(a.accessStatus("mileageDeduction")).not.toBe("pending");
  });
});
