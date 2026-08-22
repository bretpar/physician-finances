import { describe, expect, it } from "vitest";
import {
  SALT_CAP_2026,
  SALT_CAP_2026_MFS,
  SALT_FLOOR_2026,
  SALT_FLOOR_2026_MFS,
  computeItemizedDeductions,
  resolveItemizedDeductionInputs,
  selectDeduction,
} from "@/lib/saltDeduction";
import { STANDARD_DEDUCTION } from "@/lib/taxBrackets";
import { getFeatureDefinition, isFeatureRegistered, roleMeetsFeatureMinimum } from "@/lib/featureRegistry";
import { calculateFullEstimate } from "@/lib/taxEngine";
import type { AccountRole } from "@/lib/roles";

const base = {
  propertyTax: 0,
  stateIncomeTaxMode: "manual" as const,
  stateIncomeTaxEstimate: 0,
  stateIncomeTaxManual: 0,
  salesTaxBase: 0,
  salesTaxLargePurchases: 0,
  personalPropertyTax: 0,
  forceSalesTaxElection: false,
  saltCapOverride: null,
  otherItemizedDeductions: 0,
  filingStatus: "single" as const,
  magi: 0,
};

describe("itemizedDeductions feature gating", () => {
  it("is registered developer-only under the Tax Savings page", () => {
    expect(isFeatureRegistered("itemizedDeductions")).toBe(true);
    expect(getFeatureDefinition("itemizedDeductions")?.minimumRole).toBe("developer");
    expect(getFeatureDefinition("itemizedDeductions")?.parentFeatureKey).toBe("pageTaxSavings");
  });

  it("denies free, premium and premium_beta; allows developer", () => {
    for (const role of ["free", "premium", "premium_beta"] as AccountRole[]) {
      expect(roleMeetsFeatureMinimum(role, "itemizedDeductions")).toBe(false);
    }
    expect(roleMeetsFeatureMinimum("developer", "itemizedDeductions")).toBe(true);
  });
});

describe("SALT election", () => {
  it("takes the greater of state income tax and total sales tax", () => {
    const incomeWins = computeItemizedDeductions({ ...base, stateIncomeTaxManual: 9000, salesTaxBase: 4000 });
    expect(incomeWins.electedStateTaxType).toBe("income");
    expect(incomeWins.electedStateTaxAmount).toBe(9000);

    const salesWins = computeItemizedDeductions({
      ...base,
      stateIncomeTaxManual: 3000,
      salesTaxBase: 2500,
      salesTaxLargePurchases: 2000,
    });
    expect(salesWins.electedStateTaxType).toBe("sales");
    expect(salesWins.electedStateTaxAmount).toBe(4500);
  });

  it("uses the estimate in estimate mode and the manual value in manual mode", () => {
    const est = computeItemizedDeductions({
      ...base,
      stateIncomeTaxMode: "estimate",
      stateIncomeTaxEstimate: 7000,
      stateIncomeTaxManual: 1,
    });
    expect(est.stateIncomeTax).toBe(7000);
    const man = computeItemizedDeductions({ ...base, stateIncomeTaxEstimate: 7000, stateIncomeTaxManual: 1200 });
    expect(man.stateIncomeTax).toBe(1200);
  });

  it("honors the advanced always-elect-sales-tax override", () => {
    const r = computeItemizedDeductions({
      ...base,
      stateIncomeTaxManual: 20000,
      salesTaxBase: 3000,
      forceSalesTaxElection: true,
    });
    expect(r.electedStateTaxType).toBe("sales");
    expect(r.electedStateTaxAmount).toBe(3000);
  });

  it("sums property + elected state tax + personal property tax", () => {
    const r = computeItemizedDeductions({
      ...base,
      propertyTax: 12000,
      stateIncomeTaxManual: 15000,
      personalPropertyTax: 800,
    });
    expect(r.saltBeforeCap).toBe(27800);
    expect(r.saltDeduction).toBe(27800);
  });
});

describe("2026 SALT cap and phase-down", () => {
  it("caps at $40,400 generally and $20,200 MFS", () => {
    const single = computeItemizedDeductions({ ...base, propertyTax: 60000 });
    expect(single.baseCap).toBe(SALT_CAP_2026);
    expect(single.saltDeduction).toBe(SALT_CAP_2026);
    expect(single.saltDisallowed).toBe(60000 - SALT_CAP_2026);

    const mfs = computeItemizedDeductions({ ...base, filingStatus: "married_filing_separately", propertyTax: 60000 });
    expect(mfs.baseCap).toBe(SALT_CAP_2026_MFS);
    expect(mfs.saltDeduction).toBe(SALT_CAP_2026_MFS);
  });

  it("phases the cap down 30 cents per dollar of MAGI above $505,000", () => {
    const r = computeItemizedDeductions({ ...base, propertyTax: 60000, magi: 555_000 });
    expect(r.phaseDownAmount).toBeCloseTo(15_000, 6);
    expect(r.effectiveCap).toBeCloseTo(SALT_CAP_2026 - 15_000, 6);
  });

  it("does not phase down at or below the threshold", () => {
    const r = computeItemizedDeductions({ ...base, propertyTax: 60000, magi: 505_000 });
    expect(r.phaseDownAmount).toBe(0);
    expect(r.effectiveCap).toBe(SALT_CAP_2026);
  });

  it("never drops the cap below the statutory floor", () => {
    const single = computeItemizedDeductions({ ...base, propertyTax: 100_000, magi: 5_000_000 });
    expect(single.effectiveCap).toBe(SALT_FLOOR_2026);
    expect(single.saltDeduction).toBe(SALT_FLOOR_2026);

    const mfs = computeItemizedDeductions({
      ...base,
      filingStatus: "married_filing_separately",
      propertyTax: 100_000,
      magi: 5_000_000,
    });
    expect(mfs.effectiveCap).toBe(SALT_FLOOR_2026_MFS);
  });

  it("uses the MFS phase-down threshold of $252,500", () => {
    const r = computeItemizedDeductions({
      ...base,
      filingStatus: "married_filing_separately",
      propertyTax: 60000,
      magi: 262_500,
    });
    expect(r.phaseDownAmount).toBeCloseTo(3_000, 6);
    expect(r.effectiveCap).toBeCloseTo(SALT_CAP_2026_MFS - 3_000, 6);
  });

  it("ignores a persisted cap override — the statutory cap always controls", () => {
    const r = computeItemizedDeductions({ ...base, propertyTax: 60000, saltCapOverride: 99_000 });
    expect(r.effectiveCap).toBe(SALT_CAP_2026);
    expect(r.saltDeduction).toBe(SALT_CAP_2026);
    const low = computeItemizedDeductions({ ...base, propertyTax: 60000, saltCapOverride: 1_000 });
    expect(low.effectiveCap).toBe(SALT_CAP_2026);
  });

  it("adds other itemized deductions on top of capped SALT", () => {
    const r = computeItemizedDeductions({ ...base, propertyTax: 60000, otherItemizedDeductions: 12_000 });
    expect(r.totalItemized).toBe(SALT_CAP_2026 + 12_000);
  });
});

describe("standard vs itemized selection", () => {
  it("applies the larger of the two for every filing status", () => {
    for (const fs of ["single", "married_filing_jointly", "married_filing_separately", "head_of_household"] as const) {
      const standard = STANDARD_DEDUCTION[fs];
      expect(selectDeduction({ filingStatus: fs, itemizedTotal: standard - 1 })).toMatchObject({
        deductionType: "standard",
        deductionApplied: standard,
        itemizingBenefit: 0,
      });
      expect(selectDeduction({ filingStatus: fs, itemizedTotal: standard + 500 })).toMatchObject({
        deductionType: "itemized",
        deductionApplied: standard + 500,
        itemizingBenefit: 500,
      });
    }
  });

  it("uses a standard deduction override when present", () => {
    const s = selectDeduction({ filingStatus: "single", itemizedTotal: 20_000, standardDeductionOverride: 30_000 });
    expect(s.deductionType).toBe("standard");
    expect(s.deductionApplied).toBe(30_000);
  });

  it("confirms the 2026 standard deduction amounts", () => {
    expect(STANDARD_DEDUCTION.single).toBe(16_100);
    expect(STANDARD_DEDUCTION.married_filing_jointly).toBe(32_200);
    expect(STANDARD_DEDUCTION.head_of_household).toBe(24_150);
    expect(STANDARD_DEDUCTION.married_filing_separately).toBe(16_100);
  });
});

describe("settings → engine bridge", () => {
  const savedRates = {
    filingStatus: "single",
    deductionType: "itemized" as const,
    itemizedDeductionAmount: 12_345,
    standardDeductionOverride: null,
  };

  it("preserves saved behavior when itemized deductions are off", () => {
    expect(
      resolveItemizedDeductionInputs({ rates: savedRates, stateWithheldEstimate: 5000, magiApprox: 400_000 }),
    ).toEqual({ deductionType: "itemized", itemizedDeductionAmount: 12_345 });
  });

  it("uses itemized only when it beats the standard deduction", () => {
    const small = resolveItemizedDeductionInputs({
      rates: { ...savedRates, itemizedDeductionsEnabled: true, saltPropertyTax: 5_000 },
      stateWithheldEstimate: 0,
      magiApprox: 100_000,
    });
    expect(small).toEqual({ deductionType: "standard", itemizedDeductionAmount: 0 });

    const big = resolveItemizedDeductionInputs({
      rates: {
        ...savedRates,
        itemizedDeductionsEnabled: true,
        saltPropertyTax: 20_000,
        saltStateIncomeTaxMode: "manual",
        saltStateIncomeTaxManual: 10_000,
      },
      stateWithheldEstimate: 0,
      magiApprox: 100_000,
    });
    expect(big.deductionType).toBe("itemized");
    expect(big.itemizedDeductionAmount).toBe(30_000);
  });

  it("falls back to withheld state tax in estimate mode", () => {
    const r = resolveItemizedDeductionInputs({
      rates: {
        ...savedRates,
        itemizedDeductionsEnabled: true,
        saltStateIncomeTaxMode: "estimate",
        saltPropertyTax: 10_000,
      },
      stateWithheldEstimate: 14_000,
      magiApprox: 300_000,
    });
    expect(r.itemizedDeductionAmount).toBe(24_000);
  });

  it("prefers a saved annual state tax estimate over withholding", () => {
    const r = resolveItemizedDeductionInputs({
      rates: {
        ...savedRates,
        itemizedDeductionsEnabled: true,
        saltStateIncomeTaxMode: "estimate",
        saltPropertyTax: 10_000,
        personalStateTaxAnnualEstimate: 20_000,
      },
      stateWithheldEstimate: 14_000,
      magiApprox: 300_000,
    });
    expect(r.itemizedDeductionAmount).toBe(30_000);
  });
});

describe("tax engine integration", () => {
  const engineParams = {
    totalIncome: 400_000,
    w2Income: 400_000,
    seIncome: 0,
    preTaxDeductions: 0,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "single" as const,
    lastYearTax: 0,
  };

  it("lowers taxable income by the itemized amount when itemizing wins", () => {
    const standard = calculateFullEstimate(engineParams);
    const itemizedTotal = STANDARD_DEDUCTION.single + 20_000;
    const itemized = calculateFullEstimate({
      ...engineParams,
      deductionType: "itemized",
      itemizedDeductionAmount: itemizedTotal,
    });
    expect(itemized.deductionApplied).toBe(itemizedTotal);
    expect(itemized.taxableIncome).toBeCloseTo(standard.taxableIncome - 20_000, 6);
    expect(itemized.federalTax).toBeLessThan(standard.federalTax);
  });

  it("keeps the standard deduction when the bridge says standard", () => {
    const bridged = resolveItemizedDeductionInputs({
      rates: {
        filingStatus: "single",
        deductionType: "standard",
        itemizedDeductionAmount: 0,
        itemizedDeductionsEnabled: true,
        saltPropertyTax: 4_000,
      },
      stateWithheldEstimate: 1_000,
      magiApprox: 400_000,
    });
    const est = calculateFullEstimate({ ...engineParams, ...bridged });
    expect(est.deductionType).toBe("standard");
    expect(est.deductionApplied).toBe(STANDARD_DEDUCTION.single);
  });
});

describe("mortgage interest", () => {
  const base = {
    propertyTax: 0,
    stateIncomeTaxMode: "manual" as const,
    stateIncomeTaxEstimate: 0,
    stateIncomeTaxManual: 0,
    salesTaxBase: 0,
    salesTaxLargePurchases: 0,
    personalPropertyTax: 0,
    forceSalesTaxElection: false,
    saltCapOverride: null,
    otherItemizedDeductions: 0,
    magi: 200_000,
  };

  it("adds full mortgage interest when no balance is given", () => {
    const r = computeItemizedDeductions({ ...base, filingStatus: "single", mortgageInterest: 20_000 });
    expect(r.mortgageInterestDeductible).toBe(20_000);
    expect(r.mortgageInterestDisallowed).toBe(0);
    expect(r.totalItemized).toBe(20_000);
  });

  it("prorates interest above the $750k acquisition-debt limit", () => {
    const r = computeItemizedDeductions({
      ...base,
      filingStatus: "married_filing_jointly",
      mortgageInterest: 30_000,
      mortgageBalance: 1_500_000,
    });
    expect(r.mortgageDebtLimit).toBe(750_000);
    expect(r.mortgageInterestDeductible).toBeCloseTo(15_000, 6);
    expect(r.mortgageInterestDisallowed).toBeCloseTo(15_000, 6);
  });

  it("uses the $375k limit for married filing separately", () => {
    const r = computeItemizedDeductions({
      ...base,
      filingStatus: "married_filing_separately",
      mortgageInterest: 10_000,
      mortgageBalance: 750_000,
    });
    expect(r.mortgageDebtLimit).toBe(375_000);
    expect(r.mortgageInterestDeductible).toBeCloseTo(5_000, 6);
  });

  it("can flip the standard-vs-itemized comparison", () => {
    const withoutMortgage = computeItemizedDeductions({ ...base, filingStatus: "single", propertyTax: 12_000 });
    expect(selectDeduction({ filingStatus: "single", itemizedTotal: withoutMortgage.totalItemized }).deductionType).toBe("standard");
    const withMortgage = computeItemizedDeductions({ ...base, filingStatus: "single", propertyTax: 12_000, mortgageInterest: 18_000 });
    const sel = selectDeduction({ filingStatus: "single", itemizedTotal: withMortgage.totalItemized });
    expect(sel.deductionType).toBe("itemized");
    expect(sel.deductionApplied).toBe(30_000);
  });

  it("bridges saved mortgage settings into the engine inputs", () => {
    const res = resolveItemizedDeductionInputs({
      rates: {
        filingStatus: "single",
        deductionType: "standard",
        itemizedDeductionAmount: 0,
        itemizedDeductionsEnabled: true,
        saltPropertyTax: 12_000,
        itemizedMortgageInterest: 18_000,
        itemizedMortgageBalance: null,
      },
      stateWithheldEstimate: 0,
      magiApprox: 200_000,
    });
    expect(res).toEqual({ deductionType: "itemized", itemizedDeductionAmount: 30_000 });
  });
});
