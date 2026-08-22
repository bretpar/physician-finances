/**
 * SALT correctness inside the canonical tax engine:
 *  - the phase-down uses the engine's canonical AGI/MAGI, not gross buckets;
 *  - persisted `salt_cap_override` values can never change liability;
 *  - the engine — not the caller — decides standard vs itemized;
 *  - Developer gating happens in the calculation path, without erasing data.
 */
import { describe, it, expect } from "vitest";
import { calculateFullEstimate } from "@/lib/taxEngine";
import {
  SALT_CAP_2026,
  SALT_CAP_2026_MFS,
  SALT_FLOOR_2026_MFS,
  SALT_PHASEDOWN_THRESHOLD_2026_MFS,
  buildEngineItemizedInputs,
  resolveCanonicalDeduction,
  type EngineItemizedInputs,
  type ItemizedSettingsRates,
} from "@/lib/saltDeduction";
import { STANDARD_DEDUCTION } from "@/lib/taxBrackets";

const saltInputs = (over: Partial<EngineItemizedInputs> = {}): EngineItemizedInputs => ({
  propertyTax: 30_000,
  stateIncomeTaxMode: "manual",
  stateIncomeTaxEstimate: 0,
  stateIncomeTaxManual: 25_000,
  salesTaxBase: 0,
  salesTaxLargePurchases: 0,
  personalPropertyTax: 0,
  forceSalesTaxElection: false,
  otherItemizedDeductions: 0,
  mortgageInterest: 0,
  mortgageBalance: null,
  ...over,
});

const engine = (over: Record<string, unknown> = {}) =>
  calculateFullEstimate({
    totalIncome: 530_000,
    w2Income: 530_000,
    seIncome: 0,
    preTaxDeductions: 0,
    retirement401k: 30_000,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "married_filing_jointly",
    lastYearTax: 0,
    ...over,
  } as any);

describe("SALT phase-down uses canonical AGI/MAGI", () => {
  it("does not phase down when canonical MAGI is below the threshold even though gross buckets are above it", () => {
    // Gross buckets $530k, canonical AGI $500k after $30k of 401(k).
    const r = engine({ itemizedInputs: saltInputs() });
    expect(r.agi).toBeLessThan(505_000);
    expect(r.deductionType).toBe("itemized");
    // Full statutory cap applied: $40,400 SALT (no phase-down).
    expect(r.deductionApplied).toBeCloseTo(SALT_CAP_2026, 2);
  });

  it("phases the cap down once canonical MAGI exceeds the threshold", () => {
    const r = engine({ totalIncome: 600_000, w2Income: 600_000, retirement401k: 0, itemizedInputs: saltInputs() });
    expect(r.agi).toBeGreaterThan(505_000);
    expect(r.deductionApplied).toBeLessThan(SALT_CAP_2026);
  });

  it("annualized (current-pace) MAGI drives its own SALT result", () => {
    const actual = resolveCanonicalDeduction({
      filingStatus: "married_filing_jointly",
      magi: 500_000,
      itemizedInputs: saltInputs(),
    });
    const annualized = resolveCanonicalDeduction({
      filingStatus: "married_filing_jointly",
      magi: 700_000,
      itemizedInputs: saltInputs(),
    });
    expect(actual.itemizedDeduction).toBeGreaterThan(annualized.itemizedDeduction);
  });
});

describe("persisted SALT cap override cannot change liability", () => {
  const rates: ItemizedSettingsRates = {
    filingStatus: "married_filing_jointly",
    deductionType: "standard",
    itemizedDeductionAmount: 0,
    itemizedDeductionsEnabled: true,
    saltPropertyTax: 30_000,
    saltStateIncomeTaxMode: "manual",
    saltStateIncomeTaxManual: 25_000,
    saltCapOverride: 99_000,
  };

  it("is dropped by the engine bridge", () => {
    const built = buildEngineItemizedInputs({ rates, stateWithheldEstimate: 0, hasFeatureAccess: true })!;
    expect((built as any).saltCapOverride).toBeUndefined();
    const r = engine({ itemizedInputs: built });
    expect(r.deductionApplied).toBeCloseTo(SALT_CAP_2026, 2);
  });
});

describe("the canonical engine is the final authority on standard vs itemized", () => {
  it("uses the standard deduction when itemized is lower", () => {
    const r = engine({
      itemizedInputs: saltInputs({ propertyTax: 1_000, stateIncomeTaxManual: 1_000 }),
    });
    expect(r.deductionType).toBe("standard");
    expect(r.deductionApplied).toBeCloseTo(STANDARD_DEDUCTION.married_filing_jointly, 2);
  });

  it("uses itemized when it is higher", () => {
    const r = engine({ itemizedInputs: saltInputs({ otherItemizedDeductions: 50_000 }) });
    expect(r.deductionType).toBe("itemized");
    expect(r.deductionApplied).toBeGreaterThan(STANDARD_DEDUCTION.married_filing_jointly);
  });

  it("callers cannot force an inferior flat itemized deduction", () => {
    const r = engine({ deductionType: "itemized", itemizedDeductionAmount: 1_000 });
    expect(r.deductionType).toBe("standard");
    expect(r.deductionApplied).toBeCloseTo(STANDARD_DEDUCTION.married_filing_jointly, 2);
  });

  it("still honours a legitimate legacy flat itemized amount", () => {
    const r = engine({ deductionType: "itemized", itemizedDeductionAmount: 60_000 });
    expect(r.deductionType).toBe("itemized");
    expect(r.deductionApplied).toBeCloseTo(60_000, 2);
  });
});

describe("married filing separately SALT limits", () => {
  it("applies the MFS cap, threshold and floor", () => {
    const below = resolveCanonicalDeduction({
      filingStatus: "married_filing_separately",
      magi: SALT_PHASEDOWN_THRESHOLD_2026_MFS - 1,
      itemizedInputs: saltInputs({ propertyTax: 40_000, stateIncomeTaxManual: 40_000 }),
    });
    expect(below.itemizedDetail!.effectiveCap).toBeCloseTo(SALT_CAP_2026_MFS, 2);

    const far = resolveCanonicalDeduction({
      filingStatus: "married_filing_separately",
      magi: 5_000_000,
      itemizedInputs: saltInputs({ propertyTax: 40_000, stateIncomeTaxManual: 40_000 }),
    });
    expect(far.itemizedDetail!.effectiveCap).toBeCloseTo(SALT_FLOOR_2026_MFS, 2);
  });

  it("prorates mortgage interest at the $375,000 MFS debt limit", () => {
    const r = resolveCanonicalDeduction({
      filingStatus: "married_filing_separately",
      magi: 200_000,
      itemizedInputs: saltInputs({ mortgageInterest: 30_000, mortgageBalance: 750_000 }),
    });
    expect(r.itemizedDetail!.mortgageInterestDeductible).toBeCloseTo(15_000, 2);
  });
});

describe("calculation-level Developer gating", () => {
  const rates: ItemizedSettingsRates = {
    filingStatus: "married_filing_jointly",
    deductionType: "standard",
    itemizedDeductionAmount: 0,
    itemizedDeductionsEnabled: true,
    saltPropertyTax: 30_000,
    saltStateIncomeTaxMode: "manual",
    saltStateIncomeTaxManual: 25_000,
  };

  it("developer access lets saved SALT settings affect the engine", () => {
    const built = buildEngineItemizedInputs({ rates, stateWithheldEstimate: 0, hasFeatureAccess: true });
    expect(built).toBeDefined();
    expect(engine({ itemizedInputs: built }).deductionType).toBe("itemized");
  });

  it("non-developer access ignores saved SALT settings without erasing them", () => {
    const built = buildEngineItemizedInputs({ rates, stateWithheldEstimate: 0, hasFeatureAccess: false });
    expect(built).toBeUndefined();
    expect(engine({ itemizedInputs: built }).deductionType).toBe("standard");
    // Persisted values are untouched by the gate.
    expect(rates.saltPropertyTax).toBe(30_000);
  });

  it("regaining access restores the saved settings", () => {
    const regained = buildEngineItemizedInputs({ rates, stateWithheldEstimate: 0, hasFeatureAccess: true });
    expect(regained!.propertyTax).toBe(30_000);
  });
});
