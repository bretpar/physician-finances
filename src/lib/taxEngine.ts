// US Federal Tax Engine — 2024 brackets, SE tax, safe harbor, time-based tracking
// All rates/brackets stored here for easy annual updates

export interface TaxBracket {
  min: number;
  max: number;
  rate: number;
}

export const BRACKETS_SINGLE: TaxBracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: Infinity, rate: 0.37 },
];

export const BRACKETS_MFJ: TaxBracket[] = [
  { min: 0, max: 23200, rate: 0.10 },
  { min: 23200, max: 94300, rate: 0.12 },
  { min: 94300, max: 201050, rate: 0.22 },
  { min: 201050, max: 383900, rate: 0.24 },
  { min: 383900, max: 487450, rate: 0.32 },
  { min: 487450, max: 731200, rate: 0.35 },
  { min: 731200, max: Infinity, rate: 0.37 },
];

export const STANDARD_DEDUCTION = { single: 14600, married_filing_jointly: 29200 };
export const SE_TAX_RATE = 0.153; // 12.4% SS + 2.9% Medicare
export const SE_INCOME_FACTOR = 0.9235; // 92.35% of net SE income
export const SS_WAGE_CAP_DEFAULT = 168600;
export const MEDICARE_ADDITIONAL_THRESHOLD = { single: 200000, married_filing_jointly: 250000 };
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
  seIncome: number;
  preTaxDeductions: number;
  retirement401k: number;
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
  bnoTax: number;
  totalTaxLiability: number;
  taxesAlreadyWithheld: number;
  remainingLiability: number;
  quarterlyEstimate: number;
  effectiveRate: number;
  /** Federal income tax only as % of total income (excludes SE + B&O) */
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

export function calculateFullEstimate(params: {
  totalIncome: number;
  w2Income: number;
  seIncome: number;
  preTaxDeductions: number;
  retirement401k: number;
  businessDeductions: number;
  mileageDeduction: number;
  taxesWithheld: number;
  filingStatus: "single" | "married_filing_jointly";
  lastYearTax: number;
  standardDeductionOverride?: number | null;
  ssWageCap?: number;
  bnoRate?: number;
  remainingPayPeriods?: number;
  additionalTaxPaid?: number; // quarterly payments + tax savings
  // New tax-profile inputs
  deductionType?: "standard" | "itemized";
  itemizedDeductionAmount?: number;
  qualifyingChildrenCount?: number;
  otherDependentsCount?: number;
  /** Optional planning override for set-aside output */
  withholdingOverrideType?: "none" | "percent" | "amount";
  withholdingOverridePercent?: number | null;
  withholdingOverrideAmount?: number | null;
}): TaxEstimate {
  const {
    totalIncome, w2Income, seIncome, preTaxDeductions, retirement401k,
    businessDeductions, mileageDeduction, taxesWithheld, filingStatus,
    lastYearTax, standardDeductionOverride, ssWageCap = SS_WAGE_CAP_DEFAULT,
    bnoRate = 0.015, remainingPayPeriods = 12, additionalTaxPaid = 0,
    deductionType = "standard",
    itemizedDeductionAmount = 0,
    qualifyingChildrenCount = 0,
    otherDependentsCount = 0,
    withholdingOverrideType = "none",
    withholdingOverridePercent = null,
    withholdingOverrideAmount = null,
  } = params;

  // SE tax (calculate first — half is deductible)
  const netSEIncome = seIncome - businessDeductions - mileageDeduction;
  const seTax = calculateSETax(netSEIncome, filingStatus, ssWageCap, w2Income);

  // AGI
  const agi = totalIncome - preTaxDeductions - retirement401k - seTax.deductibleHalf;

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

  // B&O tax (WA)
  const bnoTax = seIncome * bnoRate;

  // Total
  const totalTaxLiability = federalTax + seTax.total + bnoTax;
  const totalPaid = taxesWithheld + additionalTaxPaid;
  const remainingLiability = Math.max(0, totalTaxLiability - totalPaid);

  // Quarterly
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const remainingQuarters = Math.max(1, 4 - currentQuarter + 1);
  const quarterlyEstimate = remainingLiability / remainingQuarters;

  // Rates
  const effectiveRate = calculateEffectiveRate(totalTaxLiability, totalIncome);
  const federalEffectiveRate = calculateEffectiveRate(federalTax, totalIncome);
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

  // Time-based tracking
  const tracking = calculateTimeBasedTracking({
    annualTax: totalTaxLiability,
    totalPaid,
    lastYearTax,
    agi,
  });

  return {
    totalIncome, w2Income, seIncome, preTaxDeductions, retirement401k,
    businessDeductions, mileageDeduction, agi, standardDeduction, taxableIncome,
    federalTax, seTax, bnoTax, totalTaxLiability, taxesAlreadyWithheld: taxesWithheld,
    remainingLiability, quarterlyEstimate, effectiveRate, federalEffectiveRate, marginalRate,
    safeHarborTarget, safeHarborStatus: correctedStatus, recommendedSetAside,
    tracking,
  };
}
