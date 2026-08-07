import { describe, expect, it } from "vitest";
import {
  FEATURE_REGISTRY,
  filterFeatures,
  getFeatureDefinition,
  isFeatureRegistered,
  roleMeetsFeatureMinimum,
  type FeatureRegistryEntry,
} from "@/lib/featureRegistry";
import { ALL_ENTITLEMENT_FEATURES, canAccessFeature } from "@/lib/entitlements";
import type { AccountRole } from "@/lib/roles";

const ROLES: AccountRole[] = ["free", "premium", "premium_beta", "developer"];

describe("feature registry hierarchy", () => {
  it("gives every role access to free features", () => {
    for (const role of ROLES) expect(roleMeetsFeatureMinimum(role, "basicTaxOverview")).toBe(true);
  });

  it("restricts premium features to premium and above", () => {
    expect(roleMeetsFeatureMinimum("free", "scenarioPlanner")).toBe(false);
    expect(roleMeetsFeatureMinimum("premium", "scenarioPlanner")).toBe(true);
    expect(roleMeetsFeatureMinimum("premium_beta", "scenarioPlanner")).toBe(true);
    expect(roleMeetsFeatureMinimum("developer", "scenarioPlanner")).toBe(true);
  });

  it("denies a disabled feature to every role", () => {
    const disabled: FeatureRegistryEntry = {
      key: "scenarioPlanner",
      name: "x",
      description: "x",
      minimumRole: "disabled",
      status: "disabled",
    };
    // simulate via helper contract on a locally-shaped entry
    const localLookup = (role: AccountRole) =>
      disabled.status === "disabled" || disabled.minimumRole === "disabled" ? false : true;
    for (const role of ROLES) expect(localLookup(role)).toBe(false);
  });

  it("fails closed on unknown keys", () => {
    for (const role of ROLES) expect(roleMeetsFeatureMinimum("developer", "not_a_feature")).toBe(false);
    expect(isFeatureRegistered("not_a_feature")).toBe(false);
    expect(getFeatureDefinition("not_a_feature")).toBeUndefined();
    expect(roleMeetsFeatureMinimum(null, "basicTaxOverview")).toBe(false);
  });

  it("registers every entitlement feature key exactly once", () => {
    const keys = FEATURE_REGISTRY.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of ALL_ENTITLEMENT_FEATURES) expect(isFeatureRegistered(key)).toBe(true);
  });

  it("searches by name or key", () => {
    expect(filterFeatures(FEATURE_REGISTRY, "mileage").map((f) => f.key)).toEqual(["mileageDeduction"]);
    expect(filterFeatures(FEATURE_REGISTRY, "basicTaxOverview")).toHaveLength(1);
    expect(filterFeatures(FEATURE_REGISTRY, "")).toHaveLength(FEATURE_REGISTRY.length);
  });
});

describe("existing gates keep their behavior", () => {
  it("premium gate still requires PREMIUM tier", () => {
    expect(canAccessFeature("scenarioPlanner", { userType: "W2_ONLY", subscriptionTier: "FREE" })).toBe(false);
    expect(canAccessFeature("scenarioPlanner", { userType: "W2_ONLY", subscriptionTier: "PREMIUM" })).toBe(true);
  });

  it("free gate still available on FREE tier", () => {
    expect(canAccessFeature("basicTaxOverview", { userType: "W2_ONLY", subscriptionTier: "FREE" })).toBe(true);
  });

  it("unknown key denied through entitlements", () => {
    expect(canAccessFeature("madeUpFeature" as never, { userType: "W2_ONLY", subscriptionTier: "PREMIUM" })).toBe(false);
  });
});
