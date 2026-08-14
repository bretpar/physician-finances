/**
 * Canonical recommendation surface for a single income transaction.
 *
 * The Add/Edit Income modal shows `recommendedWithholding` from
 * `useWithholdingRecommendation` — that value is already NET of the taxes
 * entered on the form (`taxesAlreadyWithheld`) and is the value persisted on
 * the transaction row (`recommended_withholding`).
 *
 * The post-save "recommended / saved / additional" prompt compares a
 * recommendation against everything the user set aside, so it needs the GROSS
 * recommendation for the transaction. Deriving it from the same modal value
 * keeps all three surfaces (Add, Edit, post-save prompt) consistent instead of
 * mixing in a second engine (`useIncomeRecommendation.baseTaxEstimate`).
 *
 * Employer-side retirement/HSA contributions are intentionally excluded — they
 * never feed the employee reserve recommendation.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export interface CanonicalRecommendationInput {
  /** `recommendedWithholding` from useWithholdingRecommendation (net of taxesAlreadyWithheld). */
  recommendedWithholding: number;
  /** The same `taxesAlreadyWithheld` value that was fed into the modal recommendation. */
  taxesAlreadyWithheld: number;
  /** Optional fallback when the canonical recommendation is unavailable (gross basis). */
  fallbackGrossRecommendation?: number;
}

/**
 * Gross recommended reserve for the transaction — comparable against the total
 * amount the user saved/withheld for this transaction.
 */
export function resolveCanonicalRecommendation(input: CanonicalRecommendationInput): number {
  const rec = Number(input.recommendedWithholding) || 0;
  const withheld = Math.max(0, Number(input.taxesAlreadyWithheld) || 0);
  if (rec > 0) return round2(rec + withheld);
  // Over-withheld (rec <= 0) still means the recommendation is covered.
  if (rec < 0) return round2(Math.max(0, withheld + rec));
  const fallback = Number(input.fallbackGrossRecommendation) || 0;
  return round2(Math.max(0, fallback));
}

export interface AmountSavedInput {
  taxesWithheld: number;
  stateWithheld: number;
  ssWithheld: number;
  medicareWithheld: number;
  additionalTaxReserve: number;
  actualWithholding: number;
}

/** Total the user has set aside for this transaction. */
export function resolveAmountSavedForTransaction(input: AmountSavedInput): number {
  return round2(
    (Number(input.taxesWithheld) || 0) +
      (Number(input.stateWithheld) || 0) +
      (Number(input.ssWithheld) || 0) +
      (Number(input.medicareWithheld) || 0) +
      (Number(input.additionalTaxReserve) || 0) +
      (Number(input.actualWithholding) || 0),
  );
}

/** Remaining amount to set aside; 0 when already covered. */
export function resolveAdditionalNeeded(recommended: number, saved: number): number {
  return round2(Math.max(0, (Number(recommended) || 0) - (Number(saved) || 0)));
}
