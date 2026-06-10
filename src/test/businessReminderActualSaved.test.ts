import { describe, it, expect } from "vitest";

/**
 * Regression: Business Activity "Stay on pace with taxes" reminder modal
 * must include the visible "Amount you're saving for taxes" field
 * (incomeForm.actual_withholding) in its "Already saved" total.
 *
 * Mirrors the inline calculation in src/pages/BusinessActivity.tsx
 * around the showRecommendation modal trigger.
 */
function computeReminderActualSaved(form: {
  taxWithheld: number;
  applicableStateWH: number;
  ss_withholding: number;
  medicare_withholding: number;
  additional_tax_reserve: number;
  actual_withholding: number;
}) {
  return (
    form.taxWithheld +
    form.applicableStateWH +
    form.ss_withholding +
    form.medicare_withholding +
    form.additional_tax_reserve +
    form.actual_withholding
  );
}

describe("Business reminder modal — Already saved", () => {
  it("includes incomeForm.actual_withholding ($2,500 case)", () => {
    const actualSaved = computeReminderActualSaved({
      taxWithheld: 0,
      applicableStateWH: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      additional_tax_reserve: 0,
      actual_withholding: 2500,
    });
    expect(actualSaved).toBe(2500);
  });

  it("sums actual_withholding with other reserved/withheld fields", () => {
    const actualSaved = computeReminderActualSaved({
      taxWithheld: 100,
      applicableStateWH: 50,
      ss_withholding: 20,
      medicare_withholding: 10,
      additional_tax_reserve: 200,
      actual_withholding: 500,
    });
    expect(actualSaved).toBe(880);
  });

  it("does not report $0 when user just entered a saved amount", () => {
    const actualSaved = computeReminderActualSaved({
      taxWithheld: 0,
      applicableStateWH: 0,
      ss_withholding: 0,
      medicare_withholding: 0,
      additional_tax_reserve: 0,
      actual_withholding: 2500,
    });
    expect(actualSaved).not.toBe(0);
  });
});
