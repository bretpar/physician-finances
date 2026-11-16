/**
 * W-2 employer match / profit-sharing formulas: estimate math, metadata
 * round-trip, and engine behavior (the estimate counts toward used room).
 */
import { describe, it, expect } from "vitest";
import {
  estimateEmployerContribution,
  readEmployerContributionFormula,
  writeEmployerContributionFormula,
  EMPLOYER_FORMULA_KEY,
  type EmployerContributionFormula,
} from "@/lib/employerContributionFormula";
import {
  computeRetirementOpportunity,
  type PlanOpportunityInput,
} from "@/lib/retirementOpportunityEngine";

const YEAR = 2026;

describe("estimateEmployerContribution", () => {
  it("match: 50% of deferrals up to 6% of pay", () => {
    const f: EmployerContributionFormula = { kind: "match", matchRate: 0.5, matchCapPct: 0.06 };
    // $100k pay, $10k deferred → matchable = min(10k, 6k) = 6k → $3,000
    expect(estimateEmployerContribution(f, 100_000, 10_000)).toBe(3_000);
    // deferral below the cap → matched in full at 50%
    expect(estimateEmployerContribution(f, 100_000, 4_000)).toBe(2_000);
    // no deferrals → no match
    expect(estimateEmployerContribution(f, 100_000, 0)).toBe(0);
  });

  it("match: unknown compensation yields 0, never a guess", () => {
    const f: EmployerContributionFormula = { kind: "match", matchRate: 0.5, matchCapPct: 0.06 };
    expect(estimateEmployerContribution(f, null, 10_000)).toBe(0);
    expect(estimateEmployerContribution(f, 0, 10_000)).toBe(0);
  });

  it("tiered: 100% of first 3%, then 50% of next 2%", () => {
    const f: EmployerContributionFormula = {
      kind: "tiered",
      tiers: [
        { upToPct: 0.03, rate: 1 },
        { upToPct: 0.05, rate: 0.5 },
      ],
    };
    // $100k pay, 5% deferred → 3k + 1k = $4,000
    expect(estimateEmployerContribution(f, 100_000, 5_000)).toBeCloseTo(4_000, 6);
    // 2% deferred → only first tier → $2,000
    expect(estimateEmployerContribution(f, 100_000, 2_000)).toBeCloseTo(2_000, 6);
    // 10% deferred → capped at the last tier → $4,000
    expect(estimateEmployerContribution(f, 100_000, 10_000)).toBeCloseTo(4_000, 6);
  });

  it("flat: fixed amount regardless of pay or deferrals", () => {
    const f: EmployerContributionFormula = { kind: "flat", annualAmount: 2_000 };
    expect(estimateEmployerContribution(f, 100_000, 0)).toBe(2_000);
    expect(estimateEmployerContribution(f, null, null)).toBe(2_000);
  });

  it("no formula → 0", () => {
    expect(estimateEmployerContribution(null, 100_000, 10_000)).toBe(0);
  });
});

describe("formula metadata round-trip", () => {
  it("writes and reads back each kind, preserving other metadata keys", () => {
    const meta = { some_other_key: true, retirement_relationship: { status: "unrelated" } };
    const f: EmployerContributionFormula = { kind: "match", matchRate: 0.5, matchCapPct: 0.06 };
    const next = writeEmployerContributionFormula(meta, f);
    expect(readEmployerContributionFormula(next)).toEqual(f);
    expect((next as Record<string, unknown>).some_other_key).toBe(true);
    expect((next as Record<string, unknown>).retirement_relationship).toEqual({ status: "unrelated" });
  });

  it("clearing the formula removes only its own key", () => {
    const withFormula = writeEmployerContributionFormula(
      { keep_me: 1 },
      { kind: "flat", annualAmount: 500 },
    );
    const cleared = writeEmployerContributionFormula(withFormula, null);
    expect(readEmployerContributionFormula(cleared)).toBeNull();
    expect((cleared as Record<string, unknown>).keep_me).toBe(1);
    expect(EMPLOYER_FORMULA_KEY in (cleared as Record<string, unknown>)).toBe(false);
  });

  it("rejects malformed stored values instead of guessing", () => {
    expect(readEmployerContributionFormula(null)).toBeNull();
    expect(readEmployerContributionFormula({ [EMPLOYER_FORMULA_KEY]: { kind: "match", matchRate: -1 } })).toBeNull();
    expect(
      readEmployerContributionFormula({ [EMPLOYER_FORMULA_KEY]: { kind: "tiered", tiers: [{ upToPct: 0.03 }] } }),
    ).toBeNull();
  });
});

describe("engine: estimated employer contribution counts toward used room", () => {
  const plan = (over: Partial<PlanOpportunityInput> = {}): PlanOpportunityInput => ({
    planKind: "401k",
    entityKind: "w2",
    companyName: "Employer",
    employeeContribution: 0,
    employerContribution: 0,
    w2Wages: 100_000,
    ...over,
  });

  it("reduces employer capacity and additions headroom by the estimate", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          employeeContribution: 10_000,
          employerFormulaKnown: true,
          estimatedEmployerContribution: 3_000,
        }),
      ],
    });
    const p = r.plans[0];
    // Formula capacity = the $3,000 estimate; nothing recorded yet.
    expect(p.employerCapacityRemaining).toBe(3_000);
    expect(p.estimatedEmployerContribution).toBe(3_000);
    // Headroom: $72,000 − $10,000 employee − $3,000 estimate.
    expect(p.additionsHeadroom).toBe(72_000 - 10_000 - 3_000);
    expect(p.reasons).toContain("employer_formula_estimate");
  });

  it("recorded employer money consumes the estimate first", () => {
    const r = computeRetirementOpportunity({
      taxYear: YEAR,
      plans: [
        plan({
          employeeContribution: 10_000,
          employerContribution: 2_500,
          employerFormulaKnown: true,
          estimatedEmployerContribution: 3_000,
        }),
      ],
    });
    const p = r.plans[0];
    // $3,000 expected − $2,500 already recorded = $500 remaining.
    expect(p.employerCapacityRemaining).toBe(500);
    expect(p.additionsHeadroom).toBe(72_000 - 10_000 - 2_500 - 3_000);
  });

  it("without a recorded formula, W-2 employer capacity stays unknown", () => {
    const r = computeRetirementOpportunity({ taxYear: YEAR, plans: [plan({ employeeContribution: 10_000 })] });
    expect(r.plans[0].employerCapacityRemaining).toBeNull();
    expect(r.plans[0].reasons).toContain("unknown_plan_data");
    expect(r.plans[0].estimatedEmployerContribution).toBe(0);
  });
});
