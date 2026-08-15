import { describe, it, expect } from "vitest";
import {
  computeCatchUpRecommendation,
  countRemainingOpportunities,
} from "@/lib/catchUpRecommendation";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { buildQuarterRecommendation } from "@/lib/quarterRecommendation";

const Y = 2026;

describe("FICA is never credited against the income-tax target", () => {
  it("SS/Medicare do not reduce the per-paycheck recommendation", () => {
    const r = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 10_000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20, // target = 2,000
      federalIncomeTaxWithheld: 500,
      socialSecurityAndMedicareWithheld: 765,
      stateWithholdingIfEnabled: 0,
    });
    expect(r.paycheckTaxTarget).toBe(2_000);
    expect(r.federalIncomeTaxCredited).toBe(500);
    expect(r.payrollTaxesInformational).toBe(765);
    // 2,000 - 500 (NOT 2,000 - 1,265)
    expect(r.remainingSavingsNeeded).toBe(1_500);
  });

  it("derives the income-tax portion when only a combined total + split is given", () => {
    const r = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 10_000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 1_265,
      socialSecurityAndMedicareWithheld: 765,
      stateWithholdingIfEnabled: 0,
    });
    expect(r.federalIncomeTaxCredited).toBe(500);
    expect(r.remainingSavingsNeeded).toBe(1_500);
  });

  it("legacy callers with no split keep the old credit behavior", () => {
    const r = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 10_000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      totalFederalPayrollTaxes: 500,
      stateWithholdingIfEnabled: 0,
    });
    expect(r.totalPayrollTaxesWithheld).toBe(500);
    expect(r.remainingSavingsNeeded).toBe(1_500);
  });
});

describe("state tax treatment is symmetric", () => {
  it("paycheck: state withholding is credited only when state tax is in the target", () => {
    const base = {
      grossPaycheckIncome: 10_000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      federalIncomeTaxWithheld: 500,
      stateWithholdingIfEnabled: 300,
    };
    expect(
      calculatePaycheckProfileSavings({ ...base, stateTaxIncludedInTarget: true })
        .remainingSavingsNeeded,
    ).toBe(1_200);
    expect(
      calculatePaycheckProfileSavings({ ...base, stateTaxIncludedInTarget: false })
        .remainingSavingsNeeded,
    ).toBe(1_500);
  });

  it("quarterly: state withholding counts as Paid only when included in the target", () => {
    const personalEntries = [
      {
        income_date: `${Y}-05-01`,
        gross_amount: 20_000,
        federal_withholding: 2_000,
        state_withholding: 500,
        ss_withholding: 1_240,
        medicare_withholding: 290,
      },
    ];
    const withState = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries,
      stateIncomeTaxIncludedInTarget: true,
      now: new Date(Y, 4, 20),
    });
    const withoutState = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      personalEntries,
      now: new Date(Y, 4, 20),
    });
    expect(withState.paidThisQuarter).toBe(2_500);
    expect(withoutState.paidThisQuarter).toBe(2_000);
    // FICA is reported but never credited in either mode.
    expect(withState.payrollTaxesHandledThisQuarter).toBe(1_530);
    expect(withState.paidThisQuarter).not.toBe(4_030);
  });
});

describe("business / 1099 Paid path", () => {
  it("counts withholding + reserves on business entries with no linked bank transaction", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      incomeEntries: [
        {
          income_date: `${Y}-05-01`,
          company: "Locums LLC",
          federal_withholding: 1_000,
          additional_tax_reserve: 500,
        },
      ],
      now: new Date(Y, 4, 20),
    });
    expect(r.otherWithheldThisQuarter).toBe(1_000);
    expect(r.paidThisQuarter).toBe(1_000);
    expect(r.savedThisQuarter).toBe(500);
  });

  it("still skips an entry whose linked transaction is missing/excluded", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 40_000,
      year: Y,
      quarter: 2,
      incomeEntries: [
        {
          income_date: `${Y}-05-01`,
          linked_transaction_id: "gone",
          federal_withholding: 1_000,
        },
      ],
      transactions: [],
      now: new Date(Y, 4, 20),
    });
    expect(r.paidThisQuarter).toBe(0);
  });
});

describe("prospective catch-up", () => {
  it("spreads the shortfall across remaining paychecks only", () => {
    const c = computeCatchUpRecommendation({
      quarterTarget: 10_000,
      coveredSoFar: 4_000,
      remainingOpportunities: 3,
    });
    expect(c.totalShortfallByDeadline).toBe(6_000);
    expect(c.quarterlyAdjustmentAmount).toBe(2_000);
    expect(c.recommendationStatus).toBe("catch_up_needed");
    expect(c.legacyStatus).toBe("behind");
  });

  it("is zero when the user is on track or ahead", () => {
    expect(
      computeCatchUpRecommendation({ quarterTarget: 10_000, coveredSoFar: 9_800 })
        .quarterlyAdjustmentAmount,
    ).toBe(200);
    const ahead = computeCatchUpRecommendation({
      quarterTarget: 10_000,
      coveredSoFar: 11_000,
    });
    expect(ahead.quarterlyAdjustmentAmount).toBe(0);
    expect(ahead.recommendationStatus).toBe("ahead");
  });

  it("labels a raised estimate as 'estimate increased', not 'behind'", () => {
    const c = computeCatchUpRecommendation({
      quarterTarget: 12_000,
      coveredSoFar: 10_000,
      baselineQuarterTarget: 10_000,
      remainingOpportunities: 2,
    });
    expect(c.recommendationStatus).toBe("estimate_increased");
    expect(c.legacyStatus).toBe("on_track");
    expect(c.statusDetail).toMatch(/estimate increased/i);
    expect(c.quarterlyAdjustmentAmount).toBe(1_000);
  });

  it("never divides by zero opportunities", () => {
    const c = computeCatchUpRecommendation({
      quarterTarget: 4_000,
      coveredSoFar: 0,
      remainingOpportunities: 0,
    });
    expect(c.remainingOpportunities).toBe(1);
    expect(c.quarterlyAdjustmentAmount).toBe(4_000);
  });

  it("counts only future paychecks up to the deadline", () => {
    const now = new Date(Y, 4, 10);
    const deadline = new Date(Y, 5, 15);
    expect(
      countRemainingOpportunities(
        [
          { date: `${Y}-05-01` }, // past
          { date: `${Y}-05-15` },
          { date: `${Y}-06-01` },
          { date: `${Y}-07-01` }, // after deadline
        ],
        now,
        deadline,
      ),
    ).toBe(2);
  });

  it("catch-up raises the paycheck recommendation so recovery is possible", () => {
    const withCatchUp = calculatePaycheckProfileSavings({
      grossPaycheckIncome: 10_000,
      eligiblePreTaxDeductions: 0,
      selectedProfileEffectiveTaxRate: 20,
      federalIncomeTaxWithheld: 0,
      stateWithholdingIfEnabled: 0,
      catchUpAmount: 500,
    });
    expect(withCatchUp.paycheckTaxTarget).toBe(2_000);
    expect(withCatchUp.catchUpApplied).toBe(500);
    expect(withCatchUp.totalTargetWithCatchUp).toBe(2_500);
    expect(withCatchUp.remainingSavingsNeeded).toBe(2_500);
  });
});

describe("full compliance ⇒ never labeled behind", () => {
  it("a user who saves 100% of every recommendation ends the quarter on track", () => {
    const target = 12_000;
    // 6 biweekly paychecks in the quarter, $20k gross each, 20% profile rate,
    // $1,000 federal income tax + $1,530 FICA withheld per paycheck.
    let covered = 0;
    const reserves: number[] = [];
    for (let i = 0; i < 6; i++) {
      const remaining = 6 - i;
      const catchUp = computeCatchUpRecommendation({
        quarterTarget: target,
        coveredSoFar: covered,
        remainingOpportunities: remaining,
      });
      const rec = calculatePaycheckProfileSavings({
        grossPaycheckIncome: 20_000,
        eligiblePreTaxDeductions: 0,
        selectedProfileEffectiveTaxRate: 10, // 2,000 target/paycheck
        federalIncomeTaxWithheld: 1_000,
        socialSecurityAndMedicareWithheld: 1_530,
        stateWithholdingIfEnabled: 0,
        stateTaxIncludedInTarget: false,
        catchUpAmount: 0, // the loop below applies the catch-up explicitly
      });
      // The user saves exactly what was recommended, plus the catch-up share.
      const saved = rec.remainingSavingsNeeded + catchUp.quarterlyAdjustmentAmount;
      reserves.push(saved);
      covered += rec.federalIncomeTaxCredited + saved;
    }

    // Every dollar counted came from federal income tax + reserves — no FICA.
    expect(covered).toBeGreaterThanOrEqual(target * 0.95);
    const final = computeCatchUpRecommendation({
      quarterTarget: target,
      coveredSoFar: covered,
    });
    expect(final.legacyStatus).not.toBe("behind");
    expect(["on_track", "ahead"]).toContain(final.recommendationStatus);
    expect(reserves.every((r) => r >= 0)).toBe(true);
  });

  it("quarterly tracker agrees: reserves saved per recommendation reach savedThisQuarter", () => {
    const r = buildQuarterRecommendation({
      annualTaxLiability: 48_000, // even mode → 12,000/quarter
      year: Y,
      quarter: 2,
      personalEntries: [
        {
          income_date: `${Y}-04-15`,
          gross_amount: 20_000,
          federal_withholding: 3_000,
          ss_withholding: 1_240,
          medicare_withholding: 290,
          additional_tax_reserve: 3_000,
        },
        {
          income_date: `${Y}-05-15`,
          gross_amount: 20_000,
          federal_withholding: 3_000,
          ss_withholding: 1_240,
          medicare_withholding: 290,
          additional_tax_reserve: 3_000,
        },
      ],
      now: new Date(Y, 4, 20),
    });
    expect(r.paidThisQuarter).toBe(6_000);
    expect(r.savedThisQuarter).toBe(6_000);
    expect(r.progressAmount).toBe(12_000);
    expect(r.recommendedQuarterlyPayment).toBe(0);
    expect(r.coverageStatus).toBe("on_track");
    expect(r.catchUpPerOpportunity).toBe(0);
    // Payroll taxes are reported separately and never inflate progress.
    expect(r.payrollTaxesHandledThisQuarter).toBe(3_060);
  });
});
