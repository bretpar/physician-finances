/**
 * Canonical annual tax allocation — architecture invariants.
 *
 * These tests encode the product rules that the allocation layer exists to
 * guarantee. They deliberately assert BEHAVIOUR (reconciliation, isolation,
 * no double-funding) rather than magic numbers, so tax-law updates in the
 * engine don't invalidate them.
 */
import { describe, it, expect } from "vitest";
import {
  buildAnnualTaxAllocation,
  computeEventTaxTarget,
  computeW2FundingPlan,
  type AllocationSourceInput,
} from "@/lib/taxAllocation";
import type { TaxEstimate } from "@/lib/taxEngine";

/** Minimal estimate stub shaped like calculateFullEstimate's output. */
function estimate(over: Partial<TaxEstimate> = {}): TaxEstimate {
  return {
    federalTax: 40000,
    federalTaxBeforeCredits: 40000,
    ordinaryFederalTaxBeforeCredits: 40000,
    preferentialFederalTaxBeforeCredits: 0,
    preferentialTaxableIncome: 0,
    seTax: { total: 0 },
    personalStateTax: 0,
    businessStateTax: 0,
    totalTaxLiability: 40000,
    ...over,
  } as unknown as TaxEstimate;
}

const w2: AllocationSourceInput = {
  sourceId: "optum",
  sourceLabel: "Optum",
  sourceType: "w2",
  projectedAnnualIncome: 300000,
  allocableOrdinaryTaxBase: 300000,
};

const biz: AllocationSourceInput = {
  sourceId: "locums",
  sourceLabel: "Locums LLC",
  sourceType: "1099",
  projectedAnnualIncome: 100000,
  allocableOrdinaryTaxBase: 100000,
  selfEmploymentBase: 100000,
};

describe("buildAnnualTaxAllocation — reconciliation", () => {
  it("allocates the full calculated liability across sources with no leftovers", () => {
    const alloc = buildAnnualTaxAllocation({
      estimate: estimate({
        seTax: { total: 14130 } as any,
        totalTaxLiability: 54130,
      }),
      sources: [w2, biz],
    });

    expect(alloc.projectedTaxLiability).toBe(54130);
    expect(alloc.totalAllocatedTax).toBe(54130);
    expect(alloc.reconciliationDifference).toBe(0);
    expect(alloc.otherTax).toBe(0);
  });

  it("derives the federal allocation rate FROM the calculated tax, not a marginal bracket", () => {
    // $40,000 of federal tax over a $400,000 combined base = 10% allocation
    // rate. A marginal-bracket approach would have used 32%/35%.
    const alloc = buildAnnualTaxAllocation({
      estimate: estimate(),
      sources: [w2, biz],
    });
    expect(alloc.federalOrdinaryAllocationRate).toBeCloseTo(0.1, 6);
    expect(alloc.combinedOrdinaryTaxBase).toBe(400000);
  });

  it("splits federal tax proportionally to each source's taxable base", () => {
    const alloc = buildAnnualTaxAllocation({ estimate: estimate(), sources: [w2, biz] });
    const [w2Row, bizRow] = alloc.sources;
    expect(w2Row.allocatedFederalIncomeTax).toBe(30000);
    expect(bizRow.allocatedFederalIncomeTax).toBe(10000);
  });
});

describe("buildAnnualTaxAllocation — source isolation", () => {
  it("assigns self-employment tax ONLY to the SE-taxable source", () => {
    const alloc = buildAnnualTaxAllocation({
      estimate: estimate({ seTax: { total: 14130 } as any, totalTaxLiability: 54130 }),
      sources: [w2, biz],
    });
    const [w2Row, bizRow] = alloc.sources;
    expect(w2Row.allocatedSelfEmploymentTax).toBe(0);
    expect(bizRow.allocatedSelfEmploymentTax).toBe(14130);
  });

  it("assigns business state tax ONLY to the business that generates it", () => {
    const alloc = buildAnnualTaxAllocation({
      estimate: estimate({ businessStateTax: 1500, totalTaxLiability: 41500 }),
      sources: [w2, { ...biz, businessStateTaxBase: 100000 }],
    });
    const [w2Row, bizRow] = alloc.sources;
    expect(w2Row.allocatedBusinessStateTax).toBe(0);
    expect(bizRow.allocatedBusinessStateTax).toBe(1500);
  });

  it("allocates zero personal state tax when the state tax is disabled", () => {
    const alloc = buildAnnualTaxAllocation({ estimate: estimate(), sources: [w2, biz] });
    expect(alloc.personalStateTax).toBe(0);
    expect(alloc.personalStateAllocationRate).toBe(0);
    expect(alloc.sources.every((s) => s.allocatedPersonalStateTax === 0)).toBe(true);
  });

  it("keeps preferential income on the preferential rate, not the ordinary rate", () => {
    const alloc = buildAnnualTaxAllocation({
      estimate: estimate({
        federalTax: 45000,
        federalTaxBeforeCredits: 45000,
        ordinaryFederalTaxBeforeCredits: 40000,
        preferentialFederalTaxBeforeCredits: 5000,
        preferentialTaxableIncome: 33333,
        totalTaxLiability: 45000,
      }),
      sources: [
        w2,
        biz,
        {
          sourceId: "brokerage",
          sourceType: "investment",
          projectedAnnualIncome: 33333,
          allocableOrdinaryTaxBase: 0,
          allocablePreferentialTaxBase: 33333,
        },
      ],
    });
    const invRow = alloc.sources[2];
    expect(invRow.allocatedFederalIncomeTax).toBe(0);
    expect(invRow.allocatedInvestmentTax).toBe(5000);
    expect(alloc.preferentialAllocationRate).toBeCloseTo(5000 / 33333, 6);
  });
});

describe("computeEventTaxTarget", () => {
  const alloc = buildAnnualTaxAllocation({
    estimate: estimate({ seTax: { total: 14130 } as any, totalTaxLiability: 54130 }),
    sources: [w2, biz],
  });

  it("gives a W-2 paycheck its allocated share and never SE or business state tax", () => {
    const t = computeEventTaxTarget({
      allocation: alloc,
      sourceType: "w2",
      ordinaryTaxBase: 10000,
      selfEmploymentBase: 10000, // ignored for W-2
      selfEmploymentRate: 0.1413,
      businessStateTaxRate: 0.015,
    });
    expect(t.selfEmploymentTax).toBe(0);
    expect(t.businessStateTax).toBe(0);
    expect(t.federalIncomeTax).toBe(1000);
    expect(t.total).toBe(1000);
  });

  it("adds SE and business state tax for a 1099 event", () => {
    const t = computeEventTaxTarget({
      allocation: alloc,
      sourceType: "1099",
      ordinaryTaxBase: 10000,
      selfEmploymentBase: 10000,
      selfEmploymentRate: 0.1413,
      businessStateTaxRate: 0.015,
    });
    expect(t.federalIncomeTax).toBe(1000);
    expect(t.selfEmploymentTax).toBe(1413);
    expect(t.businessStateTax).toBe(150);
    expect(t.total).toBe(2563);
  });
});

describe("computeW2FundingPlan — one liability, one delivery mechanism", () => {
  const base = {
    allocatedAnnualResponsibility: 30000,
    actualFederalWithheldYtd: 12000,
    expectedFutureBaselineWithholding: 8000,
    remainingPaychecks: 10,
  };

  it("annual_w4 funds the deficit via Step 4(c) and asks for NO separate savings", () => {
    const plan = computeW2FundingPlan({ ...base, method: "annual_w4" });
    expect(plan.remainingDeficit).toBe(10000);
    expect(plan.additionalWithholdingPerPaycheck).toBe(1000);
    expect(plan.savingsPerPaycheck).toBe(0); // never double-fund
    expect(plan.fundedByW4).toBe(10000);
  });

  it("paycheck_target funds the same deficit via savings and no W-4 change", () => {
    const plan = computeW2FundingPlan({ ...base, method: "paycheck_target" });
    expect(plan.remainingDeficit).toBe(10000);
    expect(plan.savingsPerPaycheck).toBe(1000);
    expect(plan.additionalWithholdingPerPaycheck).toBe(0);
  });

  it("counts extra withholding the user already achieved so it isn't re-requested", () => {
    const plan = computeW2FundingPlan({
      ...base,
      method: "annual_w4",
      achievedExtraPerPaycheck: 1000,
    });
    expect(plan.remainingDeficit).toBe(0);
    expect(plan.additionalWithholdingPerPaycheck).toBe(0);
    expect(plan.isOnTrack).toBe(true);
  });

  it("PRODUCTION FIXTURE: Optum W-2 Aug 14 paycheck gets no ~$919 catch-up ask", () => {
    // The W-4 is already on track for the year. Under annual_w4 the paycheck
    // must show a $0 separate savings recommendation instead of the historical
    // ~$919 future-catch-up allocation that leaked in previously.
    const plan = computeW2FundingPlan({
      allocatedAnnualResponsibility: 60000,
      actualFederalWithheldYtd: 35000,
      expectedFutureBaselineWithholding: 25000,
      remainingPaychecks: 9,
      method: "annual_w4",
    });
    expect(plan.signedDeficit).toBe(0);
    expect(plan.savingsPerPaycheck).toBe(0);
    expect(plan.additionalWithholdingPerPaycheck).toBe(0);
    expect(plan.isOnTrack).toBe(true);
  });

  it("does not credit employee FICA against the income-tax responsibility", () => {
    // Caller passes federal income tax withheld only. FICA (SS+Medicare) is
    // simply absent from the coverage inputs — there is nowhere to pass it.
    const plan = computeW2FundingPlan({
      allocatedAnnualResponsibility: 30000,
      actualFederalWithheldYtd: 12000,
      expectedFutureBaselineWithholding: 8000,
      remainingPaychecks: 10,
      method: "paycheck_target",
    });
    expect(plan.totalCoverage).toBe(20000);
  });

  it("reports an unfundable deficit rather than hiding it when no paychecks remain", () => {
    const plan = computeW2FundingPlan({
      ...base,
      remainingPaychecks: 0,
      expectedFutureBaselineWithholding: 0,
      method: "annual_w4",
    });
    expect(plan.remainingDeficit).toBe(18000);
    expect(plan.additionalWithholdingPerPaycheck).toBe(0);
    expect(plan.unfundedByW4).toBe(18000);
  });
});
