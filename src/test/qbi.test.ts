// ============================================================================
// §199A QBI deduction — pure unit tests
// ============================================================================
// Focused on the phase-out math for SSTB entities and the aggregate
// taxable-income cap. Engine-level integration is verified via the
// Tax Validation Suite baseline (src/lib/taxValidation/expected.generated.json).
// ============================================================================

import { describe, it, expect } from "vitest";
import { computeQbiDeduction } from "@/lib/qbi";
import { QBI_THRESHOLDS } from "@/lib/taxBrackets";

const SINGLE_THRESHOLD = QBI_THRESHOLDS.single.threshold;
const SINGLE_PHASEIN = QBI_THRESHOLDS.single.phaseIn;
const MFJ_THRESHOLD = QBI_THRESHOLDS.married_filing_jointly.threshold;
const MFJ_PHASEIN = QBI_THRESHOLDS.married_filing_jointly.phaseIn;

describe("computeQbiDeduction — §199A", () => {
  it("returns zero when no entities are supplied", () => {
    const r = computeQbiDeduction({
      entities: [],
      taxableIncomeBeforeQbi: 100_000,
      netCapitalGain: 0,
      filingStatus: "single",
    });
    expect(r.totalDeduction).toBe(0);
    expect(r.perEntity).toEqual([]);
  });

  it("SSTB below threshold → full 20% up to taxable-income cap", () => {
    const r = computeQbiDeduction({
      entities: [{ id: "a", name: "A", isSSTB: true, qbi: 100_000 }],
      taxableIncomeBeforeQbi: SINGLE_THRESHOLD - 50_000,
      netCapitalGain: 0,
      filingStatus: "single",
    });
    expect(r.sstbApplicablePercentage).toBe(1);
    expect(r.preliminaryTotalDeduction).toBeCloseTo(20_000, 2);
    expect(r.totalDeduction).toBeCloseTo(20_000, 2);
    expect(r.cappedByTaxableIncome).toBe(false);
  });

  it("SSTB above phase-in ceiling → fully phased out", () => {
    const r = computeQbiDeduction({
      entities: [{ id: "a", name: "A", isSSTB: true, qbi: 100_000 }],
      taxableIncomeBeforeQbi: SINGLE_THRESHOLD + SINGLE_PHASEIN + 1,
      netCapitalGain: 0,
      filingStatus: "single",
    });
    expect(r.sstbApplicablePercentage).toBe(0);
    expect(r.totalDeduction).toBe(0);
    expect(r.perEntity[0].fullyPhasedOut).toBe(true);
  });

  it("SSTB inside phase-in range scales linearly (MFJ, halfway)", () => {
    const ti = MFJ_THRESHOLD + MFJ_PHASEIN / 2;
    const r = computeQbiDeduction({
      entities: [{ id: "a", name: "A", isSSTB: true, qbi: 100_000 }],
      taxableIncomeBeforeQbi: ti,
      netCapitalGain: 0,
      filingStatus: "married_filing_jointly",
    });
    expect(r.sstbApplicablePercentage).toBeCloseTo(0.5, 6);
    // 100k * 0.5 * 20% = 10,000
    expect(r.preliminaryTotalDeduction).toBeCloseTo(10_000, 2);
  });

  it("aggregate taxable-income limit binds when preliminary exceeds 20% × (TI − NCG)", () => {
    // TI = 50k, NCG = 40k → cap = 20% × 10k = 2,000
    const r = computeQbiDeduction({
      entities: [{ id: "a", name: "A", isSSTB: false, qbi: 40_000 }],
      taxableIncomeBeforeQbi: 50_000,
      netCapitalGain: 40_000,
      filingStatus: "single",
    });
    expect(r.preliminaryTotalDeduction).toBeCloseTo(8_000, 2);
    expect(r.taxableIncomeLimit).toBeCloseTo(2_000, 2);
    expect(r.totalDeduction).toBeCloseTo(2_000, 2);
    expect(r.cappedByTaxableIncome).toBe(true);
  });

  it("non-SSTB entities ignore the SSTB phase-out (simplified model)", () => {
    const r = computeQbiDeduction({
      entities: [
        { id: "sstb", name: "Physician", isSSTB: true, qbi: 100_000 },
        { id: "biz", name: "Rental LLC", isSSTB: false, qbi: 100_000 },
      ],
      taxableIncomeBeforeQbi: MFJ_THRESHOLD + MFJ_PHASEIN + 1,
      netCapitalGain: 0,
      filingStatus: "married_filing_jointly",
    });
    // SSTB → phased out; non-SSTB → full 20% × 100k = 20,000
    expect(r.perEntity[0].entityDeduction).toBe(0);
    expect(r.perEntity[1].entityDeduction).toBeCloseTo(20_000, 2);
    expect(r.totalDeduction).toBeCloseTo(20_000, 2);
  });

  it("negative QBI is floored at zero per entity", () => {
    const r = computeQbiDeduction({
      entities: [{ id: "a", name: "A", isSSTB: true, qbi: -50_000 }],
      taxableIncomeBeforeQbi: 200_000,
      netCapitalGain: 0,
      filingStatus: "married_filing_jointly",
    });
    expect(r.totalDeduction).toBe(0);
  });

  it("multiple entities sum before taxable-income cap", () => {
    const r = computeQbiDeduction({
      entities: [
        { id: "1", name: "Sch C", isSSTB: true, qbi: 60_000 },
        { id: "2", name: "K-1", isSSTB: true, qbi: 40_000 },
      ],
      taxableIncomeBeforeQbi: 300_000,
      netCapitalGain: 0,
      filingStatus: "married_filing_jointly",
    });
    // Both below MFJ threshold ⇒ full 20% each; sum = 20k, cap = 60k, no cap.
    expect(r.perEntity).toHaveLength(2);
    expect(r.preliminaryTotalDeduction).toBeCloseTo(20_000, 2);
    expect(r.totalDeduction).toBeCloseTo(20_000, 2);
  });
});
