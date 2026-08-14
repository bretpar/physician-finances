/**
 * Estimated Net helper for the Personal Income edit form.
 *
 * Basic Planner conversions store only an aggregate federal payroll-tax /
 * withholding amount (taxes_withheld) with zero detailed Federal / SS /
 * Medicare components. The estimator must fall back to that aggregate instead
 * of treating withholding as $0 — but must never count both.
 */

export interface EstimatedNetInput {
  gross: number;
  /** Detailed federal income tax withheld. */
  federal: number;
  ss: number;
  medicare: number;
  /** Aggregate "Total Federal Payroll Taxes" (taxes_withheld) if stored. */
  aggregateFederalPayrollTaxes: number;
  state: number;
  retirement: number;
  otherPreTax: number;
  healthcare: number;
  hsa: number;
  /**
   * Employer-side contributions. They stay classified as employer
   * contributions; they only reduce net cash when the company setting
   * "reduces my paycheck" is enabled. Defaults: 0 / false.
   */
  employerRetirement?: number;
  employerRetirementReducesPaycheck?: boolean;
  employerHsa?: number;
  employerHsaReducesPaycheck?: boolean;
}


const n = (v: unknown) => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * Effective federal payroll withholding: detailed components when any are
 * present, otherwise the stored aggregate. Never the sum of both.
 */
export function effectiveFederalWithholding(input: {
  federal: number;
  ss: number;
  medicare: number;
  aggregateFederalPayrollTaxes: number;
}): number {
  const detailed = n(input.federal) + n(input.ss) + n(input.medicare);
  if (detailed > 0) return detailed;
  return Math.max(0, n(input.aggregateFederalPayrollTaxes));
}

export function computeEstimatedNet(input: EstimatedNetInput): number {
  const withholding = effectiveFederalWithholding(input);
  const net =
    n(input.gross) -
    withholding -
    n(input.state) -
    n(input.retirement) -
    n(input.otherPreTax) -
    n(input.healthcare) -
    n(input.hsa);
  return Math.max(0, net);
}
