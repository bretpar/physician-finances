import { describe, expect, it } from "vitest";
import {
  FEATURE_REGISTRY,
  entryAllowsRole,
  getFeatureDefinition,
  getFeatureType,
  hasFeatureOverride,
  isFeatureRegistered,
  resolveRequiredAccess,
  roleMeetsFeatureMinimum,
  type FeatureOverrideMap,
} from "@/lib/featureRegistry";
import { canAccessFeature } from "@/lib/entitlements";
import type { AccountRole } from "@/lib/roles";

const ROLES: AccountRole[] = ["free", "premium", "premium_beta", "developer"];

describe("admin feature-access overrides", () => {
  it("falls back to the code default when no override row exists", () => {
    expect(resolveRequiredAccess("pageIncomePlanner")).toBe("premium");
    expect(resolveRequiredAccess("pageIncomePlanner", {})).toBe("premium");
    expect(hasFeatureOverride("pageIncomePlanner", {})).toBe(false);
    expect(roleMeetsFeatureMinimum("free", "pageIncomePlanner", {})).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "pageIncomePlanner", {})).toBe(true);
  });

  it("ignores invalid override values and keeps the code default", () => {
    const bad = { pageTaxes: "gold" } as unknown as FeatureOverrideMap;
    expect(resolveRequiredAccess("pageTaxes", bad)).toBe("free");
    expect(roleMeetsFeatureMinimum("free", "pageTaxes", bad)).toBe(true);
  });

  it("changes the effective required access when an override exists", () => {
    const overrides: FeatureOverrideMap = { pageTaxes: "premium", pageIncomePlanner: "free" };
    expect(resolveRequiredAccess("pageTaxes", overrides)).toBe("premium");
    expect(roleMeetsFeatureMinimum("free", "pageTaxes", overrides)).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "pageTaxes", overrides)).toBe(true);
    // Widening also works.
    expect(roleMeetsFeatureMinimum("free", "pageIncomePlanner", overrides)).toBe(true);
  });

  it("denies a disabled override to every role including developer", () => {
    const overrides: FeatureOverrideMap = { pageDashboard: "disabled" };
    for (const role of ROLES) expect(roleMeetsFeatureMinimum(role, "pageDashboard", overrides)).toBe(false);
    expect(isFeatureRegistered("pageDashboard", overrides)).toBe(false);
  });

  it("keeps the role hierarchy inheritance for overrides", () => {
    const overrides: FeatureOverrideMap = { pageReports: "premium_beta" };
    expect(roleMeetsFeatureMinimum("free", "pageReports", overrides)).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "pageReports", overrides)).toBe(false);
    expect(roleMeetsFeatureMinimum("premium_beta", "pageReports", overrides)).toBe(true);
    expect(roleMeetsFeatureMinimum("developer", "pageReports", overrides)).toBe(true);
  });

  it("fails closed on unknown keys even with an override present", () => {
    const overrides = { not_a_feature: "free" } as FeatureOverrideMap;
    for (const role of ROLES) expect(roleMeetsFeatureMinimum(role, "not_a_feature", overrides)).toBe(false);
    expect(resolveRequiredAccess("not_a_feature", overrides)).toBeUndefined();
    expect(entryAllowsRole(undefined, "developer", overrides)).toBe(false);
  });
});

describe("page access is independent from subfeature access", () => {
  const pageKeys = [
    "pageDashboard",
    "pageBusinessActivity",
    "pagePersonalIncome",
    "pageIncomePlanner",
    "pageInvestments",
    "pageTaxSavings",
    "pageTaxes",
    "pageReports",
    "pageSettings",
  ];

  it("registers every page-level key as a page type", () => {
    for (const key of pageKeys) {
      const entry = getFeatureDefinition(key);
      expect(entry, key).toBeDefined();
      expect(getFeatureType(entry!)).toBe("page");
    }
  });

  it("uses the intended page defaults", () => {
    expect(resolveRequiredAccess("pageDashboard")).toBe("free");
    expect(resolveRequiredAccess("pageBusinessActivity")).toBe("free");
    expect(resolveRequiredAccess("pagePersonalIncome")).toBe("free");
    expect(resolveRequiredAccess("pageIncomePlanner")).toBe("premium");
    expect(resolveRequiredAccess("pageTaxSavings")).toBe("free");
    expect(resolveRequiredAccess("pageTaxes")).toBe("free");
    expect(resolveRequiredAccess("pageSettings")).toBe("free");
  });

  it("keeps Business Activity free while advanced business features stay premium", () => {
    expect(roleMeetsFeatureMinimum("free", "pageBusinessActivity")).toBe(true);
    expect(canAccessFeature("businessIncomeTracking", { userType: "FULLY_1099", subscriptionTier: "FREE" })).toBe(false);
    expect(canAccessFeature("businessIncomeTracking", { userType: "FULLY_1099", subscriptionTier: "PREMIUM" })).toBe(true);
  });

  it("keeps Tax Savings free while mileage / home office gate separately", () => {
    expect(roleMeetsFeatureMinimum("free", "pageTaxSavings")).toBe(true);
    expect(roleMeetsFeatureMinimum("free", "mileageDeduction")).toBe(false);
    expect(roleMeetsFeatureMinimum("free", "homeOfficeDeduction")).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "mileageDeduction")).toBe(true);
  });

  it("keeps Taxes free while Advanced Tax Overview stays premium", () => {
    expect(roleMeetsFeatureMinimum("free", "pageTaxes")).toBe(true);
    expect(roleMeetsFeatureMinimum("free", "advancedTaxOverview")).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "advancedTaxOverview")).toBe(true);
  });

  it("keeps the staged-release Student Loan Planner developer-only by default", () => {
    expect(roleMeetsFeatureMinimum("premium_beta", "studentLoanPlanner")).toBe(false);
    expect(roleMeetsFeatureMinimum("developer", "studentLoanPlanner")).toBe(true);
    // Admin can stage it down to Premium Beta without a code change.
    const overrides: FeatureOverrideMap = { studentLoanPlanner: "premium_beta" };
    expect(roleMeetsFeatureMinimum("premium_beta", "studentLoanPlanner", overrides)).toBe(true);
    expect(roleMeetsFeatureMinimum("premium", "studentLoanPlanner", overrides)).toBe(false);
  });

  it("keeps feature keys unique across code and page entries", () => {
    const keys = FEATURE_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
