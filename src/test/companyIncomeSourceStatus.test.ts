import { describe, it, expect } from "vitest";
import { isCompanyIncomeSourceInactive } from "@/lib/householdIncomeProfile";
import type { HouseholdIncomeStreams } from "@/hooks/useTaxSettings";

const streamsW2Only: HouseholdIncomeStreams = {
  w2Income: true,
  spouseW2Income: false,
  additionalW2Job: false,
  business1099Income: false,
  k1PartnershipIncome: false,
  sCorpIncome: false,
  rentalIncome: false,
  investmentIncome: false,
  otherIncome: false,
};

describe("isCompanyIncomeSourceInactive", () => {
  it("treats a newly created active K-1 company as active even when the profile flag is stale", () => {
    expect(
      isCompanyIncomeSourceInactive({
        streams: streamsW2Only,
        companies: [{ id: "vituity-qa", companyType: "k1_partnership" }],
        companyId: "vituity-qa",
        filingType: "k1_partnership",
      }),
    ).toBe(false);
  });

  it("keeps the type active when another active company shares the filing type (unassigned entry)", () => {
    expect(
      isCompanyIncomeSourceInactive({
        streams: streamsW2Only,
        companies: [{ id: "c1", companyType: "1099_schedule_c" }],
        companyId: null,
        filingType: "1099_schedule_c",
      }),
    ).toBe(false);
  });

  it("flags a removed/archived company whose type is no longer in the profile", () => {
    expect(
      isCompanyIncomeSourceInactive({
        streams: streamsW2Only,
        companies: [{ id: "w2-co", companyType: "w2" }],
        companyId: "deleted-k1",
        filingType: "k1_partnership",
      }),
    ).toBe(true);
  });

  it("does not flag a removed company when the profile still enables that stream", () => {
    expect(
      isCompanyIncomeSourceInactive({
        streams: { ...streamsW2Only, k1PartnershipIncome: true },
        companies: [],
        companyId: "deleted-k1",
        filingType: "k1_partnership",
      }),
    ).toBe(false);
  });

  it("keeps existing W-2 and 1099 behavior for active employers", () => {
    const companies = [
      { id: "w2-co", companyType: "w2" },
      { id: "gig", companyType: "1099_schedule_c" },
    ];
    expect(isCompanyIncomeSourceInactive({ streams: streamsW2Only, companies, companyId: "w2-co", filingType: "w2" })).toBe(false);
    expect(isCompanyIncomeSourceInactive({ streams: streamsW2Only, companies, companyId: "gig", filingType: "1099_schedule_c" })).toBe(false);
  });

  it("compares stable IDs, not display names", () => {
    expect(
      isCompanyIncomeSourceInactive({
        streams: streamsW2Only,
        companies: [{ id: "id-a", companyType: "scorp_w2" }],
        companyId: "Vituity QA",
        filingType: "scorp_w2",
      }),
    ).toBe(false);
  });

  it("flags a scorp entry when no active scorp entity and profile disables it", () => {
    expect(
      isCompanyIncomeSourceInactive({
        streams: streamsW2Only,
        companies: [{ id: "w2-co", companyType: "w2" }],
        companyId: "old-scorp",
        filingType: "scorp_distribution",
      }),
    ).toBe(true);
  });
});
