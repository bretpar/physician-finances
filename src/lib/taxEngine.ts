// US Federal Tax Engine — SE tax, safe harbor, time-based tracking.
// All bracket / standard-deduction / SS-wage-base constants live in
// src/lib/taxBrackets.ts (single year-keyed source). Bump ACTIVE_TAX_YEAR
// there to roll the engine forward.

import {
  ORDINARY_BRACKETS,
  STANDARD_DEDUCTION as ACTIVE_STANDARD_DEDUCTION,
  SS_WAGE_BASE,
  ADDITIONAL_MEDICARE_THRESHOLD,
  SE_INCOME_FACTOR as ACTIVE_SE_INCOME_FACTOR,
} from "@/lib/taxBrackets";

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export const BRACKETS_SINGLE: TaxBracket[] = ORDINARY_BRACKETS.single;
export const BRACKETS_MFJ: TaxBracket[] = ORDINARY_BRACKETS.married_filing_jointly;

export const STANDARD_DEDUCTION = ACTIVE_STANDARD_DEDUCTION;
export const SE_TAX_RATE = 0.153; // 12.4% SS + 2.9% Medicare
export const SE_INCOME_FACTOR = ACTIVE_SE_INCOME_FACTOR; // 92.35% of net SE income
export const SS_WAGE_CAP_DEFAULT = SS_WAGE_BASE;
export const MEDICARE_ADDITIONAL_THRESHOLD = ADDITIONAL_MEDICARE_THRESHOLD;
export const MEDICARE_ADDITIONAL_RATE = 0.009; // 0.9%

export function calculateProgressiveTax(taxableIncome: number, brackets: TaxBracket[]): number {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const taxable = Math.min(taxableIncome, b.max) - b.min;
    tax += taxable * b.rate;
  }
  return tax;
}

export function calculateEffectiveRate(tax: number, income: number): number {
  if (income <= 0) return 0;
  return (tax / income) * 100;
}

export function getMarginalRate(taxableIncome: number, brackets: TaxBracket[]): number {
  if (taxableIncome <= 0) return 0;
  for (const b of brackets) {
    if (taxableIncome <= b.max) return b.rate * 100;
  }
  return brackets[brackets.length - 1].rate * 100;
}

export interface SelfEmploymentTax {
  ssTax: number;
  medicareTax: number;
  additionalMedicare: number;
  total: number;
  deductibleHalf: number;
}

export function calculateSETax(
  netSEIncome: number,
  filingStatus: "single" | "married_filing_jointly",
  ssWageCap: number = SS_WAGE_CAP_DEFAULT,
  w2Wages: number = 0
): SelfEmploymentTax {
  if (netSEIncome <= 0) return { ssTax: 0, medicareTax: 0, additionalMedicare: 0, total: 0, deductibleHalf: 0 };

  const seBase = netSEIncome * SE_INCOME_FACTOR;

  // SS: 12.4% up to wage cap, minus W-2 wages already subject to SS
  const ssRemaining = Math.max(0, ssWageCap - w2Wages);
  const ssTaxable = Math.min(seBase, ssRemaining);
  const ssTax = ssTaxable * 0.124;

  // Medicare: 2.9% on all SE income
  const medicareTax = seBase * 0.029;

  // Additional Medicare: 0.9% over threshold
  const threshold = MEDICARE_ADDITIONAL_THRESHOLD[filingStatus];
  const totalEarnings = w2Wages + seBase;
  const additionalMedicare = totalEarnings > threshold
    ? Math.min(seBase, totalEarnings - threshold) * MEDICARE_ADDITIONAL_RATE
    : 0;

  const total = ssTax + medicareTax + additionalMedicare;
  const deductibleHalf = total / 2;

  return { ssTax, medicareTax, additionalMedicare, total, deductibleHalf };
}

// --- Time-based tracking types ---
export type TrackingStatus = "on_track" | "ahead" | "slightly_behind" | "behind";

export interface TimeBasedTracking {
  daysElapsed: number;
  daysInYear: number;
  yearProgress: number; // 0-1
  expectedTaxToDate: number;
  totalPaid: number; // withheld + quarterly payments + savings
  difference: number; // positive = ahead, negative = behind
  percentDeviation: number; // how far off from expected (%)
  status: TrackingStatus;
  statusLabel: string;
  remainingTax: number;
  monthsRemaining: number;
  suggestedMonthlyPayment: number;
  // Safe harbor
  safeHarborTarget: number;
  safeHarborProgress: number; // 0-100
  safeHarborMet: boolean;
  safeHarborLabel: string;
  // Progress bar
  paidVsExpectedPercent: number; // % of expected taxes paid (can exceed 100)
}

export function calculateTimeBasedTracking(params: {
  annualTax: number;
  totalPaid: number; // all taxes paid/withheld/saved
  lastYearTax: number;
  agi: number;
}): TimeBasedTracking {
  const { annualTax, totalPaid, lastYearTax, agi } = params;

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const endOfYear = new Date(now.getFullYear(), 11, 31);
  const daysInYear = Math.ceil((endOfYear.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const daysElapsed = Math.ceil((now.getTime() - startOfYear.getTime()) / (1000 * 60 * 60 * 24));
  const yearProgress = daysElapsed / daysInYear;

  const expectedTaxToDate = annualTax * yearProgress;
  const difference = totalPaid - expectedTaxToDate;
  const percentDeviation = expectedTaxToDate > 0 ? (difference / expectedTaxToDate) * 100 : 0;

  // Status: only warning if >10% behind
  let status: TrackingStatus;
  let statusLabel: string;
  if (difference >= 0) {
    status = "ahead";
    statusLabel = `Ahead by ${formatCurrency(difference)}`;
  } else if (percentDeviation >= -10) {
    status = "on_track";
    statusLabel = "On Track";
  } else if (percentDeviation >= -25) {
    status = "slightly_behind";
    statusLabel = `Slightly behind by ${formatCurrency(Math.abs(difference))}`;
  } else {
    status = "behind";
    statusLabel = `Behind by ${formatCurrency(Math.abs(difference))}`;
  }

  // Forward-looking recommendation
  const remainingTax = Math.max(0, annualTax - totalPaid);
  const monthsRemaining = Math.max(1, 12 - now.getMonth());
  const suggestedMonthlyPayment = remainingTax / monthsRemaining;

  // Safe harbor: min of 90% current year or 100%/110% of last year
  const safeHarbor90 = annualTax * 0.9;
  const safeHarborLastYear = agi > 150000 ? lastYearTax * 1.1 : lastYearTax;
  const safeHarborTarget = lastYearTax > 0 ? Math.min(safeHarbor90, safeHarborLastYear) : safeHarbor90;
  const safeHarborProgress = safeHarborTarget > 0 ? Math.min(100, (totalPaid / safeHarborTarget) * 100) : 100;
  const safeHarborMet = totalPaid >= safeHarborTarget;
  const safeHarborLabel = safeHarborMet ? "Safe from penalties" : "May owe at filing";

  // Progress bar: % of expected taxes paid
  const paidVsExpectedPercent = expectedTaxToDate > 0 ? Math.min(200, (totalPaid / expectedTaxToDate) * 100) : 100;

  return {
    daysElapsed, daysInYear, yearProgress,
    expectedTaxToDate, totalPaid, difference, percentDeviation,
    status, statusLabel,
    remainingTax, monthsRemaining, suggestedMonthlyPayment,
    safeHarborTarget, safeHarborProgress, safeHarborMet, safeHarborLabel,
    paidVsExpectedPercent,
  };
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export interface TaxEstimate {
  totalIncome: number;
  w2Income: number;
  /** True self-employment income (Schedule C + active K-1 partnership) used for SE tax. */
  seIncome: number;
  /** All business gross receipts (SE + S-Corp distributions etc.) — display only. */
  grossBusinessIncome: number;
  /** Ordinary business operating expenses (reduce business profit). */
  businessExpenses: number;
  /** Net business profit = gross business income − business expenses − mileage. */
  netBusinessProfit: number;
  /** Other taxable income that is neither W-2 nor business (cap gains, dividends, rental, etc.). */
  otherIncome: number;
  /** w2 + netBusinessProfit + otherIncome — what flows onto a 1040 before adjustments. */
  totalReturnIncomeBeforeAdjustments: number;
  /** Payroll pre-tax deductions already removed from W-2 wages before AGI adjustments. */
  w2PreTaxDeductions: number;
  /** W-2 gross income minus payroll pre-tax deductions. */
  w2TaxableIncomeBase: number;
  preTaxDeductions: number;
  retirement401k: number;
  healthInsuranceDeduction: number;
  /** Half of SE tax — above-the-line adjustment to AGI. */
  halfSETaxDeduction: number;
  businessDeductions: number;
  mileageDeduction: number;
  agi: number;
  standardDeduction: number;
  /** Resolved deduction actually applied — standard or itemized */
  deductionApplied: number;
  /** "standard" or "itemized" */
  deductionType: "standard" | "itemized";
  taxableIncome: number;
  federalTaxBeforeCredits: number;
  /** Total credits applied (CTC + ODC, with phase-out) */
  taxCredits: number;
  federalTax: number;
  seTax: SelfEmploymentTax;
  /** State income tax owed (personal). Includes withheld floor; never negative. */
  personalStateTax: number;
  /** State income tax owed (business). Net of any provided business state withholding. Never negative. */
  businessStateTax: number;
  /** Backwards-compat alias = personalStateTax + businessStateTax. */
  stateTax: number;
  totalTaxLiability: number;
  taxesAlreadyWithheld: number;
  /** Federal-only withholding included in taxesAlreadyWithheld. */
  federalWithheld: number;
  /** State-only withholding (separate from federal). */
  stateWithheld: number;
  remainingLiability: number;
  quarterlyEstimate: number;
  effectiveRate: number;
  /** Federal income tax only as % of total income (excludes SE) */
  federalEffectiveRate: number;
  marginalRate: number;
  // Safe harbor (legacy)
  safeHarborTarget: number;
  safeHarborStatus: "on_track" | "behind" | "ahead";
  // Per-paycheck
  recommendedSetAside: number;
  /** When user provides a withholding override, this reflects their target.
   *  Otherwise equals recommendedSetAside. */
  targetSetAside: number;
  // Time-based tracking
  tracking: TimeBasedTracking;
}

/** Compute Child Tax Credit + Other Dependent Credit with high-income phase-out.
 *  CTC: $2,000/qualifying child. ODC: $500/other dependent.
 *  Phase-out begins at $200k single / $400k MFJ; $50 reduction per $1,000 over (or fraction). */
export function calculateDependentCredits(
  qualifyingChildren: number,
  otherDependents: number,
  agi: number,
  filingStatus: "single" | "married_filing_jointly",
): number {
  const baseCredit = Math.max(0, qualifyingChildren) * 2000 + Math.max(0, otherDependents) * 500;
  if (baseCredit <= 0) return 0;
  const threshold = filingStatus === "married_filing_jointly" ? 400000 : 200000;
  if (agi <= threshold) return baseCredit;
  const over = agi - threshold;
  const reduction = Math.ceil(over / 1000) * 50;
  return Math.max(0, baseCredit - reduction);
}

export interface StateTaxInputs {
  /** Personal state income tax switch. Business state tax is controlled separately. */
  stateIncomeTaxEnabled?: boolean;
  /** Backwards-compatible alias for personal state income tax only. */
  stateTaxEnabled?: boolean;
  /** Personal state tax mode: 'none' | 'flat_rate' | 'annual_estimate'. */
  personalStateTaxMode?: "none" | "flat_rate" | "annual_estimate";
  /** Personal state tax rate (percent, e.g. 4.5). Used when mode='flat_rate'. */
  personalStateTaxRate?: number;
  /** Personal annual state tax estimate ($). Used when mode='annual_estimate'. */
  personalStateTaxAnnualEstimate?: number;
  /** Personal-only taxable base so business profit is never taxed as personal state income. */
  personalStateTaxableIncome?: number;
  /** Withholding already paid to state on personal income. */
  personalStateWithheld?: number;
  /** Business state tax: enabled + rate (percent). */
  businessStateTaxEnabled?: boolean;
  businessStateTaxRate?: number;
  /** Business state tax base for the *eligible* portion of business income. */
  businessStateTaxBase?: "net_profit" | "gross";
  /** Eligible business gross income (already filtered by application mode + per-company toggle). */
  eligibleBusinessGross?: number;
  /** Eligible business expenses (proportional, used when base='net_profit'). */
  eligibleBusinessExpenses?: number;
  /** Eligible mileage deduction (proportional). */
  eligibleBusinessMileage?: number;
  /** Eligible owner healthcare + retirement (subtracted when base='net_profit'). */
  eligibleBusinessOwnerAdjustments?: number;
  /** Withholding already paid to state on business income. */
  businessStateWithheld?: number;
}

export function calculatePersonalStateTax(args: {
  taxableIncome: number;
  agi: number;
  inputs: StateTaxInputs;
}): { tax: number; withheld: number } {
  const { taxableIncome, agi, inputs } = args;
  const withheld = Math.max(0, inputs.personalStateWithheld || 0);

  if (inputs.stateIncomeTaxEnabled ?? inputs.stateTaxEnabled) {
    let gross = 0;
    if (inputs.personalStateTaxMode === "flat_rate") {
      const base = inputs.personalStateTaxableIncome ?? taxableIncome;
      gross = Math.max(0, base) * ((inputs.personalStateTaxRate || 0) / 100);
    } else if (inputs.personalStateTaxMode === "annual_estimate") {
      gross = Math.max(0, inputs.personalStateTaxAnnualEstimate || 0);
    }
    // mode='none' → 0
    const due = Math.max(0, gross - withheld);
    return { tax: due, withheld };
  }

  return { tax: 0, withheld };
}

export function calculateBusinessStateTax(args: {
  inputs: StateTaxInputs;
}): { tax: number; withheld: number } {
  const { inputs } = args;
  const withheld = Math.max(0, inputs.businessStateWithheld || 0);
  if (!inputs.businessStateTaxEnabled) return { tax: 0, withheld };
  const rate = (inputs.businessStateTaxRate || 0) / 100;
  if (rate <= 0) return { tax: 0, withheld };
  const gross = Math.max(0, inputs.eligibleBusinessGross || 0);
  const base = inputs.businessStateTaxBase === "gross"
    ? gross
    : Math.max(
        0,
        gross
          - (inputs.eligibleBusinessExpenses || 0)
          - (inputs.eligibleBusinessMileage || 0)
          - (inputs.eligibleBusinessOwnerAdjustments || 0),
      );
  const due = Math.max(0, base * rate - withheld);
  return { tax: due, withheld };
}

export function calculateFullEstimate(params: {
  totalIncome: number;
  w2Income: number;
  /** True SE income (Schedule C + K-1 partnership active earnings) used for SE tax base. */
  seIncome: number;
  /** Expenses assigned to SE-taxable companies. Defaults to all business deductions for backwards compatibility. */
  seBusinessDeductions?: number;
  /** Mileage assigned to SE-taxable companies. Defaults to all mileage deductions for backwards compatibility. */
  seMileageDeduction?: number;
  /** All business gross receipts (SE + S-Corp distributions, etc.) — display only. */
  grossBusinessIncome?: number;
  /** Other taxable income that is not W-2 and not business (cap gains, dividends, rental…). */
  otherIncome?: number;
  /** W-2 payroll pre-tax deductions; subtracted once before total return income. */
  w2PreTaxDeductions?: number;
  /** Non-W-2 pre-tax above-the-line deductions only. */
  preTaxDeductions: number;
  retirement401k: number;
  healthInsuranceDeduction?: number;
  businessDeductions: number;
  mileageDeduction: number;
  taxesWithheld: number;
  filingStatus: "single" | "married_filing_jointly";
  lastYearTax: number;
  standardDeductionOverride?: number | null;
  ssWageCap?: number;
  remainingPayPeriods?: number;
  additionalTaxPaid?: number;
  deductionType?: "standard" | "itemized";
  itemizedDeductionAmount?: number;
  qualifyingChildrenCount?: number;
  otherDependentsCount?: number;
  withholdingOverrideType?: "none" | "percent" | "amount";
  withholdingOverridePercent?: number | null;
  withholdingOverrideAmount?: number | null;
  stateTaxInputs?: StateTaxInputs;
}): TaxEstimate {
  const {
    totalIncome, w2Income, seIncome,
    seBusinessDeductions: seBusinessDeductionsParam,
    seMileageDeduction: seMileageDeductionParam,
    grossBusinessIncome: grossBusinessIncomeParam,
    otherIncome: otherIncomeParam,
    w2PreTaxDeductions: w2PreTaxDeductionsParam = 0,
    preTaxDeductions, retirement401k,
    healthInsuranceDeduction = 0,
    businessDeductions, mileageDeduction, taxesWithheld, filingStatus,
    lastYearTax, standardDeductionOverride, ssWageCap = SS_WAGE_CAP_DEFAULT,
    remainingPayPeriods = 12, additionalTaxPaid = 0,
    deductionType = "standard",
    itemizedDeductionAmount = 0,
    qualifyingChildrenCount = 0,
    otherDependentsCount = 0,
    withholdingOverrideType = "none",
    withholdingOverridePercent = null,
    withholdingOverrideAmount = null,
    stateTaxInputs = {},
  } = params;

  // Default backward-compat: if caller didn't separate, treat seIncome as both
  // gross business and SE-eligible. otherIncome defaults to whatever's left of
  // totalIncome after w2 + business.
  const seBusinessDeductions = seBusinessDeductionsParam ?? businessDeductions;
  const seMileageDeduction = seMileageDeductionParam ?? mileageDeduction;
  const grossBusinessIncome = grossBusinessIncomeParam ?? seIncome;
  const otherIncome = otherIncomeParam ?? Math.max(0, totalIncome - w2Income - grossBusinessIncome);
  const w2PreTaxDeductions = Math.max(0, w2PreTaxDeductionsParam);
  const w2TaxableIncomeBase = Math.max(0, w2Income - w2PreTaxDeductions);

  // SE tax — only on TRUE self-employment net income
  const netSEIncome = seIncome - seBusinessDeductions - seMileageDeduction;
  const seTax = calculateSETax(netSEIncome, filingStatus, ssWageCap, w2Income);

  // Net business profit (display) — uses gross business income (all biz) minus
  // expenses & mileage. May differ from netSEIncome when SE-ineligible business
  // income (e.g. S-Corp distributions) is present.
  const netBusinessProfit = grossBusinessIncome - businessDeductions - mileageDeduction;

  // Total return income uses W-2 after payroll pre-tax deductions, so those deductions are counted exactly once.
  const totalReturnIncomeBeforeAdjustments = w2TaxableIncomeBase + netBusinessProfit + otherIncome;

  // AGI = return income - non-W-2 above-the-line adjustments (no duplicate W-2 pre-tax subtraction).
  const agi = totalReturnIncomeBeforeAdjustments - preTaxDeductions - retirement401k - healthInsuranceDeduction - seTax.deductibleHalf;

  // Standard deduction (fallback) and resolved deduction applied
  const standardDeduction = standardDeductionOverride ?? STANDARD_DEDUCTION[filingStatus];
  const deductionApplied = deductionType === "itemized"
    ? Math.max(0, itemizedDeductionAmount)
    : standardDeduction;
  const taxableIncome = Math.max(0, agi - deductionApplied);

  // Federal income tax (before credits)
  const brackets = filingStatus === "married_filing_jointly" ? BRACKETS_MFJ : BRACKETS_SINGLE;
  const federalTaxBeforeCredits = calculateProgressiveTax(taxableIncome, brackets);

  // Dependent credits (reduce federal tax, not income)
  const taxCredits = calculateDependentCredits(qualifyingChildrenCount, otherDependentsCount, agi, filingStatus);
  const federalTax = Math.max(0, federalTaxBeforeCredits - taxCredits);

  // ── State tax (separate engine; floored at 0; withholding only offsets state) ──
  const personal = calculatePersonalStateTax({ taxableIncome, agi, inputs: stateTaxInputs });
  const business = calculateBusinessStateTax({ inputs: stateTaxInputs });
  const personalStateTax = personal.tax;
  const businessStateTax = business.tax;
  const stateTax = personalStateTax + businessStateTax;
  const stateWithheld = personal.withheld + business.withheld;

  // Total liability includes state tax due (already net of state withholding)
  const totalTaxLiability = federalTax + seTax.total + stateTax;
  // taxesWithheld passed in is FEDERAL-side withholding only (state isolated)
  const federalWithheld = Math.max(0, taxesWithheld);
  const totalPaid = federalWithheld + additionalTaxPaid;
  const remainingLiability = Math.max(0, totalTaxLiability - totalPaid);

  // Quarterly
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const remainingQuarters = Math.max(1, 4 - currentQuarter + 1);
  const quarterlyEstimate = remainingLiability / remainingQuarters;

  // Rates
  const effectiveRate = calculateEffectiveRate(totalTaxLiability, totalReturnIncomeBeforeAdjustments);
  const federalEffectiveRate = calculateEffectiveRate(federalTax, totalReturnIncomeBeforeAdjustments);
  const marginalRate = getMarginalRate(taxableIncome, brackets);

  // Safe harbor (legacy compat)
  const safeHarbor90 = totalTaxLiability * 0.9;
  const safeHarborHighIncome = agi > 150000 ? lastYearTax * 1.1 : lastYearTax;
  const safeHarborTarget = lastYearTax > 0 ? Math.min(safeHarbor90, safeHarborHighIncome) : safeHarbor90;
  const correctedStatus: TaxEstimate["safeHarborStatus"] =
    safeHarborTarget <= 0 ? "on_track"
    : totalPaid >= safeHarborTarget ? "ahead"
    : totalPaid >= safeHarborTarget * 0.75 ? "on_track"
    : "behind";

  // Per-paycheck recommendation
  const effectivePayPeriods = Math.max(1, remainingPayPeriods);
  const recommendedSetAside = remainingLiability / effectivePayPeriods;

  // Optional withholding override (planning layer — does NOT change underlying tax math)
  let targetSetAside = recommendedSetAside;
  if (withholdingOverrideType === "percent" && withholdingOverridePercent != null) {
    const annualTarget = totalIncome * (withholdingOverridePercent / 100);
    const remainingTarget = Math.max(0, annualTarget - totalPaid);
    targetSetAside = remainingTarget / effectivePayPeriods;
  } else if (withholdingOverrideType === "amount" && withholdingOverrideAmount != null) {
    targetSetAside = withholdingOverrideAmount;
  }

  // Time-based tracking
  const tracking = calculateTimeBasedTracking({
    annualTax: totalTaxLiability,
    totalPaid,
    lastYearTax,
    agi,
  });

  return {
    totalIncome, w2Income, seIncome,
    grossBusinessIncome,
    businessExpenses: businessDeductions,
    netBusinessProfit,
    otherIncome,
    totalReturnIncomeBeforeAdjustments,
    w2PreTaxDeductions,
    w2TaxableIncomeBase,
    halfSETaxDeduction: seTax.deductibleHalf,
    preTaxDeductions, retirement401k, healthInsuranceDeduction,
    businessDeductions, mileageDeduction, agi, standardDeduction, taxableIncome,
    deductionApplied, deductionType,
    federalTaxBeforeCredits, taxCredits,
    federalTax, seTax,
    personalStateTax, businessStateTax, stateTax,
    totalTaxLiability,
    taxesAlreadyWithheld: federalWithheld,
    federalWithheld, stateWithheld,
    remainingLiability, quarterlyEstimate, effectiveRate, federalEffectiveRate, marginalRate,
    safeHarborTarget, safeHarborStatus: correctedStatus, recommendedSetAside, targetSetAside,
    tracking,
  };
}
