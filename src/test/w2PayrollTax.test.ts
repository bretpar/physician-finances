import { describe, expect, it } from "vitest";
import {
  calcW2PayrollTax,
  EMPLOYEE_SS_RATE,
  EMPLOYEE_MEDICARE_RATE,
  ADDITIONAL_MEDICARE_RATE,
} from "@/lib/w2PayrollTax";

// Use explicit opts so these fixtures remain deterministic across tax-year bumps.
const SS_CAP = 176100; // 2025 base
const SINGLE_ADDL = 200000;
const MFJ_ADDL = 250000;

describe("W-2 payroll tax (employee FICA)", () => {
  it("under SS cap: SS taxes all wages, Medicare taxes all wages, no addl", () => {
    const wages = 100000;
    const r = calcW2PayrollTax(wages, "single", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ssTaxableWages).toBe(wages);
    expect(r.ssWagesAboveCap).toBe(0);
    expect(r.ssCapReached).toBe(false);
    expect(r.ssTax).toBeCloseTo(wages * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTaxableWages).toBe(wages);
    expect(r.medicareTax).toBeCloseTo(wages * EMPLOYEE_MEDICARE_RATE, 6);
    expect(r.additionalMedicareWages).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
  });

  it("at SS cap exactly: SS maxed, Medicare on full wages, no addl", () => {
    const r = calcW2PayrollTax(SS_CAP, "single", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ssTaxableWages).toBe(SS_CAP);
    expect(r.ssWagesAboveCap).toBe(0);
    expect(r.ssCapReached).toBe(true);
    expect(r.ssTax).toBeCloseTo(SS_CAP * EMPLOYEE_SS_RATE, 6);
    expect(r.medicareTax).toBeCloseTo(SS_CAP * EMPLOYEE_MEDICARE_RATE, 6);
  });

  it("over SS cap: SS capped, Medicare continues, addl kicks in above threshold (single)", () => {
    const wages = 300000;
    const r = calcW2PayrollTax(wages, "single", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: SINGLE_ADDL,
    });
    expect(r.ssCapReached).toBe(true);
    expect(r.ssTaxableWages).toBe(SS_CAP);
    expect(r.ssWagesAboveCap).toBe(wages - SS_CAP);
    expect(r.ssTax).toBeCloseTo(SS_CAP * EMPLOYEE_SS_RATE, 6);
    // Medicare continues on the full wages — this is the key audit assertion.
    expect(r.medicareTaxableWages).toBe(wages);
    expect(r.medicareTax).toBeCloseTo(wages * EMPLOYEE_MEDICARE_RATE, 6);
    // Additional Medicare on amount above single threshold.
    expect(r.additionalMedicareWages).toBe(wages - SINGLE_ADDL);
    expect(r.additionalMedicareTax).toBeCloseTo(
      (wages - SINGLE_ADDL) * ADDITIONAL_MEDICARE_RATE,
      6,
    );
  });

  it("MFJ threshold is higher: same wages may not trigger addl Medicare", () => {
    const wages = 240000;
    const r = calcW2PayrollTax(wages, "married_filing_jointly", {
      ssWageCap: SS_CAP,
      additionalMedicareThreshold: MFJ_ADDL,
    });
    expect(r.additionalMedicareWages).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
  });

  it("zero/negative wages produce zero taxes", () => {
    const r = calcW2PayrollTax(-5000, "single");
    expect(r.ficaWages).toBe(0);
    expect(r.ssTax).toBe(0);
    expect(r.medicareTax).toBe(0);
    expect(r.additionalMedicareTax).toBe(0);
    expect(r.totalPayrollTax).toBe(0);
  });
});
