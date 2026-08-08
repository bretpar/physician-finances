import { describe, expect, it } from "vitest";
import { getFeatureDefinition, roleMeetsFeatureMinimum } from "@/lib/featureRegistry";
import { ALL_ENTITLEMENT_FEATURES } from "@/lib/entitlements";
import { isStagedReleaseFeature } from "@/hooks/useFeatureAccess";

describe("studentLoanPlanner staged release gate", () => {
  it("is registered as a developer-only active feature", () => {
    const entry = getFeatureDefinition("studentLoanPlanner");
    expect(entry).toBeDefined();
    expect(entry?.name).toBe("Student Loan Planner");
    expect(entry?.minimumRole).toBe("developer");
    expect(entry?.status).toBe("active");
  });

  it("is treated as a staged-release feature (outside the tier matrix)", () => {
    expect(ALL_ENTITLEMENT_FEATURES).not.toContain("studentLoanPlanner");
    expect(isStagedReleaseFeature("studentLoanPlanner")).toBe(true);
    expect(isStagedReleaseFeature("mileageDeduction")).toBe(false);
  });

  it("allows developer only", () => {
    expect(roleMeetsFeatureMinimum("developer", "studentLoanPlanner")).toBe(true);
    expect(roleMeetsFeatureMinimum("premium_beta", "studentLoanPlanner")).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "studentLoanPlanner")).toBe(false);
    expect(roleMeetsFeatureMinimum("free", "studentLoanPlanner")).toBe(false);
    expect(roleMeetsFeatureMinimum(null, "studentLoanPlanner")).toBe(false);
  });

  it("does not change any other feature's access level", () => {
    expect(getFeatureDefinition("mileageDeduction")?.minimumRole).toBe("premium");
    expect(getFeatureDefinition("basicTaxOverview")?.minimumRole).toBe("free");
  });
});
