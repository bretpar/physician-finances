/**
 * Per-entry tax recommendation for investment income.
 *
 * Applies the correct tax method per entry:
 *  - Short-term sale: ordinary/effective rate
 *  - Long-term sale: long-term capital gains brackets (0/15/20)
 *  - Qualified dividend: long-term capital gains brackets
 *  - Non-qualified (ordinary) dividend: ordinary/effective rate
 */

import { LTCG_BRACKETS, ORDINARY_BRACKETS, type FilingStatus, type Bracket, calcBracketTax } from "@/lib/taxBrackets";
import type { InvestmentIncomeType } from "@/hooks/useInvestmentIncome";

export type InvestmentTaxMethod =
  | "long_term_capital_gains"
  | "short_term_ordinary"
  | "qualified_dividend"
  | "ordinary_dividend";

export interface InvestmentTaxRecommendation {
  taxableAmount: number;
  taxMethod: InvestmentTaxMethod;
  /** Decimal rate (e.g. 0.15). For LTCG this is the blended rate across the slice. */
  effectiveRate: number;
  rateLabel: string;
  methodLabel: string;
  estimatedTax: number;
}

const METHOD_LABEL: Record<InvestmentTaxMethod, string> = {
  long_term_capital_gains: "Long-term capital gains",
  short_term_ordinary: "Short-term ordinary income",
  qualified_dividend: "Qualified dividend",
  ordinary_dividend: "Ordinary dividend",
};

export function getInvestmentTaxMethod(
  type: InvestmentIncomeType,
  isQualifiedDividend: boolean,
): InvestmentTaxMethod {
  if (type === "long_term_sale") return "long_term_capital_gains";
  if (type === "short_term_sale") return "short_term_ordinary";
  return isQualifiedDividend ? "qualified_dividend" : "ordinary_dividend";
}

/** Compute tax on a slice of income stacked on top of a baseline, against a bracket set.
 *  Returns the slice tax, blended marginal effective rate, and a human label of the rates spanned.
 */
function calcSliceTax(args: {
  brackets: Bracket[];
  baseTaxableIncome: number;
  slice: number;
}): { tax: number; effectiveRate: number; rateLabel: string } {
  const { brackets, baseTaxableIncome, slice } = args;
  if (slice <= 0) return { tax: 0, effectiveRate: 0, rateLabel: "0%" };
  const base = Math.max(0, baseTaxableIncome);
  const totalUpper = calcBracketTax(base + slice, brackets).total;
  const totalLower = calcBracketTax(base, brackets).total;
  const tax = Math.max(0, totalUpper - totalLower);
  const effectiveRate = tax / slice;
  const ratesUsed: number[] = [];
  for (const b of brackets) {
    const sliceTop = base + slice;
    const overlap = Math.max(0, Math.min(sliceTop, b.max) - Math.max(base, b.min));
    if (overlap > 0) ratesUsed.push(b.rate);
  }
  const unique = Array.from(new Set(ratesUsed));
  const rateLabel =
    unique.length === 1
      ? `${(unique[0] * 100).toFixed(0)}%`
      : unique.map((r) => `${(r * 100).toFixed(0)}%`).join(" / ");
  return { tax, effectiveRate, rateLabel };
}

/** Compute LTCG tax on a slice of gain stacked on top of ordinary taxable income. */
export function calcLtcgTaxOnSlice(args: {
  filingStatus: FilingStatus;
  ordinaryTaxableIncome: number;
  gain: number;
}): { tax: number; effectiveRate: number; rateLabel: string } {
  return calcSliceTax({
    brackets: LTCG_BRACKETS[args.filingStatus],
    baseTaxableIncome: args.ordinaryTaxableIncome,
    slice: args.gain,
  });
}

/** Compute ordinary federal tax on a slice stacked on top of the projected ordinary
 *  taxable income — i.e. the true blended marginal rate for that slice. */
export function calcOrdinaryTaxOnSlice(args: {
  filingStatus: FilingStatus;
  ordinaryTaxableIncome: number;
  slice: number;
}): { tax: number; effectiveRate: number; rateLabel: string } {
  return calcSliceTax({
    brackets: ORDINARY_BRACKETS[args.filingStatus],
    baseTaxableIncome: args.ordinaryTaxableIncome,
    slice: args.slice,
  });
}

export function calculateInvestmentTaxRecommendation(args: {
  type: InvestmentIncomeType;
  taxableAmount: number;
  isQualifiedDividend?: boolean;
  filingStatus: FilingStatus;
  /** Projected annual ordinary taxable income (excludes this entry's slice). */
  projectedOrdinaryTaxableIncome: number;
}): InvestmentTaxRecommendation {
  const { type, taxableAmount, isQualifiedDividend = true, filingStatus, projectedOrdinaryTaxableIncome } = args;
  const method = getInvestmentTaxMethod(type, isQualifiedDividend);
  const safeTaxable = Math.max(0, taxableAmount);

  if (method === "long_term_capital_gains" || method === "qualified_dividend") {
    const { tax, effectiveRate, rateLabel } = calcLtcgTaxOnSlice({
      filingStatus,
      ordinaryTaxableIncome: projectedOrdinaryTaxableIncome,
      gain: safeTaxable,
    });
    return {
      taxableAmount: safeTaxable,
      taxMethod: method,
      effectiveRate,
      rateLabel,
      methodLabel: METHOD_LABEL[method],
      estimatedTax: Math.round(tax * 100) / 100,
    };
  }

  // Short-term sale or non-qualified dividend → blended marginal ordinary rate via slice math
  const { tax, effectiveRate, rateLabel } = calcOrdinaryTaxOnSlice({
    filingStatus,
    ordinaryTaxableIncome: projectedOrdinaryTaxableIncome,
    slice: safeTaxable,
  });
  return {
    taxableAmount: safeTaxable,
    taxMethod: method,
    effectiveRate,
    rateLabel,
    methodLabel: METHOD_LABEL[method],
    estimatedTax: Math.round(tax * 100) / 100,
  };
}
