import { describe, it, expect } from "vitest";
import { getDeductionToolVisibility } from "@/lib/householdIncomeProfile";
import type { HouseholdIncomeStreams } from "@/hooks/useTaxSettings";

const baseStreams: HouseholdIncomeStreams = {
  w2Income: false,
  spouseW2Income: false,
  additionalW2Job: false,
  business1099Income: false,
  k1PartnershipIncome: false,
  sCorpIncome: false,
  rentalIncome: false,
  investmentIncome: false,
  otherIncome: false,
};

describe("getDeductionToolVisibility — tool visibility rules per income profile", () => {
  describe("W-2 only", () => {
    it("hides Mileage and Home Office; shows Retirement and HSA", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, w2Income: true });
      expect(v.showMileage).toBe(false);
      expect(v.showHomeOffice).toBe(false);
      expect(v.showRetirement).toBe(true);
      expect(v.showHsa).toBe(true);
    });

    it("treats spouse-only W-2 as W-2 only", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, spouseW2Income: true });
      expect(v.showMileage).toBe(false);
      expect(v.showHomeOffice).toBe(false);
    });

    it("treats additional W-2 job as W-2 only", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, w2Income: true, additionalW2Job: true });
      expect(v.showMileage).toBe(false);
      expect(v.showHomeOffice).toBe(false);
    });
  });

  describe("W-2 + 1099/K-1", () => {
    it("shows Mileage, Home Office, Retirement, and HSA when W-2 and 1099 are both on", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, w2Income: true, business1099Income: true });
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
      expect(v.showRetirement).toBe(true);
      expect(v.showHsa).toBe(true);
    });

    it("shows all four when W-2 + K-1", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, w2Income: true, k1PartnershipIncome: true });
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
      expect(v.showRetirement).toBe(true);
      expect(v.showHsa).toBe(true);
    });

    it("shows all four when W-2 + S-corp", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, w2Income: true, sCorpIncome: true });
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
    });
  });

  describe("1099/K-1 only", () => {
    it("shows all four when only 1099 is on", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, business1099Income: true });
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
      expect(v.showRetirement).toBe(true);
      expect(v.showHsa).toBe(true);
    });

    it("shows all four when only K-1 is on", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, k1PartnershipIncome: true });
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
      expect(v.showRetirement).toBe(true);
      expect(v.showHsa).toBe(true);
    });

    it("shows all four when only S-corp is on", () => {
      const v = getDeductionToolVisibility({ ...baseStreams, sCorpIncome: true });
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("defaults to permissive (all visible) when streams are undefined", () => {
      const v = getDeductionToolVisibility(undefined);
      expect(v).toEqual({ showMileage: true, showHomeOffice: true, showRetirement: true, showHsa: true });
    });

    it("with no streams enabled at all, still shows Retirement and HSA but hides Mileage/Home Office only when there is W-2 income; otherwise leaves them visible", () => {
      // No income at all → not W-2-only → Mileage/Home Office remain visible.
      const v = getDeductionToolVisibility(baseStreams);
      expect(v.showRetirement).toBe(true);
      expect(v.showHsa).toBe(true);
      expect(v.showMileage).toBe(true);
      expect(v.showHomeOffice).toBe(true);
    });
  });
});
