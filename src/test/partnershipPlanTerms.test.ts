import { describe, it, expect } from "vitest";
import { readPartnershipPlanTerms, writePartnershipPlanTerms, partnershipTermsComplete } from "@/lib/partnershipPlanTerms";
import { resolveSettingsDeepLink, settingsLink } from "@/lib/settingsDeepLink";

describe("partnership plan terms", () => {
  it("round-trips and preserves other metadata", () => {
    const meta = writePartnershipPlanTerms({ k1: "x" }, { sponsorship: "partnership", additionalEmployeeDeferrals: "permitted", additionalEmployerContributions: "partnership_determined", planCeiling: 30000 });
    expect((meta as Record<string, unknown>).k1).toBe("x");
    expect(readPartnershipPlanTerms(meta)).toEqual({ sponsorship: "partnership", additionalEmployeeDeferrals: "permitted", additionalEmployerContributions: "partnership_determined", planCeiling: 30000 });
    expect(partnershipTermsComplete(readPartnershipPlanTerms(meta))).toBe(true);
  });
  it("treats any 'Not sure' answer as incomplete", () => {
    expect(partnershipTermsComplete({ sponsorship: "partnership", additionalEmployeeDeferrals: "not_sure", additionalEmployerContributions: "permitted", planCeiling: null })).toBe(false);
  });
});

describe("retirement settings links", () => {
  const companies = [{ id: "a" }, { id: "b" }];
  it("opens the named retirement section and focuses the company, not Companies", () => {
    const link = resolveSettingsDeepLink(new URL(`http://x${settingsLink("employer-match", "a")}`).searchParams, companies, new Set());
    expect(link).toMatchObject({ retirementSection: "employer-match", focusCompanyId: "a", openSection: false, companyId: null });
  });
  it("ignores unknown sections", () => {
    expect(resolveSettingsDeepLink(new URLSearchParams("section=nope"), companies, new Set()).retirementSection).toBeNull();
  });
});
