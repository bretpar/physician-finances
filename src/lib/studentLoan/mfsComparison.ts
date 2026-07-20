/**
 * MFJ vs MFS comparison for student loan strategy.
 *
 * READ-ONLY: this module never persists or mutates user tax settings.
 * It requests two tax estimates from the canonical engine
 * (`calculateFullEstimate`) — one MFJ, one MFS-per-spouse — and pairs the
 * results with student loan payment estimates so the UI can display a
 * combined annual cost comparison and a "recommended filing status" card.
 *
 * IMPORTANT: The student-loan calculator receives the tax engine's
 * returned `agi` (adjusted gross income), NOT raw total income. This
 * matches how FSA's official IDR forms treat AGI.
 *
 * For MFS in a community property state, borrower/spouse AGI is derived
 * from `allocateCommunityAgi` (50% community + 100% separate ± allocated
 * adjustments) rather than raw individual wages.
 *
 * Spouse-income treatment per plan is read from the canonical rules
 * registry (`rules/plans.ts`) — do NOT hardcode assumptions here.
 */

import { calculateFullEstimate } from "@/lib/taxEngine";
import { estimateRepayment, type BorrowerInput, type StudentLoanInput } from "./calculator";
import { allocateCommunityAgi, isCommunityPropertyState } from "./communityProperty";
import { getPlan } from "./rules/plans";
import type { RepaymentPlanId } from "./repaymentPlans";

export interface MfsComparisonInput {
  /** Borrower's individually earned projected income (wages, SE). */
  userIncome: number;
  /** Spouse's individually earned projected income. */
  spouseIncome: number;
  loan: StudentLoanInput;
  planId: RepaymentPlanId;
  familySize: number;
  state: string;
  /** True if the couple lives in a community-property state and wants the 50/50 split applied. */
  applyCommunityRules: boolean;
  /** Optional user income share override (0..1). Only used when `applyCommunityRules` is true. */
  userShareOverride?: number | null;
  /** Borrower's allocated above-the-line AGI adjustments (retirement, HSA, half SE, etc.). */
  borrowerAdjustments?: number;
  /** Spouse's allocated above-the-line AGI adjustments. */
  spouseAdjustments?: number;
  /** Borrower's separate-property income (rare — inheritances, pre-marriage assets). */
  borrowerSeparateIncome?: number;
  /** Spouse's separate-property income. */
  spouseSeparateIncome?: number;
  /** Combined itemized deduction (0 = use standard). Passed through untouched to the tax engine. */
  itemizedDeductionAmount?: number;
  /** State income tax rate (%) applied uniformly for both scenarios (rough estimate). */
  stateTaxRatePct?: number;
}

export interface FilingScenarioResult {
  label: string;
  federalTax: number;
  stateTax: number;
  /** AGI as returned by the tax engine (used as studentLoanAGI). */
  agi: number;
  studentLoanAgi: number;
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
  const cpEligible = isCommunityPropertyState(input.state);
  const applyCP = cpEligible && input.applyCommunityRules;

  // ── MFJ scenario — use joint AGI returned by the tax engine ──────
  const mfjEstimate = calculateFullEstimate({
    totalIncome,
    w2Income: totalIncome,
    seIncome: 0,
    preTaxDeductions: (input.borrowerAdjustments ?? 0) + (input.spouseAdjustments ?? 0),
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
    annualIncome: mfjEstimate.agi, // ← engine-derived joint AGI, not raw total income
  };
  const mfjLoan = estimateRepayment(input.loan, mfjBorrower, input.planId);
  const mfjStateTax = estimateStateTax(mfjEstimate.taxableIncome, stateRate);
  const mfj: FilingScenarioResult = {
    label: "Married Filing Jointly",
    federalTax: round0(mfjEstimate.federalTax),
    stateTax: round0(mfjStateTax),
    agi: round0(mfjEstimate.agi),
    studentLoanAgi: round0(mfjEstimate.agi),
    studentLoanAnnualPayment: round0(mfjLoan.estimatedAnnualPayment),
    combinedAnnualCost: round0(mfjEstimate.federalTax + mfjStateTax + mfjLoan.estimatedAnnualPayment),
    combinedMonthlyCost: round0((mfjEstimate.federalTax + mfjStateTax + mfjLoan.estimatedAnnualPayment) / 12),
  };

  // ── MFS scenario ────────────────────────────────────────────────
  // 1) Allocate borrower/spouse income + adjustments per community
  //    property rules (or straight through in a separate-property state).
  const allocation = applyCP
    ? allocateCommunityAgi({
        borrowerCommunityIncome: input.userIncome,
        spouseCommunityIncome: input.spouseIncome,
        borrowerSeparateIncome: input.borrowerSeparateIncome ?? 0,
        spouseSeparateIncome: input.spouseSeparateIncome ?? 0,
        borrowerAdjustments: input.borrowerAdjustments ?? 0,
        spouseAdjustments: input.spouseAdjustments ?? 0,
        borrowerCommunityShare: input.userShareOverride ?? 0.5,
      })
    : null;

  const borrowerAllocatedIncome = allocation
    ? allocation.borrowerAllocatedCommunity + allocation.borrowerSeparateIncome
    : Math.max(0, input.userIncome) + Math.max(0, input.borrowerSeparateIncome ?? 0);
  const spouseAllocatedIncome = allocation
    ? allocation.spouseAllocatedCommunity + allocation.spouseSeparateIncome
    : Math.max(0, input.spouseIncome) + Math.max(0, input.spouseSeparateIncome ?? 0);
  const borrowerAdj = input.borrowerAdjustments ?? 0;
  const spouseAdj = input.spouseAdjustments ?? 0;

  // 2) For MFS we approximate each spouse using the engine's `single`
  //    filing status. MFS brackets closely track single brackets at the
  //    incomes physicians typically deal with; results are labelled as
  //    estimates in the UI.
  const userEstimate = calculateFullEstimate({
    totalIncome: borrowerAllocatedIncome,
    w2Income: borrowerAllocatedIncome,
    seIncome: 0,
    preTaxDeductions: borrowerAdj,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "single",
    lastYearTax: 0,
    deductionType,
    itemizedDeductionAmount: itemized / 2,
  });
  const spouseEstimate = calculateFullEstimate({
    totalIncome: spouseAllocatedIncome,
    w2Income: spouseAllocatedIncome,
    seIncome: 0,
    preTaxDeductions: spouseAdj,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: "single",
    lastYearTax: 0,
    deductionType,
    itemizedDeductionAmount: itemized / 2,
  });

  const mfsBorrower: BorrowerInput = {
    filingStatus: "married_filing_separately",
    familySize: input.familySize,
    annualIncome: userEstimate.agi, // ← engine-derived MFS AGI (post-allocation, post-adjustments)
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
    agi: round0(userEstimate.agi),
    studentLoanAgi: round0(userEstimate.agi),
    studentLoanAnnualPayment: round0(mfsLoan.estimatedAnnualPayment),
    combinedAnnualCost: round0(mfsFederal + mfsState + mfsLoan.estimatedAnnualPayment),
    combinedMonthlyCost: round0((mfsFederal + mfsState + mfsLoan.estimatedAnnualPayment) / 12),
  };

  const recommendation: "mfj" | "mfs" = mfs.combinedAnnualCost < mfj.combinedAnnualCost ? "mfs" : "mfj";
  const winner = recommendation === "mfs" ? mfs : mfj;
  const loser = recommendation === "mfs" ? mfj : mfs;

  const planRule = getPlan(input.planId);
  const spouseIncomeNote = planRule?.spouseIncome
    ? `Plan spouse-income rule — MFJ: ${planRule.spouseIncome.mfj}, MFS: ${planRule.spouseIncome.mfs}.`
    : "Plan does not define a spouse-income rule (fixed schedule uses only the loan balance).";
  const cpNote = allocation
    ? allocation.note
    : cpEligible
      ? "Community property state — community income split is currently OFF."
      : "Separate-property state — each spouse reports their own income for MFS.";
  const planUnavailable =
    mfjLoan.unavailable?.reason ?? mfsLoan.unavailable?.reason ?? undefined;

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
    communityPropertyApplied: !!allocation,
    communityPropertyNote: cpNote,
    spouseIncomeNote,
    planUnavailable,
  };
}

function round0(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}
