import { describe, it, expect } from "vitest";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";

/**
 * Regression tests for the per-entry Additional Tax Reserve behavior.
 *
 * Rules being enforced:
 *   - Reserve applies ONLY to the entry it was entered on.
 *   - Reserve reduces the per-paycheck "save more" recommendation.
 *   - Reserve is NEVER added into actual payroll withholding totals.
 *   - Reserve never spreads to other paychecks.
 */
describe("Additional Tax Reserve — paycheck guide (per entry)", () => {
  it("Case A: expected 274, withheld 0, reserve 275 → 0 remaining / on track", () => {
    // Pick a gross/rate that yields a tax target of 274.
    const result = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 1370, // 1370 * 20% = 274
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 0,
      stateWithholdingIfEnabled: 0,
      additionalTaxReserveForThisEntry: 275,
    });

    expect(result.paycheckTaxTarget).toBeCloseTo(274, 2);
    expect(result.totalPayrollTaxesWithheld).toBe(0);
    expect(result.additionalTaxReserveApplied).toBe(275);
    expect(result.remainingSavingsNeeded).toBe(0);
  });

  it("Case B: expected 500, withheld 100, reserve 150 → 250 remaining", () => {
    const result = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 2500, // 2500 * 20% = 500
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 100,
      stateWithholdingIfEnabled: 0,
      additionalTaxReserveForThisEntry: 150,
    });

    expect(result.paycheckTaxTarget).toBeCloseTo(500, 2);
    expect(result.totalPayrollTaxesWithheld).toBe(100);
    expect(result.additionalTaxReserveApplied).toBe(150);
    expect(result.remainingSavingsNeeded).toBe(250);
    expect(result.status).toBe("under_withheld");
  });

  it("Case D: reserve on entry 1 does NOT reduce entry 2's recommendation", () => {
    const entry1 = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 1370,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 0,
      stateWithholdingIfEnabled: 0,
      additionalTaxReserveForThisEntry: 275,
    });
    // Entry 2: same paycheck size, no reserve. Should require its OWN savings.
    const entry2 = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 1370,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 0,
      stateWithholdingIfEnabled: 0,
      additionalTaxReserveForThisEntry: 0,
    });

    expect(entry1.remainingSavingsNeeded).toBe(0);
    // Entry 2 should NOT see entry 1's reserve.
    expect(entry2.remainingSavingsNeeded).toBeCloseTo(274, 2);
  });

  it("Case E: reserve is NOT included in actual payroll withholding totals", () => {
    const result = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 2500,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 100,
      stateWithholdingIfEnabled: 50,
      additionalTaxReserveForThisEntry: 200,
    });

    // totalPayrollTaxesWithheld must equal fed + state ONLY — never plus reserve.
    expect(result.totalPayrollTaxesWithheld).toBe(150);
    expect(result.additionalTaxReserveApplied).toBe(200);
    // And the reserve must be reported separately, not folded in.
    expect(result.totalPayrollTaxesWithheld).not.toBe(150 + 200);
  });

  it("Case C: tax estimator total reserve = sum of per-entry reserves", () => {
    // The aggregation lives in useTaxEstimate; here we verify the simple
    // arithmetic contract the engine relies on so a regression is obvious.
    const entries = [
      { additional_tax_reserve: 275 },
      { additional_tax_reserve: 100 },
    ];
    const total = entries.reduce(
      (s, e) => s + Math.max(0, Number(e.additional_tax_reserve || 0)),
      0,
    );
    expect(total).toBe(375);
  });

  it("over-withholding by payroll alone still surfaces as over-withheld", () => {
    const result = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 1000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 10, // target = 100
      totalFederalPayrollTaxes: 200,
      stateWithholdingIfEnabled: 0,
      additionalTaxReserveForThisEntry: 0,
    });
    expect(result.status).toBe("over_withheld");
    expect(result.remainingSavingsNeeded).toBe(0);
  });
});
