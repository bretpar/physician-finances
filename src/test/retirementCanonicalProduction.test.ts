/**
 * Production integration tests: the canonical retirement engine is now the
 * source of truth. These exercise the SAME code paths production uses:
 *   Tax Savings retirement UI → `computeRetirementRoomView`
 *   tax deductions            → `computeRetirementOpportunity(...).taxRouting`
 *   annualization             → `annualizeRetirementContribution`
 */
import { describe, it, expect } from "vitest";
import {
  computeRetirementOpportunity,
  computeIraOpportunity,
  annualizeRetirementContribution,
} from "@/lib/retirementOpportunityEngine";
import { computeRetirementRoomView } from "@/lib/retirementRoomView";
import { dedupeRetirementSources } from "@/lib/retirementCanonicalInput";

const YEAR = 2026;
const dobForAge = (age: number) => `${YEAR - age}-04-01`;

/* ───────────────────────── Room view (Tax Savings) ──────────────────────── */

describe("retirement room view uses the canonical engine", () => {
  const baseArgs = {
    taxYear: YEAR,
    companies: [
      { id: "c-w2", name: "Hospital", companyType: "w2" },
      { id: "c-gov", name: "County", companyType: "w2" },
      { id: "c-1099", name: "Locums LLC", companyType: "1099_schedule_c" },
    ],
    paychecks: [],
    standalone: [],
    ira: { traditionalContributed: 0, rothContributed: 0 },
  };

  it("keeps 401(k) and governmental 457(b) in separate deferral buckets", () => {
    const view = computeRetirementRoomView({
      ...baseArgs,
      standalone: [
        { id: "r1", companyId: "c-w2", accountType: "401k", contributionType: "employee", annualAmount: 24_500 },
        { id: "r2", companyId: "c-gov", accountType: "457b", contributionType: "employee", annualAmount: 10_000 },
      ],
    });
    expect(view.engine.employee402g.contributed).toBe(24_500);
    expect(view.engine.employee402g.remaining).toBe(0);
    expect(view.engine.governmental457b?.contributed).toBe(10_000);
    expect(view.engine.governmental457b?.remaining).toBe(14_500);
  });

  it("gives SIMPLE its own limit while consuming the shared deferral limit", () => {
    const view = computeRetirementRoomView({
      ...baseArgs,
      companies: [{ id: "c-s", name: "Clinic", companyType: "w2" }],
      standalone: [
        { id: "r1", companyId: "c-s", accountType: "simple_ira", contributionType: "employee", annualAmount: 5_000 },
      ],
    });
    expect(view.engine.simple?.limit).toBe(17_000);
    expect(view.engine.simple?.remaining).toBe(12_000);
    // The SIMPLE deferral still consumes cross-plan §402(g) room.
    expect(view.engine.employee402g.remaining).toBe(24_500 - 5_000);
  });

  it("surfaces a plan with zero contributions instead of hiding it", () => {
    const view = computeRetirementRoomView(baseArgs);
    expect(view.zeroContributionCompanyIds).toContain("c-1099");
    expect(view.plans.some((p) => p.companyId === "c-1099")).toBe(true);
  });
});

/* ─────────────────────────────── IRA rules ──────────────────────────────── */

describe("IRA deductibility", () => {
  const base = {
    taxYear: YEAR,
    age: 40,
    filingStatus: "single" as const,
    coveredByWorkplacePlan: true,
    spouseCoveredByWorkplacePlan: null,
    eligibleTaxableCompensation: 200_000,
    rothContributed: 0,
  };

  it("fully deducts a $1,000 Traditional contribution at the phaseout midpoint", () => {
    // 2026 covered-single range 81k–91k; midpoint phased ceiling ≈ $3,750.
    const r = computeIraOpportunity({ ...base, magi: 86_000, traditionalContributed: 1_000 });
    expect(r.traditionalDeductibleCeiling).toBeGreaterThanOrEqual(3_750);
    expect(r.traditionalDeductible).toBe(1_000);
    expect(r.traditionalNondeductible).toBe(0);
  });

  it("makes no deduction assumption when MAGI is missing", () => {
    const r = computeIraOpportunity({ ...base, magi: null, traditionalContributed: 7_500 });
    expect(r.traditionalDeductible).toBe(0);
    expect(r.deductibilityUnknown).toBe(true);
    expect(r.reasons).toContain("magi_unknown");
  });

  it("reports unknown capacity when eligible compensation is missing", () => {
    const r = computeIraOpportunity({
      ...base,
      eligibleTaxableCompensation: null,
      magi: 50_000,
      traditionalContributed: 0,
    });
    expect(r.capacityUnknown).toBe(true);
    expect(r.combinedLimit).toBeNull();
    expect(r.remainingContributionRoom).toBeNull();
    expect(r.reasons).toContain("compensation_unknown");
  });

  it("applies the $0–$10,000 MFS range when the taxpayer lived with their spouse", () => {
    const r = computeIraOpportunity({
      ...base,
      filingStatus: "married_filing_separately",
      livedWithSpouseDuringYear: true,
      magi: 20_000,
      traditionalContributed: 5_000,
    });
    expect(r.traditionalDeductible).toBe(0);
    expect(r.reasons).toContain("traditional_ira_magi_phaseout");
  });

  it("treats MFS as single when the taxpayer did not live with their spouse", () => {
    const r = computeIraOpportunity({
      ...base,
      filingStatus: "married_filing_separately",
      livedWithSpouseDuringYear: false,
      magi: 20_000,
      traditionalContributed: 5_000,
    });
    expect(r.traditionalDeductible).toBe(5_000);
  });

  it("returns unknown (not the favorable answer) when the MFS spouse fact is missing", () => {
    const r = computeIraOpportunity({
      ...base,
      filingStatus: "married_filing_separately",
      livedWithSpouseDuringYear: null,
      magi: 20_000,
      traditionalContributed: 5_000,
    });
    expect(r.deductibilityUnknown).toBe(true);
    expect(r.traditionalDeductible).toBe(0);
    expect(r.reasons).toContain("mfs_spouse_status_unknown");
  });

  it("honours the $200 minimum-deduction rule near the top of the range", () => {
    const r = computeIraOpportunity({ ...base, magi: 90_900, traditionalContributed: 7_500 });
    expect(r.traditionalDeductibleCeiling).toBe(200);
    expect(r.traditionalDeductible).toBe(200);
    expect(r.traditionalNondeductible).toBe(7_300);
  });
});

/* ───────────────────── §415(c) catch-up exclusion cap ───────────────────── */

describe("§415(c) annual additions vs actual permitted catch-up", () => {
  const planFor = (dob: string, employee: number) =>
    computeRetirementOpportunity({
      taxYear: YEAR,
      dateOfBirth: dob,
      plans: [
        {
          planId: "p1",
          companyId: "c1",
          companyName: "Practice",
          planKind: "solo_401k",
          entityKind: "schedule_c",
          employeeContribution: employee,
          employerContribution: 0,
          netBusinessProfit: 400_000,
        },
      ],
    }).plans[0];

  it("under 50: excess above the base limit stays inside annual additions", () => {
    const p = planFor(dobForAge(40), 26_000);
    expect(p.allowableCatchUp).toBe(0);
    expect(p.employeeTowardAnnualAdditions).toBe(26_000);
  });

  it("age 50: excludes at most the $8,000 catch-up", () => {
    const p = planFor(dobForAge(52), 24_500 + 9_000);
    expect(p.allowableCatchUp).toBe(8_000);
    expect(p.employeeTowardAnnualAdditions).toBe(24_500 + 1_000);
  });

  it("ages 60–63: excludes at most the $11,250 higher catch-up", () => {
    const p = planFor(dobForAge(61), 24_500 + 13_000);
    expect(p.allowableCatchUp).toBe(11_250);
    expect(p.employeeTowardAnnualAdditions).toBe(24_500 + 1_750);
  });
});

/* ──────────────────────────── SEP employee rows ─────────────────────────── */

describe("SEP IRA employee elective deferrals", () => {
  it("is not routed as a deductible employee deferral but stays visible", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      dateOfBirth: dobForAge(45),
      plans: [
        {
          planId: "sep",
          companyId: "c1",
          companyName: "Locums",
          planKind: "sep_ira",
          entityKind: "schedule_c",
          employeeContribution: 5_000,
          employerContribution: 0,
          netBusinessProfit: 200_000,
        },
      ],
    });
    expect(r.plans[0].employeeContribution).toBe(5_000); // visible for review
    expect(r.plans[0].employeeDeferralCounted).toBe(0);
    expect(r.plans[0].employeeContributionDisallowed).toBe(5_000);
    expect(r.plans[0].reasons).toContain("sep_employee_deferral_not_allowed");
    expect(r.taxRouting.employeePreTaxDeduction).toBe(0);
    expect(r.employee402g.contributed).toBe(0);
  });

  it("accepts the deferral only with explicit grandfathered SARSEP metadata", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      dateOfBirth: dobForAge(45),
      plans: [
        {
          planId: "sarsep",
          companyId: "c1",
          companyName: "Legacy",
          planKind: "sep_ira",
          entityKind: "schedule_c",
          employeeContribution: 5_000,
          employerContribution: 0,
          netBusinessProfit: 200_000,
          grandfatheredSarsep: true,
        },
      ],
    });
    expect(r.plans[0].employeeContributionDisallowed).toBe(0);
    expect(r.plans[0].employeeDeferralCounted).toBe(5_000);
  });
});

/* ─────────────────────────────── Projection ─────────────────────────────── */

describe("projected self-employed capacity", () => {
  const args = {
    taxYear: YEAR,
    dateOfBirth: dobForAge(40),
    companies: [{ id: "biz", name: "Locums LLC", companyType: "1099_schedule_c" }],
    paychecks: [],
    standalone: [
      { id: "r1", companyId: "biz", accountType: "solo_401k", contributionType: "employer", annualAmount: 0 },
    ],
    ira: { traditionalContributed: 0, rothContributed: 0 },
    actualNetProfitByCompany: new Map([["biz", 100_000]]),
  };

  it("subtracts remaining planned expenses from projected opportunity", () => {
    const withoutExpenses = computeRetirementRoomView({
      ...args,
      remainingPlannedGrossByCompany: new Map([["biz", 100_000]]),
    });
    const withExpenses = computeRetirementRoomView({
      ...args,
      remainingPlannedGrossByCompany: new Map([["biz", 100_000]]),
      remainingPlannedExpensesByCompany: new Map([["biz", 60_000]]),
    });
    const a = withoutExpenses.plans.find((p) => p.companyId === "biz")!.planProjectedCapacity!;
    const b = withExpenses.plans.find((p) => p.companyId === "biz")!.planProjectedCapacity!;
    expect(b).toBeLessThan(a);
  });

  it("does not count planned income that has already become actual", () => {
    // Remaining planned gross excludes matched/converted occurrences, so the
    // projection equals the actual-only projection when nothing is left.
    const view = computeRetirementRoomView({
      ...args,
      remainingPlannedGrossByCompany: new Map(),
    });
    const plan = view.plans.find((p) => p.companyId === "biz")!;
    expect(plan.planProjectedCapacity).toBe(plan.planCurrentCapacity);
  });
});

/* ────────────────────────────── Annualization ───────────────────────────── */

describe("annualization uses the real pay schedule and tax-year windows", () => {
  const perPaycheck = (payFrequency: string) =>
    annualizeRetirementContribution({
      amount: 1_000,
      frequency: "per_paycheck",
      taxYear: YEAR,
      payFrequency,
      startDate: `${YEAR}-01-01`,
      endDate: null,
      contributionDate: null,
    });

  it("weekly / biweekly / semimonthly / monthly all differ", () => {
    expect(perPaycheck("weekly").occurrences).toBeGreaterThan(50);
    expect(perPaycheck("biweekly").occurrences).toBeGreaterThanOrEqual(26);
    expect(perPaycheck("semimonthly").occurrences).toBe(24);
    expect(perPaycheck("monthly").occurrences).toBe(12);
    expect(perPaycheck("monthly").usedFallback).toBe(false);
  });

  it("counts earlier occurrences of a schedule that already ended this year", () => {
    const r = annualizeRetirementContribution({
      amount: 500,
      frequency: "monthly",
      taxYear: YEAR,
      payFrequency: "monthly",
      startDate: `${YEAR}-01-15`,
      endDate: `${YEAR}-03-15`,
      contributionDate: null,
    });
    expect(r.occurrences).toBe(3);
    expect(r.annual).toBe(1_500);
  });

  it("counts later occurrences of a schedule starting later this year", () => {
    const r = annualizeRetirementContribution({
      amount: 500,
      frequency: "monthly",
      taxYear: YEAR,
      payFrequency: "monthly",
      startDate: `${YEAR}-11-01`,
      endDate: null,
      contributionDate: null,
    });
    expect(r.occurrences).toBe(2);
    expect(r.annual).toBe(1_000);
  });

  it("keeps a one-time contribution in its own contribution year", () => {
    expect(
      annualizeRetirementContribution({
        amount: 6_000,
        frequency: "one_time",
        taxYear: YEAR,
        payFrequency: "monthly",
        startDate: `${YEAR}-05-01`,
        endDate: null,
        contributionDate: `${YEAR}-05-01`,
      }).annual,
    ).toBe(6_000);
  });
});

/* ─────────────────────────────── Tax routing ───────────────────────────── */

describe("tax routing keeps one contribution on exactly one path", () => {
  const result = computeRetirementOpportunity({
    taxYear: YEAR,
    dateOfBirth: dobForAge(45),
    filingStatus: "single",
    magi: 60_000,
    coveredByWorkplacePlan: true,
    eligibleTaxableCompensation: 300_000,
    plans: [
      {
        planId: "w2",
        companyId: "c-w2",
        companyName: "Hospital",
        planKind: "401k",
        entityKind: "w2",
        employeeContribution: 10_000,
        employerContribution: 6_000,
        w2Wages: 300_000,
      },
      {
        planId: "solo",
        companyId: "c-biz",
        companyName: "Locums",
        planKind: "solo_401k",
        entityKind: "schedule_c",
        employeeContribution: 0,
        employerContribution: 20_000,
        netBusinessProfit: 200_000,
      },
    ],
    ira: { traditionalContributed: 4_000, rothContributed: 3_000 },
  });

  it("deducts employee deferrals and the deductible Traditional IRA only", () => {
    expect(result.taxRouting.employeePreTaxDeduction).toBe(10_000);
    expect(result.taxRouting.traditionalIraDeduction).toBe(4_000);
    expect(result.ira.traditionalNondeductible).toBe(0);
    expect(result.taxRouting.rothDeduction).toBe(0);
  });

  it("routes self-employed employer money to the business deduction only", () => {
    expect(result.taxRouting.selfEmployedEmployerDeduction).toBe(20_000);
  });

  it("excludes W-2 employer contributions from personal deductions", () => {
    expect(result.taxRouting.w2EmployerExcluded).toBe(6_000);
  });
});

/* ──────────────────────────────── Dedup ─────────────────────────────────── */

describe("duplicate retirement contributions", () => {
  const paycheck = {
    incomeEntryId: "ie1",
    companyId: "c1",
    employee: 2_000,
    employer: 0,
    wages: 20_000,
    date: `${YEAR}-06-15`,
  };

  it("drops a standalone row explicitly linked to the paycheck", () => {
    const r = dedupeRetirementSources({
      paychecks: [paycheck],
      standalone: [
        {
          id: "r1",
          companyId: "c1",
          accountType: "401k",
          contributionType: "employee",
          annualAmount: 2_000,
          linkedIncomeEntryId: "ie1",
        },
      ],
    });
    expect(r.droppedDuplicateIds).toEqual(["r1"]);
    expect(r.standalone).toHaveLength(0);
  });

  it("flags an unlinked look-alike instead of silently merging it", () => {
    const r = dedupeRetirementSources({
      paychecks: [paycheck],
      standalone: [
        {
          id: "r2",
          companyId: "c1",
          accountType: "401k",
          contributionType: "employee",
          annualAmount: 2_000,
          contributionDate: `${YEAR}-06-15`,
        },
      ],
    });
    expect(r.standalone).toHaveLength(1); // preserved
    expect(r.ambiguous).toEqual([
      { standaloneId: "r2", incomeEntryId: "ie1", companyId: "c1", amount: 2_000, bucket: "employee" },
    ]);
  });
});
