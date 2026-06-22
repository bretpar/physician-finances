import { describe, it, expect } from "vitest";
import {
  isBusinessReportingCompany,
  isActiveK1Company,
  isPassiveK1Company,
  getBusinessReportingCompanyNames,
  getPassiveK1CompanyNames,
} from "@/lib/reportingAggregation";

const mk = (
  name: string,
  companyType: any,
  k1?: any,
  includeSETaxInRecommendation: boolean = true,
) =>
  ({
    name,
    companyType,
    k1TaxTreatment: k1 ?? null,
    includeSETaxInRecommendation,
  }) as any;

describe("reportingAggregation", () => {
  it("treats 1099 Schedule C as business reporting", () => {
    expect(isBusinessReportingCompany(mk("A", "1099_schedule_c"))).toBe(true);
  });

  it("treats active K-1 (active_partnership / guaranteed) as business", () => {
    expect(
      isBusinessReportingCompany(mk("V", "k1_partnership", "active_partnership")),
    ).toBe(true);
    expect(
      isBusinessReportingCompany(mk("G", "k1_partnership", "guaranteed_payments")),
    ).toBe(true);
    expect(isActiveK1Company(mk("V", "k1_partnership", "active_partnership"))).toBe(true);
  });

  it("treats passive K-1 / S-corp distribution as NOT business reporting", () => {
    expect(isBusinessReportingCompany(mk("P", "k1_partnership", "passive"))).toBe(false);
    expect(isBusinessReportingCompany(mk("S", "k1_partnership", "scorp_distribution"))).toBe(false);
    expect(isPassiveK1Company(mk("P", "k1_partnership", "passive"))).toBe(true);
    expect(isPassiveK1Company(mk("S", "k1_partnership", "scorp_distribution"))).toBe(true);
  });

  it("treats W-2 / scorp_w2 / other as NOT business reporting", () => {
    expect(isBusinessReportingCompany(mk("W", "w2"))).toBe(false);
    expect(isBusinessReportingCompany(mk("X", "scorp_w2"))).toBe(false);
    expect(isBusinessReportingCompany(mk("Y", "other"))).toBe(false);
  });

  describe("K-1 fallback when treatment is null", () => {
    it("uses includeSETaxInRecommendation=true → active", () => {
      const c = mk("FallbackActive", "k1_partnership", null, true);
      expect(isActiveK1Company(c)).toBe(true);
      expect(isPassiveK1Company(c)).toBe(false);
      expect(isBusinessReportingCompany(c)).toBe(true);
    });

    it("uses includeSETaxInRecommendation=false → passive", () => {
      const c = mk("FallbackPassive", "k1_partnership", null, false);
      expect(isPassiveK1Company(c)).toBe(true);
      expect(isActiveK1Company(c)).toBe(false);
      expect(isBusinessReportingCompany(c)).toBe(false);
    });

    it("explicit treatment overrides the SE-tax flag", () => {
      // SE flag says active, but treatment explicitly says passive → passive wins.
      const c = mk("Override", "k1_partnership", "passive", true);
      expect(isPassiveK1Company(c)).toBe(true);
      expect(isActiveK1Company(c)).toBe(false);
    });
  });

  it("getBusinessReportingCompanyNames returns only business entities", () => {
    const companies = [
      mk("Independent Consulting", "1099_schedule_c"),
      mk("Active Ortho Group", "k1_partnership", "active_partnership"),
      mk("Passive Surgery Center", "k1_partnership", "passive"),
      mk("Evergreen Hospital", "w2"),
      mk("Legacy K-1 Active", "k1_partnership", null, true),
      mk("Legacy K-1 Passive", "k1_partnership", null, false),
    ];
    const names = getBusinessReportingCompanyNames(companies);
    expect([...names].sort()).toEqual([
      "Active Ortho Group",
      "Independent Consulting",
      "Legacy K-1 Active",
    ]);
    const passive = getPassiveK1CompanyNames(companies);
    expect([...passive].sort()).toEqual(["Legacy K-1 Passive", "Passive Surgery Center"]);
  });
});
