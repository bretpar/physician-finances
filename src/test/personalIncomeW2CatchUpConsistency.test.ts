/**
 * Personal Income W-2: preview, save reminder and reopened edit must agree
 * to the cent. Fixture: $10,000 W-2, $500 federal, $5,000 state, live
 * quarterly catch-up of $3,391.67 available.
 */
import { describe, it, expect } from "vitest";
import { computeCanonicalEventRecommendation } from "@/lib/canonicalEventRecommendation";
import { buildReminderComparison } from "@/lib/incomeRecommendationSurface";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import {
  buildPersonalPreviewInput,
  buildPersonalSaveInput,
  resolvePersonalPaycheckCatchUp,
} from "@/lib/personalIncomeRecommendationAdapters";

const LIVE_CATCH_UP = 3_391.67;
const settings: any = {
  withholdingMethod: "dynamic_actual", filingStatus: "single",
  stateIncomeTaxEnabled: true, w2PaycheckRecMethod: "paycheck_target",
};
const estimate: any = {
  seIncome: 0, grossBusinessIncome: 0, netBusinessProfit: 0,
  w2Income: 120_000, w2TaxableIncomeBase: 120_000, taxableIncome: 105_000,
  federalIncomeTax: 18_000, personalStateTax: 6_000, personalStateTaxGross: 6_000,
  totalTaxLiability: 24_000,
  seTax: { netSEIncome: 0, w2SsWagesUsed: 120_000, plannedW2SsWagesUsed: 0 },
};
const form = {
  gross_amount: "10000", income_type: "w2_user", federal_withholding: "500",
  ss_withholding: "", medicare_withholding: "", state_withholding: "5000",
  retirement_pretax: "", deductions_pre_tax: "", healthcare_deduction: "", hsa_contribution: "",
};
const ctx = { totalFederalPayrollTaxes: 500, stateIncomeTaxEnabled: true, isFutureOpportunity: true };

// Mirrors how each hook resolves an omitted catch-up (live quarter amount).
const canonicalFor = (catchUp: number | undefined, credited: number, state: number) =>
  computeCanonicalEventRecommendation({
    estimate, actualEstimate: estimate, taxSettings: settings,
    incomeType: "w2", incomeBucket: "personal", grossIncome: 10_000,
    creditedWithholding: credited, stateWithholding: state,
    catchUpAmount: catchUp != null ? catchUp : LIVE_CATCH_UP,
    isFutureOpportunity: true, w2FundingMethod: "paycheck_target",
    annualRemainingTax: 20_000, forceFlatRatePct: null, filingStatus: "single",
  } as any)!;

describe("Personal Income W-2 catch-up consistency", () => {
  const preview = buildPersonalPreviewInput(form, ctx);
  const save = buildPersonalSaveInput(form, ctx);

  it("preview and save adapters pass identical catch-up eligibility (0 for W-2)", () => {
    expect(preview.catchUpAmount).toBe(0);
    expect(save.catchUpAmount).toBe(0);
    expect(resolvePersonalPaycheckCatchUp("1099_schedule_c", false)).toBe(0);
  });

  it("preview card, after-save reminder and reopened edit agree to the cent", () => {
    const pc = canonicalFor(preview.catchUpAmount, preview.taxesAlreadyWithheld - preview.ficaWithheldNotCredited, preview.stateWithholding);
    const sc = canonicalFor(save.catchUpAmount, save.federalWithheld - save.ficaWithheldNotCredited, save.stateWithheld);
    expect(pc.catchUpApplied).toBe(0);
    expect(sc.catchUpApplied).toBe(0);

    const card = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 10_000, eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: pc.rateBreakdown.rate,
      federalIncomeTaxWithheld: 500, stateWithholdingIfEnabled: 5_000,
      stateTaxIncludedInTarget: true,
      stateTaxTargetForPaycheck: pc.target.personalStateTax + pc.target.businessStateTax,
      catchUpAmount: pc.catchUpApplied, isW2PaycheckTarget: true,
      canonicalPaycheckTaxTarget: pc.eventTaxTarget,
    });
    const reminder = buildReminderComparison({ ...sc, isFutureOpportunity: true });

    expect(card.remainingSavingsNeeded).toBe(reminder.additionalNeeded);
    expect(card.remainingSavingsNeeded).toBe(pc.recommendedWithholding);
    console.log("FIX", pc.eventTaxTarget, card.remainingSavingsNeeded, reminder.additionalNeeded, canonicalFor(undefined, 500, 5000).totalSuggestedReserve);
    expect(reminder.additionalNeeded).toBeGreaterThan(0);
  });
});
