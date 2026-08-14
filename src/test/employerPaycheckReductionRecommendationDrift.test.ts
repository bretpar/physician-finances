/**
 * Regression: employer paycheck-reduction settings must never move the tax
 * recommendation.
 *
 * QA path reproduced here:
 *   1. Business Activity income transaction (K-1, gross $10,000, employee
 *      retirement $500, employer retirement $750, employee HSA $200, employer
 *      HSA $300) is created and saved.
 *   2. Both per-company reduction settings are toggled ON, then back OFF, and
 *      Settings is saved (which persists the keys explicitly as `false`).
 *   3. The page unmounts, data refetches, and the unchanged transaction is
 *      reopened in Edit.
 *
 * The bug: the saved income_entry for the transaction carried
 * `source_bucket = 'personal'`, so it was loaded by the personal-income query
 * and aggregated as personal income. The Edit exclusion only filtered the
 * business enrichment set, leaving the edited paycheck counted once in the
 * annual/YTD aggregate — which raised the effective rate and the recommended
 * set-aside on reopen ($1,317.81 → $1,450.80) even though nothing changed.
 */
import { describe, it, expect } from "vitest";
import {
  excludeIncomeTransactionFromTaxContext,
  excludeIncomeEntriesLinkedToTransaction,
} from "@/lib/taxRecommendationContext";
import { computeEstimatedNet } from "@/lib/estimatedNet";
import {
  resolveEmployerPaycheckReduction,
  EMPLOYER_RETIREMENT_REDUCES_PAYCHECK_KEY,
  EMPLOYER_HSA_REDUCES_PAYCHECK_KEY,
} from "@/lib/filingTypes";
import { getSavingsRateForIncomeBucket } from "@/lib/savingsRateSelection";

const TX_ID = "qa-k1-tx";
const COMPANY_ID = "qa-vituity";

const entry = {
  id: "qa-k1-entry",
  linked_transaction_id: TX_ID,
  // Reproduces production: the business income row landed in the personal bucket.
  source_bucket: "personal",
  income_date: "2026-08-14",
  income_type: "k1",
  paycheck_amount: 10_000,
  retirement_401k: 500,
  hsa_contribution: 200,
  employer_retirement_contribution: 750,
  employer_hsa_contribution: 300,
  pre_tax_deductions: 0,
  healthcare_deduction: 0,
  include_in_tax_estimate: true,
};
const transaction = { id: TX_ID, amount: 10_000, transaction_type: "income", source_id: COMPANY_ID };
const priorPersonalPaycheck = {
  id: "prior-w2",
  linked_transaction_id: null,
  source_bucket: "personal",
  income_date: "2026-08-01",
  income_type: "w2",
  paycheck_amount: 2_000,
  retirement_401k: 150,
  hsa_contribution: 0,
  pre_tax_deductions: 25,
  healthcare_deduction: 50,
  include_in_tax_estimate: true,
};

/** Effective-rate input the recommendation reads: annualized YTD income. */
function paceEstimateFor(personalRows: Array<{ paycheck_amount: number }>, businessGross: number) {
  const personal = personalRows.reduce((s, r) => s + r.paycheck_amount, 0);
  const totalIncome = personal + businessGross;
  const taxable = Math.max(0, totalIncome - 15_000);
  const federalTax = taxable * 0.18;
  return {
    federalEffectiveRate: totalIncome > 0 ? (federalTax / totalIncome) * 100 : 0,
    effectiveRate: totalIncome > 0 ? (federalTax / totalIncome) * 100 : 0,
    federalTax,
    totalTaxLiability: federalTax,
    totalIncome,
    totalReturnIncomeBeforeAdjustments: totalIncome,
    taxableIncome: taxable,
    w2Income: personal,
    seIncome: businessGross,
    seTax: { total: 0 },
  } as any;
}

/** The Edit-modal recommendation, priced from the exclusion-aware context. */
function recommendationForEdit(
  personalRows: typeof priorPersonalPaycheck[],
  txs: typeof transaction[],
  businessEntries: typeof entry[],
  excludeTransactionId: string | null,
) {
  const business = excludeIncomeTransactionFromTaxContext(txs, businessEntries, excludeTransactionId);
  const personal = excludeIncomeEntriesLinkedToTransaction(personalRows, excludeTransactionId);
  const businessGross = business.transactions.reduce((s, t) => s + t.amount, 0);
  const paceEstimate = paceEstimateFor(personal, businessGross);
  const netTaxable = 10_000 - 500 - 200; // gross − employee retirement − employee HSA
  const { rate } = getSavingsRateForIncomeBucket({
    incomeBucket: "business",
    incomeType: "k1_partnership",
    taxSettings: { withholdingMethod: "dynamic_actual" },
    actualEstimate: paceEstimate,
    currentPaceEstimate: paceEstimate,
    forecastEstimate: null,
    companyId: COMPANY_ID,
    isSelfEmploymentTaxable: true,
    currentW2Wages: paceEstimate.w2Income,
    currentNetSEIncome: paceEstimate.seIncome,
    entryGrossAmount: netTaxable,
  });
  return Math.round(netTaxable * (rate / 100) * 100) / 100;
}

const bothOff = {
  employer_retirement_contribution: true,
  employer_hsa_contribution: true,
};
const retirementOn = { ...bothOff, [EMPLOYER_RETIREMENT_REDUCES_PAYCHECK_KEY]: true };
const hsaOn = { ...bothOff, [EMPLOYER_HSA_REDUCES_PAYCHECK_KEY]: true };
const bothOn = { ...retirementOn, ...hsaOn };
/** What Settings persists after toggling ON then back OFF and saving. */
const roundTrippedOff = {
  ...bothOff,
  [EMPLOYER_RETIREMENT_REDUCES_PAYCHECK_KEY]: false,
  [EMPLOYER_HSA_REDUCES_PAYCHECK_KEY]: false,
};

const netInput = {
  gross: 10_000,
  federal: 0,
  ss: 0,
  medicare: 0,
  aggregateFederalPayrollTaxes: 0,
  state: 0,
  retirement: 500,
  otherPreTax: 0,
  healthcare: 0,
  hsa: 200,
  employerRetirement: 750,
  employerHsa: 300,
};

describe("employer paycheck-reduction settings: recommendation invariance", () => {
  it("Estimated Net follows each toggle combination", () => {
    const net = (saved: Record<string, boolean>) => {
      const r = resolveEmployerPaycheckReduction("k1_partnership", saved);
      return computeEstimatedNet({
        ...netInput,
        employerRetirementReducesPaycheck: r.retirement,
        employerHsaReducesPaycheck: r.hsa,
      });
    };
    expect(net(bothOff)).toBe(9_300);
    expect(net(retirementOn)).toBe(8_550);
    expect(net(hsaOn)).toBe(9_000);
    expect(net(bothOn)).toBe(8_250);
    expect(net(roundTrippedOff)).toBe(9_300);
  });

  it("recommendation is identical across every toggle combination and after the Settings round-trip", () => {
    const rec = () =>
      recommendationForEdit([priorPersonalPaycheck, entry as any], [transaction], [entry], TX_ID);
    const baseline = rec();
    for (const saved of [bothOff, retirementOn, hsaOn, bothOn, roundTrippedOff]) {
      // The flags feed cash flow only — no tax input depends on them.
      resolveEmployerPaycheckReduction("k1_partnership", saved);
      expect(rec()).toBe(baseline);
    }
  });

  it("Edit prices the same recommendation as Add for identical values", () => {
    // Add: the transaction and its entry do not exist yet.
    const addValue = recommendationForEdit([priorPersonalPaycheck], [], [], null);
    // Edit, after save + navigation + refetch: same values, excluded once.
    const editValue = recommendationForEdit(
      [priorPersonalPaycheck, entry as any],
      [transaction],
      [entry],
      TX_ID,
    );
    expect(editValue).toBe(addValue);
  });

  it("regression: leaving the personal-bucket row in context inflates the recommendation", () => {
    const leaked = recommendationForEdit(
      [priorPersonalPaycheck, entry as any],
      [transaction],
      [entry],
      null,
    );
    const fixed = recommendationForEdit(
      [priorPersonalPaycheck, entry as any],
      [transaction],
      [entry],
      TX_ID,
    );
    expect(leaked).toBeGreaterThan(fixed);
  });

  it("excludes the edited row from BOTH buckets exactly once, without duplicating rows", () => {
    const personal = excludeIncomeEntriesLinkedToTransaction([priorPersonalPaycheck, entry as any], TX_ID);
    const business = excludeIncomeTransactionFromTaxContext([transaction], [entry], TX_ID);
    expect(personal.map((r) => r.id)).toEqual(["prior-w2"]);
    expect(business.transactions).toHaveLength(0);
    expect(business.incomeEntries).toHaveLength(0);
    // Unrelated rows are preserved, and nothing is added.
    expect(excludeIncomeEntriesLinkedToTransaction([priorPersonalPaycheck], TX_ID)).toHaveLength(1);
    expect(excludeIncomeEntriesLinkedToTransaction([priorPersonalPaycheck, entry as any], null)).toHaveLength(2);
  });

  it("keeps employer amounts employer-classified regardless of the flags", () => {
    for (const saved of [bothOff, bothOn, roundTrippedOff]) {
      resolveEmployerPaycheckReduction("k1_partnership", saved);
      expect(entry.employer_retirement_contribution).toBe(750);
      expect(entry.employer_hsa_contribution).toBe(300);
      expect(entry.retirement_401k).toBe(500);
      expect(entry.hsa_contribution).toBe(200);
    }
  });
});
