import { describe, it, expect } from "vitest";
import { calculateDependentCredits, calculateFullEstimate, calculateSETax } from "@/lib/taxEngine";
import { computeQbiDeduction } from "@/lib/qbi";
import { calcNiitOnSlice, calculateInvestmentTaxRecommendation } from "@/lib/investmentTaxRecommendation";
import { paymentAppliesToTaxYear } from "@/lib/taxPaymentYear";
import { applyMergeLineageGross } from "@/lib/taxRecordSelection";
import { buildSourceCardReconciliation } from "@/lib/recordSelectionBridge";
import { computeCatchUpRecommendation, countRemainingOpportunities, expectedOrdinaryCoverageForEvents } from "@/lib/catchUpRecommendation";

const baseEstimate = {
  totalIncome: 0, w2Income: 0, seIncome: 0, preTaxDeductions: 0, retirement401k: 0,
  businessDeductions: 0, mileageDeduction: 0, taxesWithheld: 0, lastYearTax: 0,
} as const;

describe("child tax credit (2026)", () => {
  it("is $2,200 per child below the phase-out", () => {
    expect(calculateDependentCredits(2, 0, 300000, "married_filing_jointly", 2026)).toBe(4400);
  });
  it("phases out $50 per $1,000 (or fraction) over $400k MFJ", () => {
    expect(calculateDependentCredits(2, 0, 410500, "married_filing_jointly", 2026)).toBe(4400 - 11 * 50);
  });
});

describe("NIIT", () => {
  it("taxes the lesser of NII or MAGI over $250k MFJ at 3.8%", () => {
    const e = calculateFullEstimate({ ...baseEstimate, totalIncome: 300000, w2Income: 280000, otherIncome: 20000,
      filingStatus: "married_filing_jointly", netInvestmentIncome: 20000 });
    expect(e.niitComputation.base).toBe(Math.min(20000, e.agi - 250000));
    expect(e.niit).toBeCloseTo(e.niitComputation.base * 0.038, 6);
  });
  it("is zero below the threshold", () => {
    const e = calculateFullEstimate({ ...baseEstimate, totalIncome: 120000, w2Income: 100000, otherIncome: 20000,
      filingStatus: "married_filing_jointly", netInvestmentIncome: 20000 });
    expect(e.niit).toBe(0);
  });
  it("investment recommendation adds the incremental surtax", () => {
    expect(calcNiitOnSlice({ filingStatus: "single", magi: 250000, netInvestmentIncome: 0, slice: 10000 })).toBeCloseTo(380, 6);
    const rec = calculateInvestmentTaxRecommendation({ type: "long_term_sale" as any, taxableAmount: 10000, filingStatus: "single",
      projectedOrdinaryTaxableIncome: 200000, projectedMagi: 250000, projectedNetInvestmentIncome: 0 });
    const noNiit = calculateInvestmentTaxRecommendation({ type: "long_term_sale" as any, taxableAmount: 10000, filingStatus: "single",
      projectedOrdinaryTaxableIncome: 200000 });
    expect(rec.estimatedTax - noNiit.estimatedTax).toBeCloseTo(380, 2);
  });
});

describe("QBI 2026", () => {
  it("uses the $403,500 MFJ threshold with a $150,000 phase-in", () => {
    const q = computeQbiDeduction({ entities: [{ id: "a", name: "A", isSSTB: true, qbi: 100000, w2Wages: 0, ubia: 0 }],
      taxableIncomeBeforeQbi: 478500, netCapitalGain: 0, filingStatus: "married_filing_jointly", taxYear: 2026 });
    expect(q.threshold).toBe(403500);
    expect(q.phaseInRange).toBe(150000);
    expect(q.sstbApplicablePercentage).toBeCloseTo(0.5, 6);
  });
  it("applies the W-2 wage limit in the phase-in for a non-SSTB", () => {
    const q = computeQbiDeduction({ entities: [{ id: "a", name: "A", isSSTB: false, qbi: 100000, w2Wages: 20000, ubia: 0 }],
      taxableIncomeBeforeQbi: 478500, netCapitalGain: 0, filingStatus: "married_filing_jointly", taxYear: 2026 });
    // tentative 20,000; wage limit 10,000; half phased in → 15,000
    expect(q.perEntity[0].entityDeduction).toBeCloseTo(15000, 6);
    expect(q.verification.status).toBe("verified");
  });
  it("flags missing wage/UBIA inputs above the threshold as approximate", () => {
    const q = computeQbiDeduction({ entities: [{ id: "a", name: "A", isSSTB: true, qbi: 100000, synthesized: true }],
      taxableIncomeBeforeQbi: 420000, netCapitalGain: 0, filingStatus: "married_filing_jointly", taxYear: 2026 });
    expect(q.verification.status).toBe("approximate");
    expect(q.verification.missingInputs.length).toBeGreaterThan(0);
  });
});

describe("Social Security wage base per earner", () => {
  it("spouse W-2 wages do not consume the SE earner's wage base; Additional Medicare stays joint", () => {
    // Household W-2 $150k all spouse-owned; SE earner has $0 own W-2.
    const perEarner = calculateSETax(100000, "married_filing_jointly", 184500, 150000, 150000, undefined, undefined, 0);
    const legacy = calculateSETax(100000, "married_filing_jointly", 184500, 150000, 150000);
    expect(perEarner.ssTaxableBase).toBeCloseTo(100000 * 0.9235, 4);
    expect(legacy.ssTaxableBase).toBeCloseTo(34500, 4);
    expect(perEarner.additionalMedicare).toBeCloseTo(legacy.additionalMedicare, 6);
  });
});

describe("estimated payments by applied tax year", () => {
  it("a January payment applied to the prior year does not count this year", () => {
    expect(paymentAppliesToTaxYear({ applied_tax_year: 2025, payment_date: "2026-01-15" }, 2026)).toBe(false);
    expect(paymentAppliesToTaxYear({ applied_tax_year: 2026, payment_date: "2026-04-15" }, 2026)).toBe(true);
    expect(paymentAppliesToTaxYear({ applied_tax_year: null, payment_date: "2026-06-15" }, 2026)).toBe(true);
  });
});

describe("Actual Only reconciliation", () => {
  const sel = {
    businessIncomeTransactions: [{ amount: 1000 }],
    personalEntries: [{ paycheck_amount: 500 }],
    projectedPaychecks: [{ matchStatus: "active", grossAmount: 2500 }] as any,
  };
  it("excludes planned income in Actual Only", () => {
    const r = buildSourceCardReconciliation([{ kind: "business", revenue: 1000 }, { kind: "w2", grossWages: 500 }], sel, "actualOnly");
    expect(r.canonicalRecords.planned).toBe(0);
    expect(r.reconciled).toBe(true);
  });
  it("includes planned income in Actual + Planned", () => {
    const r = buildSourceCardReconciliation([{ kind: "business", revenue: 1000 }, { kind: "w2", grossWages: 3000 }], sel, "actualPlusPlanned");
    expect(r.canonicalRecords.planned).toBe(2500);
    expect(r.reconciled).toBe(true);
  });
});

describe("merge lineage: gross pay vs bank deposit", () => {
  const tx = (id: string, amount: number, status: string, source_type: string) =>
    ({ id, amount, status, source_type, transaction_type: "income", linked_group_id: "g1" });
  it("uses the saved gross once when the saved Net Received ties to the surviving deposit", () => {
    const txs = [tx("m", 10000, "merged", "manual"), tx("d", 8000, "active", "plaid")];
    const entries = [{ id: "e", linked_transaction_id: "m", paycheck_amount: 10000, deposited_amount: 8000, retirement_401k: 300 }];
    const r = applyMergeLineageGross(txs, entries);
    expect(r.findings[0].status).toBe("authoritative_gross_applied");
    expect(r.transactions.find((t) => t.id === "d")!.amount).toBe(10000);
    expect(r.transactions.filter((t) => t.status === "active")).toHaveLength(1);
    expect(r.incomeEntries[0].linked_transaction_id).toBe("d");
    expect(txs[1].amount).toBe(8000); // inputs never mutated
  });
  it("flags a split-deposit group with no saved Net Received and changes nothing", () => {
    const txs = [tx("m", 6000, "merged", "manual"), tx("d1", 3000, "active", "plaid"), tx("d2", 2700, "merged", "plaid"), tx("d3", 300, "merged", "plaid")];
    const entries = [{ id: "e", linked_transaction_id: "m", paycheck_amount: 6000, deposited_amount: 0 }];
    const r = applyMergeLineageGross(txs, entries);
    expect(r.findings[0].status).toBe("ambiguous");
    expect(r.findings[0].missingEvidence.length).toBeGreaterThan(0);
    expect(r.transactions).toBe(txs);
  });
});

describe("household catch-up allocated once across companies", () => {
  it("spreads the uncovered gap across all companies' remaining paychecks exactly once", () => {
    const now = new Date("2026-08-01");
    const deadline = new Date("2026-09-15");
    const events = [
      { date: "2026-08-15", grossAmount: 10000, ordinaryCoverage: 1000 }, // company A
      { date: "2026-08-30", grossAmount: 8000, ordinaryCoverage: 800 },   // company B
      { date: "2026-09-10", grossAmount: 10000, ordinaryCoverage: 1000 }, // company A
    ];
    const n = countRemainingOpportunities(events, now, deadline);
    const coverage = expectedOrdinaryCoverageForEvents(events, now, deadline);
    const r = computeCatchUpRecommendation({ quarterTarget: 9000, coveredSoFar: 3000, remainingOpportunities: n, expectedOrdinaryCoverage: coverage });
    expect(n).toBe(3);
    expect(r.quarterlyAdjustmentAmount * n).toBeCloseTo(9000 - 3000 - 2800, 0);
  });
});
