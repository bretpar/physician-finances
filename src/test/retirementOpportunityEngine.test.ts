/**
 * Focused coverage for the canonical Retirement Opportunity Engine (Phase 1).
 * 2026 rules: $24,500 §402(g), $72,000 §415(c), $360,000 comp cap,
 * $17,000 SIMPLE, $7,500 IRA, separate governmental 457(b) bucket.
 */
import { describe, it, expect } from "vitest";
import {
  computeRetirementOpportunity,
  computeIraOpportunity,
  countContributionOccurrences,
  annualizeRetirementContribution,
  reducedSelfEmployedRate,
  projectedNetBusinessProfit,
  getRetirementRules,
  type PlanOpportunityInput,
} from "@/lib/retirementOpportunityEngine";

const YEAR = 2026;
const dobForAge = (age: number) => `${YEAR - age}-06-15`;

const plan = (over: Partial<PlanOpportunityInput> = {}): PlanOpportunityInput => ({
  planKind: "401k",
  entityKind: "w2",
  companyName: "Employer",
  employeeContribution: 0,
  employerContribution: 0,
  ...over,
});

describe("employee elective-deferral buckets", () => {
  it("two W-2 401(k)s share ONE $24,500 employee bucket", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({ companyName: "A", employeeContribution: 10_000 }),
        plan({ companyName: "B", employeeContribution: 8_000 }),
      ],
    });
    expect(r.employee402g.contributed).toBe(18_000);
    expect(r.employee402g.limit).toBe(24_500);
    expect(r.employee402g.remaining).toBe(6_500);
  });

  it("W-2 401(k) + Solo 401(k) employee money share the same limit", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({ employeeContribution: 15_000 }),
        plan({ planKind: "solo_401k", entityKind: "schedule_c", employeeContribution: 9_500, netBusinessProfit: 200_000 }),
      ],
    });
    expect(r.employee402g.contributed).toBe(24_500);
    expect(r.employee402g.remaining).toBe(0);
  });

  it("governmental 457(b) gets its own separate bucket", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({ employeeContribution: 24_500 }),
        plan({ planKind: "governmental_457b", companyName: "Hospital 457", employeeContribution: 10_000 }),
      ],
    });
    expect(r.employee402g.contributed).toBe(24_500);
    expect(r.governmental457b?.contributed).toBe(10_000);
    expect(r.governmental457b?.limit).toBe(24_500);
    expect(r.governmental457b?.remaining).toBe(14_500);
  });

  it("applies the correct catch-up at ages 49, 50, 59, 60, 63 and 64", () => {
    const limitAt = (age: number) =>
      computeRetirementOpportunity({ taxYear: YEAR, dateOfBirth: dobForAge(age), plans: [plan()] })
        .employee402g.limit;
    expect(limitAt(49)).toBe(24_500);
    expect(limitAt(50)).toBe(32_500);
    expect(limitAt(59)).toBe(32_500);
    expect(limitAt(60)).toBe(35_750);
    expect(limitAt(63)).toBe(35_750);
    expect(limitAt(64)).toBe(32_500);
  });

  it("SIMPLE uses its own $17,000 limit and catch-ups, not the 401(k) limit", () => {
    const simpleBucket = (age?: number) =>
      computeRetirementOpportunity({
        taxYear: YEAR,
        dateOfBirth: age ? dobForAge(age) : null,
        plans: [plan({ planKind: "simple_ira", employeeContribution: 5_000 })],
      }).simple!;
    expect(simpleBucket().limit).toBe(17_000);
    expect(simpleBucket(52).limit).toBe(21_000);
    expect(simpleBucket(61).limit).toBe(22_250);
  });

  it("SIMPLE deferrals still consume the cross-plan employee limit", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({ employeeContribution: 10_000 }),
        plan({ planKind: "simple_401k", employeeContribution: 10_000 }),
      ],
    });
    expect(r.employee402g.remaining).toBe(4_500);
  });
});

describe("IRA contribution room and deductibility", () => {
  const ira = (over: Parameters<typeof computeIraOpportunity>[0] extends never ? never : Partial<Parameters<typeof computeIraOpportunity>[0]>) =>
    computeIraOpportunity({
      taxYear: YEAR,
      age: null,
      filingStatus: "single",
      magi: 50_000,
      coveredByWorkplacePlan: true,
      spouseCoveredByWorkplacePlan: null,
      eligibleTaxableCompensation: 300_000,
      traditionalContributed: 0,
      rothContributed: 0,
      ...over,
    });

  it("Traditional IRA fully deductible below the phaseout", () => {
    const r = ira({ traditionalContributed: 7_500, magi: 60_000 });
    expect(r.traditionalDeductible).toBe(7_500);
    expect(r.traditionalNondeductible).toBe(0);
  });

  it("Traditional IRA partially deductible inside the 2026 phaseout", () => {
    const r = ira({ traditionalContributed: 7_500, magi: 86_000 });
    expect(r.traditionalDeductible).toBeGreaterThan(0);
    expect(r.traditionalDeductible).toBeLessThan(7_500);
    expect(r.traditionalDeductible % 10).toBe(0);
    expect(r.traditionalNondeductible).toBeCloseTo(7_500 - r.traditionalDeductible, 2);
    expect(r.reasons).toContain("traditional_ira_magi_phaseout");
  });

  it("Traditional IRA not deductible above the phaseout", () => {
    const r = ira({ traditionalContributed: 7_500, magi: 200_000 });
    expect(r.traditionalDeductible).toBe(0);
    expect(r.traditionalNondeductible).toBe(7_500);
  });

  it("MFJ uncovered contributor with a covered spouse uses the higher range", () => {
    const below = ira({
      filingStatus: "married_filing_jointly",
      coveredByWorkplacePlan: false,
      spouseCoveredByWorkplacePlan: true,
      traditionalContributed: 7_500,
      magi: 200_000,
    });
    expect(below.traditionalDeductible).toBe(7_500);

    const above = ira({
      filingStatus: "married_filing_jointly",
      coveredByWorkplacePlan: false,
      spouseCoveredByWorkplacePlan: true,
      traditionalContributed: 7_500,
      magi: 260_000,
    });
    expect(above.traditionalDeductible).toBe(0);
  });

  it("no workplace-plan coverage at all → no MAGI phaseout", () => {
    const r = ira({
      coveredByWorkplacePlan: false,
      spouseCoveredByWorkplacePlan: false,
      traditionalContributed: 7_500,
      magi: 900_000,
    });
    expect(r.traditionalDeductible).toBe(7_500);
  });

  it("Roth direct eligibility: full, partial and zero", () => {
    expect(ira({ magi: 100_000 }).rothAllowed).toBe(7_500);
    const partial = ira({ magi: 160_000 });
    expect(partial.rothAllowed).toBeGreaterThan(0);
    expect(partial.rothAllowed).toBeLessThan(7_500);
    expect(partial.reasons).toContain("roth_ira_magi_phaseout");
    expect(ira({ magi: 200_000 }).rothAllowed).toBe(0);
  });

  it("low compensation caps IRA contribution room", () => {
    const r = ira({ eligibleTaxableCompensation: 3_000, magi: 40_000 });
    expect(r.combinedLimit).toBe(3_000);
    expect(r.remainingContributionRoom).toBe(3_000);
    expect(r.reasons).toContain("insufficient_taxable_compensation");
  });

  it("Traditional + Roth cannot exceed the combined IRA room", () => {
    const r = ira({ traditionalContributed: 5_000, rothContributed: 2_500, magi: 60_000 });
    expect(r.combinedContributed).toBe(7_500);
    expect(r.remainingContributionRoom).toBe(0);
    expect(r.rothRemaining).toBe(0);
  });

  it("age 50+ adds the $1,100 IRA catch-up", () => {
    expect(ira({ age: 55, magi: 40_000 }).combinedLimit).toBe(8_600);
  });
});

describe("employer / self-employed contribution capacity", () => {
  it("Schedule C Solo 401(k) employer capacity uses self-employed earned income", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          planKind: "solo_401k",
          entityKind: "schedule_c",
          employeeContribution: 24_500,
          netBusinessProfit: 200_000,
          deductibleHalfSeTax: 10_000,
          employerContributionRate: 0.25,
        }),
      ],
    });
    const p = r.plans[0];
    // (200,000 − 10,000) × 20% = 38,000, well under remaining §415(c) room.
    expect(reducedSelfEmployedRate(0.25)).toBeCloseTo(0.2, 10);
    expect(p.employerCapacityRemaining).toBeCloseTo(38_000, 2);
    expect(p.reasons).toContain("self_employed_employer_formula");
  });

  it("SEP for a Schedule C owner uses the same earned-income concepts", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          planKind: "sep_ira",
          entityKind: "schedule_c",
          netBusinessProfit: 100_000,
          deductibleHalfSeTax: 7_000,
        }),
      ],
    });
    expect(r.plans[0].employerCapacityRemaining).toBeCloseTo(93_000 * 0.2, 2);
    expect(r.plans[0].deferralBucket).toBe("none");
  });

  it("S-corp capacity uses W-2 wages, never distributions", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          planKind: "401k",
          entityKind: "s_corp",
          w2Wages: 100_000,
          netBusinessProfit: 400_000, // distributions — must be ignored
          employerContributionRate: 0.25,
        }),
      ],
    });
    expect(r.plans[0].employerCapacityRemaining).toBe(25_000);
    expect(r.plans[0].eligibleCompensation).toBe(100_000);
  });

  it("W-2 plan with an unknown formula never fabricates employer opportunity", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [plan({ w2Wages: 300_000, employeeContribution: 10_000, employerContribution: 5_000 })],
    });
    const p = r.plans[0];
    expect(p.employerCapacityRemaining).toBeNull();
    expect(p.reasons).toContain("unknown_plan_data");
    expect(p.employeeContribution).toBe(10_000);
    expect(p.employerContribution).toBe(5_000);
    expect(p.totalAdditions).toBe(15_000);
    expect(p.annualAdditionsLimit).toBe(getRetirementRules(YEAR).annualAdditions);
  });

  it("passive K-1 without service earned income returns unknown_plan_data", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [plan({ planKind: "solo_401k", entityKind: "partnership_k1", netBusinessProfit: 300_000 })],
    });
    expect(r.plans[0].employerCapacityRemaining).toBeNull();
    expect(r.plans[0].reasons).toContain("unknown_plan_data");
  });

  it("a zero-contribution eligible plan still shows an opportunity", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          planKind: "solo_401k",
          entityKind: "schedule_c",
          employeeContribution: 0,
          employerContribution: 0,
          netBusinessProfit: 150_000,
          deductibleHalfSeTax: 9_000,
          employerContributionRate: 0.25,
        }),
      ],
    });
    expect(r.plans.length).toBe(1);
    expect(r.employee402g.remaining).toBe(24_500);
    expect(r.plans[0].employerCapacityRemaining).toBeCloseTo(141_000 * 0.2, 2);
  });

  it("compensation below §415(c) caps annual additions", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          planKind: "solo_401k",
          entityKind: "schedule_c",
          netBusinessProfit: 30_000,
          deductibleHalfSeTax: 2_000,
          employerContributionRate: 0.25,
        }),
      ],
    });
    expect(r.plans[0].annualAdditionsLimit).toBe(28_000);
    expect(r.plans[0].reasons).toContain("compensation_limit");
  });
});

describe("tax routing categories", () => {
  it("separates employee pre-tax, self-employed employer, W-2 employer and IRA", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      magi: 60_000,
      filingStatus: "single",
      coveredByWorkplacePlan: true,
      eligibleTaxableCompensation: 300_000,
      plans: [
        plan({ employeeContribution: 12_000, employerContribution: 9_000 }), // W-2
        plan({
          planKind: "solo_401k",
          entityKind: "schedule_c",
          employeeContribution: 5_000,
          employerContribution: 20_000,
          netBusinessProfit: 200_000,
          deductibleHalfSeTax: 10_000,
          employerContributionRate: 0.25,
        }),
      ],
      ira: { traditionalContributed: 7_500, rothContributed: 0 },
    });
    expect(r.taxRouting.employeePreTaxDeduction).toBe(17_000);
    expect(r.taxRouting.selfEmployedEmployerDeduction).toBe(20_000);
    expect(r.taxRouting.w2EmployerExcluded).toBe(9_000);
    expect(r.taxRouting.traditionalIraDeduction).toBe(7_500);
    expect(r.taxRouting.rothDeduction).toBe(0);
  });

  it("Roth IRA is never a deduction and never routed into AGI", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      magi: 60_000,
      eligibleTaxableCompensation: 200_000,
      ira: { rothContributed: 7_500 },
    });
    expect(r.taxRouting.rothDeduction).toBe(0);
    expect(r.taxRouting.traditionalIraDeduction).toBe(0);
    expect(r.taxRouting.employeePreTaxDeduction).toBe(0);
  });

  it("only the deductible portion of a Traditional IRA is routed into tax math", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      filingStatus: "single",
      coveredByWorkplacePlan: true,
      magi: 86_000,
      eligibleTaxableCompensation: 200_000,
      ira: { traditionalContributed: 7_500 },
    });
    expect(r.taxRouting.traditionalIraDeduction).toBe(r.ira.traditionalDeductible);
    expect(r.taxRouting.traditionalIraDeduction).toBeLessThan(7_500);
  });
});

describe("projected business profit and contribution projections", () => {
  it("projected profit subtracts remaining planned expenses (never gross-only)", () => {
    expect(
      projectedNetBusinessProfit({
        actualYtdNetProfit: 100_000,
        remainingPlannedGrossIncome: 60_000,
        remainingPlannedExpenses: 15_000,
      }),
    ).toBe(145_000);
  });

  it("counts occurrences by real pay frequency for a full year", () => {
    expect(countContributionOccurrences({ taxYear: YEAR, payFrequency: "biweekly", startDate: `${YEAR}-01-02` })).toBe(26);
    expect(countContributionOccurrences({ taxYear: YEAR, payFrequency: "semimonthly" })).toBe(24);
    expect(countContributionOccurrences({ taxYear: YEAR, payFrequency: "monthly", startDate: `${YEAR}-01-15` })).toBe(12);
    expect(countContributionOccurrences({ taxYear: YEAR, payFrequency: "weekly", startDate: `${YEAR}-01-01` })).toBe(53);
  });

  it("respects start/end dates and partial-year schedules", () => {
    expect(
      countContributionOccurrences({
        taxYear: YEAR,
        payFrequency: "monthly",
        startDate: `${YEAR}-07-01`,
      }),
    ).toBe(6);
    expect(
      countContributionOccurrences({
        taxYear: YEAR,
        payFrequency: "semimonthly",
        startDate: `${YEAR}-01-01`,
        endDate: `${YEAR}-03-31`,
      }),
    ).toBe(6);
    expect(
      countContributionOccurrences({ taxYear: YEAR, payFrequency: "monthly", startDate: `${YEAR + 1}-01-01` }),
    ).toBe(0);
  });

  it("per-paycheck contributions follow the company schedule, not a blind ×26", () => {
    const semimonthly = annualizeRetirementContribution({
      amount: 1_000,
      frequency: "per_paycheck",
      taxYear: YEAR,
      payFrequency: "semi_monthly",
      startDate: `${YEAR}-01-01`,
    });
    expect(semimonthly.annual).toBe(24_000);
    expect(semimonthly.usedFallback).toBe(false);

    const weekly = annualizeRetirementContribution({
      amount: 500,
      frequency: "per_paycheck",
      taxYear: YEAR,
      payFrequency: "weekly",
      startDate: `${YEAR}-01-01`,
    });
    expect(weekly.occurrences).toBe(53);

    const monthly = annualizeRetirementContribution({
      amount: 1_000,
      frequency: "monthly",
      taxYear: YEAR,
      startDate: `${YEAR}-01-01`,
    });
    expect(monthly.annual).toBe(12_000);
  });

  it("documented fallback when the pay schedule is unknown", () => {
    const r = annualizeRetirementContribution({
      amount: 1_000,
      frequency: "per_paycheck",
      taxYear: YEAR,
      startDate: `${YEAR}-01-01`,
    });
    expect(r.payFrequency).toBe("biweekly");
    expect(r.usedFallback).toBe(true);
  });

  it("one-time contributions stay exact and respect the tax year", () => {
    expect(
      annualizeRetirementContribution({
        amount: 5_000,
        frequency: "one_time",
        taxYear: YEAR,
        contributionDate: `${YEAR}-03-01`,
      }).annual,
    ).toBe(5_000);
    expect(
      annualizeRetirementContribution({
        amount: 5_000,
        frequency: "one_time",
        taxYear: YEAR,
        contributionDate: `${YEAR - 1}-03-01`,
      }).annual,
    ).toBe(0);
  });

  it("payroll and standalone employee money are summed once, not double counted", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({ companyId: "a", employeeContribution: 12_000 }), // payroll
        plan({ companyId: "a", planKind: "solo_401k", entityKind: "schedule_c", employeeContribution: 3_000, netBusinessProfit: 50_000 }),
      ],
    });
    expect(r.employee402g.contributed).toBe(15_000);
    expect(r.taxRouting.employeePreTaxDeduction).toBe(15_000);
  });
});
