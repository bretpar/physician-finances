/**
 * Single source of truth for tax-year constants.
 *
 * Adding a new tax year:
 *   1. Add a new entry to TAX_YEAR_CONFIGS with brackets, LTCG, standard
 *      deduction, and SS wage base for that year.
 *   2. Bump ACTIVE_TAX_YEAR.
 *
 * Everything else (taxEngine.ts, investmentTaxRecommendation.ts,
 * quickEstimate.ts, useTaxBreakdown.ts, EstimatedTax.tsx) imports the
 * active-year aliases from this file. There are no other places that
 * hardcode bracket numbers.
 */

export type FilingStatus = "single" | "married_filing_jointly" | "married_filing_separately";

export interface Bracket {
  min: number;
  max: number; // exclusive upper bound; Infinity for top
  rate: number; // 0-1
}

export interface TaxYearConfig {
  year: number;
  ordinaryBrackets: Record<FilingStatus, Bracket[]>;
  ltcgBrackets: Record<FilingStatus, Bracket[]>;
  standardDeduction: Record<FilingStatus, number>;
  ssWageBase: number;
  /** Threshold above which the 0.9% Additional Medicare Tax applies. */
  additionalMedicareThreshold: Record<FilingStatus, number>;
  /**
   * §199A QBI thresholds — taxable-income-before-QBI at which the SSTB
   * phase-out begins, plus the width of the phase-in range.
   * (Rev. Proc. inflation-indexed; $50k single / $100k MFJ range is statutory.)
   */
  qbiThresholds: Record<FilingStatus, { threshold: number; phaseIn: number }>;
}

// ── 2025 (kept for historical/comparison use) ────────────────────────────
const CONFIG_2025: TaxYearConfig = {
  year: 2025,
  ordinaryBrackets: {
    single: [
      { min: 0, max: 11925, rate: 0.10 },
      { min: 11925, max: 48475, rate: 0.12 },
      { min: 48475, max: 103350, rate: 0.22 },
      { min: 103350, max: 197300, rate: 0.24 },
      { min: 197300, max: 250525, rate: 0.32 },
      { min: 250525, max: 626350, rate: 0.35 },
      { min: 626350, max: Infinity, rate: 0.37 },
    ],
    married_filing_jointly: [
      { min: 0, max: 23850, rate: 0.10 },
      { min: 23850, max: 96950, rate: 0.12 },
      { min: 96950, max: 206700, rate: 0.22 },
      { min: 206700, max: 394600, rate: 0.24 },
      { min: 394600, max: 501050, rate: 0.32 },
      { min: 501050, max: 751600, rate: 0.35 },
      { min: 751600, max: Infinity, rate: 0.37 },
    ],
  },
  ltcgBrackets: {
    single: [
      { min: 0, max: 48350, rate: 0 },
      { min: 48350, max: 533400, rate: 0.15 },
      { min: 533400, max: Infinity, rate: 0.20 },
    ],
    married_filing_jointly: [
      { min: 0, max: 96700, rate: 0 },
      { min: 96700, max: 600050, rate: 0.15 },
      { min: 600050, max: Infinity, rate: 0.20 },
    ],
  },
  standardDeduction: { single: 15750, married_filing_jointly: 31500 },
  ssWageBase: 176100,
  additionalMedicareThreshold: { single: 200000, married_filing_jointly: 250000 },
  // §199A thresholds — Rev. Proc. 2024-40.
  qbiThresholds: {
    single: { threshold: 197300, phaseIn: 50000 },
    married_filing_jointly: { threshold: 394600, phaseIn: 100000 },
  },
};

// ── 2026 (IRS Rev. Proc. 2025-32; SSA wage base announcement Oct 2025) ───
const CONFIG_2026: TaxYearConfig = {
  year: 2026,
  ordinaryBrackets: {
    single: [
      { min: 0, max: 12400, rate: 0.10 },
      { min: 12400, max: 50400, rate: 0.12 },
      { min: 50400, max: 105700, rate: 0.22 },
      { min: 105700, max: 201775, rate: 0.24 },
      { min: 201775, max: 256225, rate: 0.32 },
      { min: 256225, max: 640600, rate: 0.35 },
      { min: 640600, max: Infinity, rate: 0.37 },
    ],
    married_filing_jointly: [
      { min: 0, max: 24800, rate: 0.10 },
      { min: 24800, max: 100800, rate: 0.12 },
      { min: 100800, max: 211400, rate: 0.22 },
      { min: 211400, max: 403550, rate: 0.24 },
      { min: 403550, max: 512450, rate: 0.32 },
      { min: 512450, max: 768700, rate: 0.35 },
      { min: 768700, max: Infinity, rate: 0.37 },
    ],
  },
  ltcgBrackets: {
    single: [
      { min: 0, max: 49450, rate: 0 },
      { min: 49450, max: 545500, rate: 0.15 },
      { min: 545500, max: Infinity, rate: 0.20 },
    ],
    married_filing_jointly: [
      { min: 0, max: 98900, rate: 0 },
      { min: 98900, max: 613700, rate: 0.15 },
      { min: 613700, max: Infinity, rate: 0.20 },
    ],
  },
  standardDeduction: { single: 16100, married_filing_jointly: 32200 },
  ssWageBase: 184500,
  additionalMedicareThreshold: { single: 200000, married_filing_jointly: 250000 },
  // §199A thresholds — Rev. Proc. 2025-32.
  qbiThresholds: {
    single: { threshold: 201775, phaseIn: 50000 },
    married_filing_jointly: { threshold: 403550, phaseIn: 100000 },
  },
};

const TAX_YEAR_CONFIGS: Record<number, TaxYearConfig> = {
  2025: CONFIG_2025,
  2026: CONFIG_2026,
};

/** Active tax year. Bump this (and add a config above) for a new year. */
export const ACTIVE_TAX_YEAR = 2026;

export function getTaxYearConfig(year: number = ACTIVE_TAX_YEAR): TaxYearConfig {
  return TAX_YEAR_CONFIGS[year] ?? TAX_YEAR_CONFIGS[ACTIVE_TAX_YEAR];
}

const ACTIVE = TAX_YEAR_CONFIGS[ACTIVE_TAX_YEAR];

// ── Active-year aliases (use these everywhere) ───────────────────────────
export const ORDINARY_BRACKETS = ACTIVE.ordinaryBrackets;
export const LTCG_BRACKETS = ACTIVE.ltcgBrackets;
export const STANDARD_DEDUCTION = ACTIVE.standardDeduction;
export const SS_WAGE_BASE = ACTIVE.ssWageBase;
export const ADDITIONAL_MEDICARE_THRESHOLD = ACTIVE.additionalMedicareThreshold;
export const QBI_THRESHOLDS = ACTIVE.qbiThresholds;

// ── Backward-compat aliases (kept so existing imports keep compiling).
// These now point at the active year, so 2025 imports get 2026 numbers.
// New code should use the unsuffixed exports above.
export const ORDINARY_BRACKETS_2025 = ORDINARY_BRACKETS;
export const LTCG_BRACKETS_2025 = LTCG_BRACKETS;
export const STANDARD_DEDUCTION_2025 = STANDARD_DEDUCTION;
export const SS_WAGE_BASE_2025 = SS_WAGE_BASE;

// ── SE tax constants (statutory; do not change with the year) ────────────
export const SS_RATE = 0.124;
export const MEDICARE_RATE = 0.029;
export const SE_INCOME_FACTOR = 0.9235;

export interface BracketLine {
  rate: number;
  bracketMin: number;
  bracketMax: number;
  amountInBracket: number;
  taxInBracket: number;
}

export interface BracketCalc {
  total: number;
  lines: BracketLine[];
}

export function calcBracketTax(taxableIncome: number, brackets: Bracket[]): BracketCalc {
  const lines: BracketLine[] = [];
  if (taxableIncome <= 0) {
    return { total: 0, lines: [] };
  }
  let total = 0;
  for (const b of brackets) {
    if (taxableIncome <= b.min) break;
    const upper = Math.min(taxableIncome, b.max);
    const amt = upper - b.min;
    if (amt <= 0) continue;
    const tax = amt * b.rate;
    total += tax;
    lines.push({
      rate: b.rate,
      bracketMin: b.min,
      bracketMax: b.max,
      amountInBracket: amt,
      taxInBracket: tax,
    });
  }
  return { total, lines };
}

export interface SETaxCalc {
  netSEIncome: number;
  seBase: number; // 92.35% of net SE income
  ssTaxable: number;
  ssTax: number;
  medicareTax: number;
  total: number;
  deductibleHalf: number;
}

export function calcSETax(netSEIncome: number, w2Wages = 0): SETaxCalc {
  if (netSEIncome <= 0) {
    return { netSEIncome: 0, seBase: 0, ssTaxable: 0, ssTax: 0, medicareTax: 0, total: 0, deductibleHalf: 0 };
  }
  const seBase = netSEIncome * SE_INCOME_FACTOR;
  const ssRemaining = Math.max(0, SS_WAGE_BASE - w2Wages);
  const ssTaxable = Math.min(seBase, ssRemaining);
  const ssTax = ssTaxable * SS_RATE;
  const medicareTax = seBase * MEDICARE_RATE;
  const total = ssTax + medicareTax;
  return { netSEIncome, seBase, ssTaxable, ssTax, medicareTax, total, deductibleHalf: total / 2 };
}

export function getMarginalRate(taxableIncome: number, brackets: Bracket[]): number {
  if (taxableIncome <= 0) return 0;
  for (const b of brackets) {
    if (taxableIncome > b.min && taxableIncome <= b.max) return b.rate;
  }
  return brackets[brackets.length - 1].rate;
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}
