import { describe, expect, it } from "vitest";
import { canAccessFeature, deriveUserTypeFromIncomeStreams, getFeatureAccess } from "@/lib/entitlements";
import type { HouseholdIncomeStreams } from "@/hooks/useTaxSettings";

const streams = (overrides: Partial<HouseholdIncomeStreams>): HouseholdIncomeStreams => ({
  w2Income: false,
  spouseW2Income: false,
  additionalW2Job: false,
  business1099Income: false,
  k1PartnershipIncome: false,
  sCorpIncome: false,
  rentalIncome: false,
  investmentIncome: false,
  otherIncome: false,
  ...overrides,
});

describe("entitlements", () => {
  it("derives the initial user types from household income stream flags", () => {
    expect(deriveUserTypeFromIncomeStreams(streams({ w2Income: true }))).toBe("W2_ONLY");
    expect(deriveUserTypeFromIncomeStreams(streams({ w2Income: true, business1099Income: true }))).toBe("W2_PLUS_1099");
    expect(deriveUserTypeFromIncomeStreams(streams({ business1099Income: true }))).toBe("FULLY_1099");
  });

  it("uses a safe expandable fallback for complex stream combinations", () => {
    expect(deriveUserTypeFromIncomeStreams(streams({ w2Income: true, business1099Income: true, k1PartnershipIncome: true }))).toBe(
      "MULTI_STREAM_HOUSEHOLD",
    );
  });

  it("marks premium features as locked for free users without removing access data", () => {
    const access = getFeatureAccess("W2_PLUS_1099", "FREE");
    expect(access.basic1099Tracking.status).toBe("available");
    expect(access.businessIncomeTracking.status).toBe("locked");
    expect(canAccessFeature("businessIncomeTracking", { userType: "W2_PLUS_1099", subscriptionTier: "PREMIUM" })).toBe(true);
  });
});
