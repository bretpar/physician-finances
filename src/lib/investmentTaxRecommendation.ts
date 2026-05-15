/**
 * Per-entry tax recommendation for investment income.
 *
 * Applies the correct tax method per entry:
 *  - Short-term sale: ordinary/effective rate
 *  - Long-term sale: long-term capital gains brackets (0/15/20)
 *  - Qualified dividend: long-term capital gains brackets
 *  - Non-qualified (ordinary) dividend: ordinary/effective rate
 */

import { LTCG_BRACKETS, type FilingStatus, calcBracketTax } from "@/lib/taxBrackets";
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

/** Compute LTCG tax on a slice of gain stacked on top of ordinary taxable income. */
export function calcLtcgTaxOnSlice(args: {
  filingStatus: FilingStatus;
  ordinaryTaxableIncome: number;
  gain: number;
}): { tax: number; effectiveRate: number; rateLabel: string } {
  const { filingStatus, ordinaryTaxableIncome, gain } = args;
  if (gain <= 0) return { tax: 0, effectiveRate: 0, rateLabel: "0%" };
  const base = Math.max(0, ordinaryTaxableIncome);
  const brackets = LTCG_BRACKETS[filingStatus];
  // Tax on (base + gain) minus tax on (base) gives tax on the slice.
  const totalUpper = calcBracketTax(base + gain, brackets).total;
  const totalLower = calcBracketTax(base, brackets).total;
  const tax = Math.max(0, totalUpper - totalLower);
  const effectiveRate = tax / gain;
  // Build a human label by listing the rates the slice spans.
  const ratesUsed: number[] = [];
  for (const b of brackets) {
    const sliceTop = base + gain;
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

export function calculateInvestmentTaxRecommendation(args: {
  type: InvestmentIncomeType;
  taxableAmount: number;
  isQualifiedDividend?: boolean;
  filingStatus: FilingStatus;
  /** Projected annual ordinary taxable income (excludes the LTCG slice itself). */
  projectedOrdinaryTaxableIncome: number;
  /** Decimal ordinary effective rate (e.g. 0.22) used for short-term/ordinary dividends. */
  ordinaryEffectiveRate: number;
}): InvestmentTaxRecommendation {
  const { type, taxableAmount, isQualifiedDividend = true, filingStatus, projectedOrdinaryTaxableIncome, ordinaryEffectiveRate } = args;
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

  // Short-term sale or non-qualified dividend → ordinary rate
  const tax = safeTaxable * ordinaryEffectiveRate;
  return {
    taxableAmount: safeTaxable,
    taxMethod: method,
    effectiveRate: ordinaryEffectiveRate,
    rateLabel: `${(ordinaryEffectiveRate * 100).toFixed(2)}%`,
    methodLabel: METHOD_LABEL[method],
    estimatedTax: Math.round(tax * 100) / 100,
  };
}
