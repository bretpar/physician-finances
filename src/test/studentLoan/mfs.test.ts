import { describe, it, expect } from "vitest";
import { getPlan } from "@/lib/studentLoan/rules/plans";
import { computePlanPayment } from "@/lib/studentLoan/computePlanPayment";

describe("per-plan spouse-income rules", () => {
  it("RAP MFJ combines both AGIs; RAP MFS uses filer only", () => {
    expect(getPlan("rap")?.spouseIncome).toEqual({ mfj: "combined", mfs: "filer_only" });
  });

  it("IBR and PAYE follow the same MFJ combined / MFS filer-only rule", () => {
    for (const id of ["ibr_new", "ibr_old", "paye", "icr"]) {
      expect(getPlan(id)?.spouseIncome).toEqual({ mfj: "combined", mfs: "filer_only" });
    }
  });

  it("Under MFJ, adding spouse AGI increases the IDR payment", () => {
    const base = computePlanPayment(
      "paye",
      { balance: 100_000, interestRatePct: 6 },
      { agi: 100_000, spouseAgi: 0, familySize: 2, region: "contiguous_48_dc", filingStatus: "married_filing_jointly", firstDisbursementDate: "2020-01-01", isParentPlus: false },
    );
    const withSpouse = computePlanPayment(
      "paye",
      { balance: 100_000, interestRatePct: 6 },
      { agi: 100_000, spouseAgi: 100_000, familySize: 2, region: "contiguous_48_dc", filingStatus: "married_filing_jointly", firstDisbursementDate: "2020-01-01", isParentPlus: false },
    );
    expect(withSpouse.monthlyPayment).toBeGreaterThan(base.monthlyPayment);
  });

  it("Under MFS, spouse AGI is ignored", () => {
    const a = computePlanPayment(
      "paye",
      { balance: 100_000, interestRatePct: 6 },
      { agi: 100_000, spouseAgi: 0, familySize: 2, region: "contiguous_48_dc", filingStatus: "married_filing_separately", firstDisbursementDate: "2020-01-01", isParentPlus: false },
    );
    const b = computePlanPayment(
      "paye",
      { balance: 100_000, interestRatePct: 6 },
      { agi: 100_000, spouseAgi: 500_000, familySize: 2, region: "contiguous_48_dc", filingStatus: "married_filing_separately", firstDisbursementDate: "2020-01-01", isParentPlus: false },
    );
    expect(a.monthlyPayment).toBe(b.monthlyPayment);
  });
});
