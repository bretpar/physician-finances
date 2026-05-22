import { describe, it, expect } from "vitest";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { computeAllocations, type EmployerRow } from "@/components/tax/W4PaycheckAdjustmentCard";

/**
 * Per-paycheck recommendation MUST stay independent from the annual W-4 gap.
 *
 *   per-paycheck recommended extra
 *     = gross_taxable × selected_effective_rate
 *       − payroll withholding on this paycheck
 *       − actual amount saved for this paycheck
 *
 * The W-4 card operates on an annual remaining gap and may be $0 even when
 * an individual paycheck still has a positive per-check target.
 */
describe("Per-paycheck vs W-4 independence", () => {
  it("per-paycheck formula = gross × ETR − withholding − saved", () => {
    const r = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 5000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 25, // 25%
      totalFederalPayrollTaxes: 800,
      stateWithholdingIfEnabled: 200,
      additionalTaxReserveForThisEntry: 100,
    });
    // target = 5000 * 0.25 = 1250
    // remaining = 1250 - (800 + 200) - 100 = 150
    expect(r.paycheckTaxTarget).toBeCloseTo(1250, 2);
    expect(r.remainingSavingsNeeded).toBeCloseTo(150, 2);
  });

  it("paycheck recommendation is unaffected by annual W-4 gap being $0", () => {
    // Even when the annual W-4 gap is fully covered, an individual paycheck
    // with under-withholding still recommends extra savings on THAT check.
    const paycheck = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 4000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 22,
      totalFederalPayrollTaxes: 500,
      stateWithholdingIfEnabled: 0,
      additionalTaxReserveForThisEntry: 0,
    });
    // target = 880, withheld = 500 → 380 extra recommended
    expect(paycheck.remainingSavingsNeeded).toBeCloseTo(380, 2);

    // W-4 annual gap = 0 → no Step 4(c) extra at the W-4 level
    const rows: EmployerRow[] = [
      {
        streamId: "emp:a|w2",
        company: "A",
        payFrequency: "biweekly",
        remainingPaychecks: 10,
        remainingGross: 40000,
        expectedNormalWithholding: 5000,
      },
    ];
    const alloc = computeAllocations(rows, 0, 40000);
    expect(alloc[0].step4cPerPaycheck).toBe(0);

    // The two outputs are produced by independent code paths; the W-4 zero
    // does not override or zero out the per-paycheck recommendation.
    expect(paycheck.remainingSavingsNeeded).toBeGreaterThan(0);
  });

  it("W-4 allocation uses only the annual remaining gap", () => {
    const rows: EmployerRow[] = [
      {
        streamId: "emp:a|w2",
        company: "A",
        payFrequency: "biweekly",
        remainingPaychecks: 10,
        remainingGross: 50000,
        expectedNormalWithholding: 0,
      },
    ];
    const alloc = computeAllocations(rows, 2000, 50000);
    // ~200/paycheck (rounded to $5)
    expect(alloc[0].step4cPerPaycheck % 5).toBe(0);
    expect(alloc[0].step4cPerPaycheck).toBeGreaterThan(0);
    // Total covered should be near the annual gap, not multiplied per check.
    const covered =
      alloc[0].step4cPerPaycheck * alloc[0].remainingPaychecks;
    expect(Math.abs(covered - 2000)).toBeLessThanOrEqual(5);
  });
});
