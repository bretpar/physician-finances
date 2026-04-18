/**
 * 2025 IRS tax brackets — Single and MFJ
 * Plus long-term capital gains brackets and SE-tax helpers.
 *
 * This is the source of truth for the new Tax Breakdown page.
 * It is intentionally separate from src/lib/taxEngine.ts so the existing
 * tax flow continues to work unchanged.
 */

export type FilingStatus = "single" | "married_filing_jointly";

export interface Bracket {
  min: number;
  max: number; // exclusive upper bound; Infinity for top
  rate: number; // 0-1
}

// 2025 ordinary income brackets
export const ORDINARY_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
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
};

// 2025 long-term capital gains brackets
export const LTCG_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
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
};

export const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: 15000,
  married_filing_jointly: 30000,
};

// SE tax constants
export const SS_WAGE_BASE_2025 = 176100;
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
  const ssRemaining = Math.max(0, SS_WAGE_BASE_2025 - w2Wages);
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
