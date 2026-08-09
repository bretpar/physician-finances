import { describe, expect, it } from "vitest";
import {
  DEFAULT_ADMIN_SUBGROUP,
  FEATURE_REGISTRY,
  OTHER_FEATURE_GROUP_ID,
  featureMatchesQuery,
  getFeatureType,
  groupChildrenByAdminGroup,
  groupFeaturesByPage,
  summarizeChildAccess,
} from "@/lib/featureRegistry";

const groups = groupFeaturesByPage(FEATURE_REGISTRY);
const byId = (id: string) => groups.find((g) => g.id === id)!;
const subgroupOf = (pageId: string, key: string) =>
  groupChildrenByAdminGroup(byId(pageId).children).find((s) => s.features.some((f) => f.key === key))?.title;

describe("admin features adminGroup organization", () => {
  it("keeps the collapsed view to the real app pages plus Other fallback", () => {
    const titles = groups.map((g) => g.title);
    for (const t of [
      "Dashboard",
      "Business Activity",
      "Personal Income",
      "Income Planner",
      "Investments",
      "Tax Savings",
      "Taxes",
      "Reports",
      "Settings",
    ]) {
      expect(titles).toContain(t);
    }
  });

  it("groups Tax Savings children into Retirement / Mileage / Home Office / General", () => {
    expect(subgroupOf("pageTaxSavings", "projectedContributionCapacity")).toBe("Retirement");
    expect(subgroupOf("pageTaxSavings", "employerContributionOpportunity")).toBe("Retirement");
    expect(subgroupOf("pageTaxSavings", "mileageDeduction")).toBe("Mileage");
    expect(subgroupOf("pageTaxSavings", "homeOfficeDeduction")).toBe("Home Office");
    expect(subgroupOf("pageTaxSavings", "basicTaxSavingsEstimate")).toBe("General Tax Savings");
    expect(subgroupOf("pageTaxSavings", "taxSavingsOpportunities")).toBe("General Tax Savings");
  });

  it("groups Taxes children into Tax Overview / Withholding & W-4 / Quarterly Taxes", () => {
    expect(subgroupOf("pageTaxes", "basicTaxOverview")).toBe("Tax Overview");
    expect(subgroupOf("pageTaxes", "advancedTaxOverview")).toBe("Tax Overview");
    expect(subgroupOf("pageTaxes", "basicWithholdingGuide")).toBe("Withholding & W-4");
    expect(subgroupOf("pageTaxes", "advancedWithholdingGuide")).toBe("Withholding & W-4");
    expect(subgroupOf("pageTaxes", "w4Calculator")).toBe("Withholding & W-4");
    expect(subgroupOf("pageTaxes", "quarterlyTaxPlanner")).toBe("Quarterly Taxes");
    expect(subgroupOf("pageTaxes", "quarterlySavingsPace")).toBe("Quarterly Taxes");
  });

  it("keeps Income Planner and Dashboard child grouping logical", () => {
    expect(subgroupOf("pageIncomePlanner", "scenarioPlanner")).toBe("Planner");
    expect(subgroupOf("pageIncomePlanner", "incomePlannerForecastMode")).toBe("Planner");
    expect(subgroupOf("pageDashboard", "financialAssistantRecommendations")).toBe("Financial Assistant");
    expect(subgroupOf("pageSettings", "forecastingAutomation")).toBe("Forecasting");
  });

  it("shows every registered feature exactly once across pages and subgroups", () => {
    const seen = groups.flatMap((g) => [
      ...(g.page ? [g.page.key] : []),
      ...groupChildrenByAdminGroup(g.children).flatMap((s) => s.features.map((f) => f.key)),
    ]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.sort()).toEqual(FEATURE_REGISTRY.map((e) => e.key).sort());
  });

  it("falls back to a default subgroup instead of dropping ungrouped children", () => {
    const [sub] = groupChildrenByAdminGroup([{ ...FEATURE_REGISTRY[0], adminGroup: undefined }]);
    expect(sub.title).toBe(DEFAULT_ADMIN_SUBGROUP);
    expect(sub.features).toHaveLength(1);
  });

  it("keeps the Other / Global fallback for unparented features", () => {
    const unparented = FEATURE_REGISTRY.filter(
      (e) =>
        getFeatureType(e) !== "page" &&
        (!e.parentFeatureKey ||
          !FEATURE_REGISTRY.some((p) => p.key === e.parentFeatureKey && getFeatureType(p) === "page")),
    );
    const other = groups.find((g) => g.id === OTHER_FEATURE_GROUP_ID);
    if (unparented.length === 0) expect(other).toBeUndefined();
    else expect(other?.children.map((c) => c.key).sort()).toEqual(unparented.map((c) => c.key).sort());
  });

  it("summarizes child tiers using effective (overridden) access and omits zero counts", () => {
    const children = byId("pageTaxSavings").children;
    const base = summarizeChildAccess(children);
    expect(base).toMatch(/Free/);
    expect(base).not.toMatch(/0 /);
    const overridden = summarizeChildAccess(children, { mileageDeduction: "premium_beta" });
    expect(overridden).toMatch(/1 Premium Beta/);
    expect(summarizeChildAccess([])).toBe("No subfeatures");
  });

  it("searches subgroup names as well as name, key and description", () => {
    const retirement = FEATURE_REGISTRY.find((e) => e.key === "projectedContributionCapacity")!;
    expect(featureMatchesQuery(retirement, "retirement")).toBe(true);
    expect(featureMatchesQuery(retirement, "projectedContributionCapacity")).toBe(true);
    expect(featureMatchesQuery(retirement, "zzz-nope")).toBe(false);
  });

  it("keeps page access independent from its children", () => {
    const page = byId("pageTaxSavings").page!;
    expect(page.minimumRole).toBe("free");
    expect(byId("pageTaxSavings").children.some((c) => c.minimumRole === "premium")).toBe(true);
  });
});
