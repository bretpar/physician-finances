/**
 * MFJ vs MFS comparison for student loan strategy.
 *
 * READ-ONLY: this module never persists or mutates user tax settings.
 * It calls the canonical tax engine (`calculateFullEstimate`) for BOTH
 * MFJ and MFS scenarios (per-spouse for MFS), so bracket / standard
 * deduction / phase-out logic stays in one place. This module contains
 * ZERO standalone federal bracket math.
 *
 * IMPORTANT: The student-loan calculator receives the tax engine's
 * returned `agi` (adjusted gross income), NOT raw total income. This
 * matches how FSA's official IDR forms treat AGI.
 *
 * MFJ: household AGI is passed once to the loan calculator as
 * `annualIncome` with `spouseAnnualIncome = 0` — spouse income must
 * NEVER be added again on top of a joint AGI.
 *
 * MFS in a community-property state: borrower/spouse AGI is derived
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
import type { PovertyRegion } from "./rules/types";

export interface MfsComparisonInput {
  /**
   * Borrower's individually earned projected income (wages, SE). The MFJ
   * scenario's household income is `userIncome + spouseIncome` — callers
   * MUST NOT pre-add spouse income here.
   */
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
  /**
   * Optional AGI overrides. When provided, these bypass the income→AGI
   * derivation and are used directly as the AGI for both the tax
   * calculation (passed as totalIncome with zero adjustments) and the
   * student loan payment (passed as annualIncome to the calculator).
   * This lets the UI treat AGI as the primary comparison input.
   */
  overrideJointAgi?: number | null;
  overrideBorrowerMfsAgi?: number | null;
  overrideSpouseMfsAgi?: number | null;
}

export interface FilingScenarioResult {
  label: string;
  federalTax: number;
  stateTax: number;
  /** AGI as returned by the tax engine (used as studentLoanAGI). */
  agi: number;
  studentLoanAgi: number;
  studentLoanAnnualPayment: number;
  studentLoanMonthlyPayment: number;
  combinedAnnualCost: number;
  combinedMonthlyCost: number;
  /** MFS only — per-spouse federal tax breakdown (for annual details table). */
  borrowerFederalTax?: number;
  spouseFederalTax?: number;
  borrowerStateTax?: number;
  spouseStateTax?: number;
  /** MFS only — spouse's separate-return AGI (borrower AGI = `agi`). */
  spouseAgi?: number;
}

export interface MfsComparisonResult {
  mfj: FilingScenarioResult;
  mfs: FilingScenarioResult;
  recommendation: "mfj" | "mfs";
  netAnnualBenefit: number;
  netMonthlyBenefit: number;
  studentLoanSavings: number;
  monthlyLoanSavings: number;
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

function povertyRegionForState(state: string): PovertyRegion {
  const s = (state || "").toUpperCase();
  if (s === "AK") return "alaska";
  if (s === "HI") return "hawaii";
  return "contiguous_48_dc";
}

/**
 * Call the canonical tax engine for one filing-status scenario. When an
 * AGI override is provided, we pass it as `w2Income`/`totalIncome` with
 * zero adjustments so the engine's returned AGI equals the override.
 */
function runEngine(params: {
  filingStatus: "single" | "married_filing_jointly" | "married_filing_separately";
  overrideAgi: number | null;
  fallbackIncome: number;
  adjustments: number;
  deductionType: "standard" | "itemized";
  itemizedDeductionAmount: number;
}) {
  const useOverride = params.overrideAgi != null;
  const income = useOverride ? (params.overrideAgi as number) : Math.max(0, params.fallbackIncome);
  const preTaxDeductions = useOverride ? 0 : Math.max(0, params.adjustments);
  return calculateFullEstimate({
    totalIncome: income,
    w2Income: income,
    seIncome: 0,
    preTaxDeductions,
    retirement401k: 0,
    businessDeductions: 0,
    mileageDeduction: 0,
    taxesWithheld: 0,
    filingStatus: params.filingStatus,
    lastYearTax: 0,
    deductionType: params.deductionType,
    itemizedDeductionAmount: params.itemizedDeductionAmount,
  });
}

export function compareFilingStatuses(input: MfsComparisonInput): MfsComparisonResult {
  const totalIncome = Math.max(0, input.userIncome) + Math.max(0, input.spouseIncome);
  const stateRate = input.stateTaxRatePct ?? 0;
  const itemized = input.itemizedDeductionAmount ?? 0;
  const deductionType = itemized > 0 ? "itemized" : "standard";
  const cpEligible = isCommunityPropertyState(input.state);
  const applyCP = cpEligible && input.applyCommunityRules;
  const region = povertyRegionForState(input.state);

  // ── MFJ scenario ────────────────────────────────────────────────
  const jointAgiOverride =
    input.overrideJointAgi != null && Number.isFinite(input.overrideJointAgi) && input.overrideJointAgi >= 0
      ? input.overrideJointAgi
      : null;
  const mfjEstimate = runEngine({
    filingStatus: "married_filing_jointly",
    overrideAgi: jointAgiOverride,
    fallbackIncome: totalIncome,
    adjustments: (input.borrowerAdjustments ?? 0) + (input.spouseAdjustments ?? 0),
    deductionType,
    itemizedDeductionAmount: itemized,
  });
  // CRITICAL FIX (spouse double-count): joint AGI already reflects both
  // spouses, so `spouseAnnualIncome` MUST be 0 here. The registry-driven
  // MFJ "combined" rule would otherwise add spouse income on top of an
  // already-joint AGI.
  const mfjBorrower: BorrowerInput = {
    filingStatus: "married_filing_jointly",
    familySize: input.familySize,
    annualIncome: mfjEstimate.agi,
    spouseAnnualIncome: 0,
    region,
  };
  const mfjLoan = estimateRepayment(input.loan, mfjBorrower, input.planId);
  const mfjStateTax = estimateStateTax(mfjEstimate.taxableIncome, stateRate);
  const mfjTotalAnnual = mfjEstimate.federalTax + mfjStateTax + mfjLoan.estimatedAnnualPayment;
  const mfj: FilingScenarioResult = {
    label: "Married Filing Jointly",
    federalTax: round0(mfjEstimate.federalTax),
    stateTax: round0(mfjStateTax),
    agi: round0(mfjEstimate.agi),
    studentLoanAgi: round0(mfjEstimate.agi),
    studentLoanAnnualPayment: round0(mfjLoan.estimatedAnnualPayment),
    studentLoanMonthlyPayment: round0(mfjLoan.estimatedMonthlyPayment),
    combinedAnnualCost: round0(mfjTotalAnnual),
    combinedMonthlyCost: round0(mfjTotalAnnual / 12),
  };

  // ── MFS scenario ────────────────────────────────────────────────
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

  const borrowerAgiOverride =
    input.overrideBorrowerMfsAgi != null && Number.isFinite(input.overrideBorrowerMfsAgi) && input.overrideBorrowerMfsAgi >= 0
      ? input.overrideBorrowerMfsAgi
      : null;
  const spouseAgiOverride =
    input.overrideSpouseMfsAgi != null && Number.isFinite(input.overrideSpouseMfsAgi) && input.overrideSpouseMfsAgi >= 0
      ? input.overrideSpouseMfsAgi
      : null;

  // MFS taxes now run through the canonical tax engine with
  // `married_filing_separately` — no standalone bracket math here.
  const borrowerEstimate = runEngine({
    filingStatus: "married_filing_separately",
    overrideAgi: borrowerAgiOverride,
    fallbackIncome: borrowerAllocatedIncome,
    adjustments: borrowerAdj,
    deductionType,
    itemizedDeductionAmount: itemized / 2,
  });
  const spouseEstimate = runEngine({
    filingStatus: "married_filing_separately",
    overrideAgi: spouseAgiOverride,
    fallbackIncome: spouseAllocatedIncome,
    adjustments: spouseAdj,
    deductionType,
    itemizedDeductionAmount: itemized / 2,
  });
  const borrowerAgi = borrowerEstimate.agi;
  const spouseAgi = spouseEstimate.agi;

  const mfsBorrower: BorrowerInput = {
    filingStatus: "married_filing_separately",
    familySize: input.familySize,
    annualIncome: borrowerAgi,
    region,
  };
  const mfsLoan = estimateRepayment(input.loan, mfsBorrower, input.planId);
  const mfsFederal = borrowerEstimate.federalTax + spouseEstimate.federalTax;
  const borrowerStateTax = estimateStateTax(borrowerEstimate.taxableIncome, stateRate);
  const spouseStateTax = estimateStateTax(spouseEstimate.taxableIncome, stateRate);
  const mfsState = borrowerStateTax + spouseStateTax;
  const mfsTotalAnnual = mfsFederal + mfsState + mfsLoan.estimatedAnnualPayment;
  const mfs: FilingScenarioResult = {
    label: "Married Filing Separately",
    federalTax: round0(mfsFederal),
    stateTax: round0(mfsState),
    agi: round0(borrowerAgi),
    studentLoanAgi: round0(borrowerAgi),
    studentLoanAnnualPayment: round0(mfsLoan.estimatedAnnualPayment),
    studentLoanMonthlyPayment: round0(mfsLoan.estimatedMonthlyPayment),
    combinedAnnualCost: round0(mfsTotalAnnual),
    combinedMonthlyCost: round0(mfsTotalAnnual / 12),
    borrowerFederalTax: round0(borrowerEstimate.federalTax),
    spouseFederalTax: round0(spouseEstimate.federalTax),
    borrowerStateTax: round0(borrowerStateTax),
    spouseStateTax: round0(spouseStateTax),
    spouseAgi: round0(spouseAgi),
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
    monthlyLoanSavings: round0(mfj.studentLoanMonthlyPayment - mfs.studentLoanMonthlyPayment),
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
