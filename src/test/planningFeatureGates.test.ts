import { describe, expect, it } from "vitest";
import {
  getFeatureDefinition,
  isFeatureRegistered,
  resolveRequiredAccess,
  roleMeetsFeatureMinimum,
} from "@/lib/featureRegistry";
import type { AccountRole } from "@/lib/roles";

const NEW_KEYS = [
  "financialAssistantRecommendations",
  "incomePlannerForecastMode",
  "projectedContributionCapacity",
  "employerContributionOpportunity",
  "w4Calculator",
  "quarterlySavingsPace",
  "forecastingAutomation",
  "taxSavingsOpportunities",
] as const;

const PARENT_PAGES = ["pageDashboard", "pageIncomePlanner", "pageTaxes", "pageTaxSavings", "pageSettings"] as const;

describe("planning / recommendation feature gates", () => {
  it("registers every new key with a premium default", () => {
    for (const key of NEW_KEYS) {
      expect(isFeatureRegistered(key)).toBe(true);
      expect(getFeatureDefinition(key)?.minimumRole).toBe("premium");
      expect(resolveRequiredAccess(key)).toBe("premium");
    }
  });

  it("keeps each subfeature attached to an existing parent page", () => {
    for (const key of NEW_KEYS) {
      const parent = getFeatureDefinition(key)?.parentFeatureKey;
      expect(PARENT_PAGES).toContain(parent as (typeof PARENT_PAGES)[number]);
    }
  });

  it("denies free users and allows premium, premium_beta and developer", () => {
    for (const key of NEW_KEYS) {
      expect(roleMeetsFeatureMinimum("free", key)).toBe(false);
      for (const role of ["premium", "premium_beta", "developer"] as AccountRole[]) {
        expect(roleMeetsFeatureMinimum(role, key)).toBe(true);
      }
    }
  });

  it("keeps the parent Free page accessible while the subfeature is premium", () => {
    for (const page of PARENT_PAGES) {
      if (page === "pageIncomePlanner") continue; // page itself is premium by design
      expect(roleMeetsFeatureMinimum("free", page)).toBe(true);
    }
  });

  it("honors Admin overrides for effective access", () => {
    expect(roleMeetsFeatureMinimum("free", "w4Calculator", { w4Calculator: "free" })).toBe(true);
    expect(roleMeetsFeatureMinimum("premium", "taxSavingsOpportunities", { taxSavingsOpportunities: "developer" })).toBe(
      false,
    );
    expect(roleMeetsFeatureMinimum("developer", "quarterlySavingsPace", { quarterlySavingsPace: "disabled" })).toBe(
      false,
    );
    expect(resolveRequiredAccess("forecastingAutomation", { forecastingAutomation: "free" })).toBe("free");
  });

  it("reuses existing canonical gates instead of duplicating them", () => {
    // Quarterly planning + advanced reserve recommendations already have gates.
    expect(isFeatureRegistered("quarterlyTaxPlanner")).toBe(true);
    expect(isFeatureRegistered("advancedWithholdingGuide")).toBe(true);
    expect(getFeatureDefinition("advancedTaxReserveRecommendations")).toBeUndefined();
  });
});
