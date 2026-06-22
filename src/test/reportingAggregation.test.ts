import { describe, it, expect } from "vitest";
import {
  isBusinessReportingCompany,
  isActiveK1Company,
  isPassiveK1Company,
  getBusinessReportingCompanyNames,
  getPassiveK1CompanyNames,
} from "@/lib/reportingAggregation";

const mk = (name: string, companyType: any, k1?: any) =>
  ({ name, companyType, k1TaxTreatment: k1 ?? null }) as any;

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

  it("treats unset K-1 treatment as active (default)", () => {
    expect(isBusinessReportingCompany(mk("U", "k1_partnership", null))).toBe(true);
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

  it("getBusinessReportingCompanyNames returns only business entities", () => {
    const companies = [
      mk("ACME 1099", "1099_schedule_c"),
      mk("Vituity", "k1_partnership", "active_partnership"),
      mk("Passive RE", "k1_partnership", "passive"),
      mk("Day Job", "w2"),
    ];
    const names = getBusinessReportingCompanyNames(companies);
    expect([...names].sort()).toEqual(["ACME 1099", "Vituity"]);
    const passive = getPassiveK1CompanyNames(companies);
    expect([...passive]).toEqual(["Passive RE"]);
  });
});
