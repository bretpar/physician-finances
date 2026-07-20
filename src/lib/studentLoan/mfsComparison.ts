/**
 * MFJ vs MFS comparison for student loan strategy.
 *
 * READ-ONLY: this module never persists or mutates user tax settings.
 * It requests two tax estimates from the canonical engine
 * (`calculateFullEstimate`) — one MFJ, one MFS-per-spouse — and pairs the
 * results with student loan payment estimates so the UI can display a
 * combined annual cost comparison and a "recommended filing status" card.
 *
 * Spouse-income treatment per plan is read from the canonical rules
 * registry (`rules/plans.ts`) — do NOT hardcode assumptions here.
 */

import { calculateFullEstimate } from "@/lib/taxEngine";
import { estimateRepayment, type BorrowerInput, type StudentLoanInput } from "./calculator";
import { splitIncomeForMfs } from "./communityProperty";
import { getPlan } from "./rules/plans";
import type { RepaymentPlanId } from "./repaymentPlans";

export interface MfsComparisonInput {
  userIncome: number;
  spouseIncome: number;
  loan: StudentLoanInput;
  planId: RepaymentPlanId;
  familySize: number;
  state: string;
  /** True if the couple lives in a community-property state and wants the 50/50 split applied. */
  applyCommunityRules: boolean;
  /** Optional user income share override (0..1). Only used when `applyCommunityRules` is true. */
  userShareOverride?: number | null;
  /** Combined itemized deduction (0 = use standard). Passed through untouched to the tax engine. */
  itemizedDeductionAmount?: number;
  /** State income tax rate (%) applied uniformly for both scenarios (rough estimate). */
  stateTaxRatePct?: number;
}

export interface FilingScenarioResult {
  label: string;
  federalTax: number;
  stateTax: number;
  studentLoanAnnualPayment: number;
  combinedAnnualCost: number;
  combinedMonthlyCost: number;
}

export interface MfsComparisonResult {
  mfj: FilingScenarioResult;
  mfs: FilingScenarioResult;
  recommendation: "mfj" | "mfs";
  netAnnualBenefit: number;
  netMonthlyBenefit: number;
  studentLoanSavings: number;
  additionalTaxes: number;
  communityPropertyApplied: boolean;
  communityPropertyNote: string;
  /** Spouse-income treatment for the selected plan (registry-driven). */
  spouseIncomeNote: string;
  planUnavailable?: string;
}

function estimateStateTax(taxableIncome: number, ratePct: number): number {
  if (!ratePct || ratePct <= 0) return 0;
  return Math.max(0, taxableIncome) * (ratePct / 100);
}

export function compareFilingStatuses(input: MfsComparisonInput): MfsComparisonResult {
  const totalIncome = Math.max(0, input.userIncome) + Math.max(0, input.spouseIncome);
  const stateRate = input.stateTaxRatePct ?? 0;
  const itemized = input.itemizedDeductionAmount ?? 0;
  const deductionType = itemized > 0 ? "itemized" : "standard";

  // MFJ scenario ────────────────────────────────
  const mfjEstimate = calculateFullEstimate({
    totalIncome,
    w2Income: totalIncome, // treat combined income as W-2 for MVP comparison
    seIncome: 0,
    preTaxDeductions: 0,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "married_filing_jointly",
    lastYearTax: 0,
    deductionType,
    itemizedDeductionAmount: itemized,
  });
  const mfjBorrower: BorrowerInput = {
    filingStatus: "married_filing_jointly",
    familySize: input.familySize,
    // For MFJ, IDR uses combined AGI.
    annualIncome: totalIncome,
  };
  const mfjLoan = estimateRepayment(input.loan, mfjBorrower, input.planId);
  const mfjStateTax = estimateStateTax(mfjEstimate.taxableIncome, stateRate);
  const mfj: FilingScenarioResult = {
    label: "Married Filing Jointly",
    federalTax: round0(mfjEstimate.federalTax),
    stateTax: round0(mfjStateTax),
    studentLoanAnnualPayment: round0(mfjLoan.estimatedAnnualPayment),
    combinedAnnualCost: round0(mfjEstimate.federalTax + mfjStateTax + mfjLoan.estimatedAnnualPayment),
    combinedMonthlyCost: round0((mfjEstimate.federalTax + mfjStateTax + mfjLoan.estimatedAnnualPayment) / 12),
  };

  // MFS scenario ────────────────────────────────
  const split = splitIncomeForMfs({
    userIncome: input.userIncome,
    spouseIncome: input.spouseIncome,
    applyCommunityRules: input.applyCommunityRules,
    userShareOverride: input.userShareOverride,
  });

  // For MFS we approximate each spouse with the engine's `single` filing
  // status. MFS brackets closely track single brackets at the incomes
  // physicians typically deal with; results are labelled as estimates in
  // the UI.
  const userEstimate = calculateFullEstimate({
    totalIncome: split.userIncome,
    w2Income: split.userIncome,
    seIncome: 0,
    preTaxDeductions: 0,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "single",
    lastYearTax: 0,
    deductionType,
    itemizedDeductionAmount: itemized / 2, // split evenly
  });
  const spouseEstimate = calculateFullEstimate({
    totalIncome: split.spouseIncome,
    w2Income: split.spouseIncome,
    seIncome: 0,
    preTaxDeductions: 0,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "single",
    lastYearTax: 0,
    deductionType,
    itemizedDeductionAmount: itemized / 2,
  });

  // Under MFS, the borrower's IDR payment uses ONLY their own income (that
  // is the entire point of the strategy). Spouse's loan isn't modeled in
  // this MVP.
  const mfsBorrower: BorrowerInput = {
    filingStatus: "married_filing_separately",
    familySize: input.familySize,
    annualIncome: split.userIncome,
  };
  const mfsLoan = estimateRepayment(input.loan, mfsBorrower, input.planId);
  const mfsFederal = userEstimate.federalTax + spouseEstimate.federalTax;
  const mfsState =
    estimateStateTax(userEstimate.taxableIncome, stateRate) +
    estimateStateTax(spouseEstimate.taxableIncome, stateRate);
  const mfs: FilingScenarioResult = {
    label: "Married Filing Separately",
    federalTax: round0(mfsFederal),
    stateTax: round0(mfsState),
    studentLoanAnnualPayment: round0(mfsLoan.estimatedAnnualPayment),
    combinedAnnualCost: round0(mfsFederal + mfsState + mfsLoan.estimatedAnnualPayment),
    combinedMonthlyCost: round0((mfsFederal + mfsState + mfsLoan.estimatedAnnualPayment) / 12),
  };

  const recommendation: "mfj" | "mfs" = mfs.combinedAnnualCost < mfj.combinedAnnualCost ? "mfs" : "mfj";
  const winner = recommendation === "mfs" ? mfs : mfj;
  const loser = recommendation === "mfs" ? mfj : mfs;

  return {
    mfj,
    mfs,
    recommendation,
    netAnnualBenefit: round0(loser.combinedAnnualCost - winner.combinedAnnualCost),
    netMonthlyBenefit: round0((loser.combinedAnnualCost - winner.combinedAnnualCost) / 12),
    studentLoanSavings: round0(mfj.studentLoanAnnualPayment - mfs.studentLoanAnnualPayment),
    additionalTaxes: round0(
      mfs.federalTax + mfs.stateTax - (mfj.federalTax + mfj.stateTax),
    ),
    communityPropertyApplied: split.applied,
    communityPropertyNote: split.note,
  };
}

function round0(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}
