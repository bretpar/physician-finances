// US Federal Tax Engine — 2024 brackets, SE tax, safe harbor
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
  taxableIncome: number;
  federalTax: number;
  seTax: SelfEmploymentTax;
  bnoTax: number;
  totalTaxLiability: number;
  taxesAlreadyWithheld: number;
  remainingLiability: number;
  quarterlyEstimate: number;
  effectiveRate: number;
  marginalRate: number;
  // Safe harbor
  safeHarborTarget: number;
  safeHarborStatus: "on_track" | "behind" | "ahead";
  // Per-paycheck
  recommendedSetAside: number;
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
}): TaxEstimate {
  const {
    totalIncome, w2Income, seIncome, preTaxDeductions, retirement401k,
    businessDeductions, mileageDeduction, taxesWithheld, filingStatus,
    lastYearTax, standardDeductionOverride, ssWageCap = SS_WAGE_CAP_DEFAULT,
    bnoRate = 0.015, remainingPayPeriods = 12,
  } = params;

  // SE tax (calculate first — half is deductible)
  const netSEIncome = seIncome - businessDeductions - mileageDeduction;
  const seTax = calculateSETax(netSEIncome, filingStatus, ssWageCap, w2Income);

  // AGI
  const agi = totalIncome - preTaxDeductions - retirement401k - seTax.deductibleHalf;

  // Standard deduction
  const standardDeduction = standardDeductionOverride ?? STANDARD_DEDUCTION[filingStatus];
  const taxableIncome = Math.max(0, agi - standardDeduction);

  // Federal income tax
  const brackets = filingStatus === "married_filing_jointly" ? BRACKETS_MFJ : BRACKETS_SINGLE;
  const federalTax = calculateProgressiveTax(taxableIncome, brackets);

  // B&O tax (WA)
  const bnoTax = seIncome * bnoRate;

  // Total
  const totalTaxLiability = federalTax + seTax.total + bnoTax;
  const remainingLiability = Math.max(0, totalTaxLiability - taxesWithheld);

  // Quarterly
  const now = new Date();
  const currentQuarter = Math.floor(now.getMonth() / 3) + 1;
  const remainingQuarters = Math.max(1, 4 - currentQuarter + 1);
  const quarterlyEstimate = remainingLiability / remainingQuarters;

  // Rates
  const effectiveRate = calculateEffectiveRate(totalTaxLiability, totalIncome);
  const marginalRate = getMarginalRate(taxableIncome, brackets);

  // Safe harbor
  const safeHarbor90 = totalTaxLiability * 0.9;
  const safeHarbor100 = lastYearTax; // 100% of last year (110% if AGI > 150k handled below)
  const safeHarborHighIncome = agi > 150000 ? lastYearTax * 1.1 : lastYearTax;
  const safeHarborTarget = Math.min(safeHarbor90, safeHarborHighIncome);
  const safeHarborStatus: TaxEstimate["safeHarborStatus"] =
    taxesWithheld >= safeHarborTarget ? "on_track"
    : taxesWithheld >= safeHarborTarget * 0.8 ? "behind"
    : "ahead"; // actually behind but let's fix logic
  // Corrected: if withheld > target → ahead, if close → on_track, if far → behind
  const correctedStatus: TaxEstimate["safeHarborStatus"] =
    safeHarborTarget <= 0 ? "on_track"
    : taxesWithheld >= safeHarborTarget ? "ahead"
    : taxesWithheld >= safeHarborTarget * 0.75 ? "on_track"
    : "behind";

  // Per-paycheck recommendation
  const effectivePayPeriods = Math.max(1, remainingPayPeriods);
  const recommendedSetAside = remainingLiability / effectivePayPeriods;

  return {
    totalIncome, w2Income, seIncome, preTaxDeductions, retirement401k,
    businessDeductions, mileageDeduction, agi, standardDeduction, taxableIncome,
    federalTax, seTax, bnoTax, totalTaxLiability, taxesAlreadyWithheld: taxesWithheld,
    remainingLiability, quarterlyEstimate, effectiveRate, marginalRate,
    safeHarborTarget, safeHarborStatus: correctedStatus, recommendedSetAside,
  };
}
