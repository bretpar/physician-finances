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

/**
 * Canonical event fields the after-save reminder needs. Both recommendation
 * hooks expose these straight from `computeCanonicalEventRecommendation`.
 */
export interface ReminderCanonicalSource {
  /** Event target + catch-up (what the event should have covered in total). */
  totalSuggestedReserve: number;
  /** Federal income-tax withholding credited (FICA already excluded). */
  creditedFederalWithholding: number;
  /** State withholding credited (already capped at this event's state tax). */
  creditedStateWithholding: number;
  /** False for already-received events — no actionable reminder. */
  isFutureOpportunity?: boolean;
}

export interface ReminderComparison {
  recommended: number;
  creditedWithholding: number;
  separatelyReserved: number;
  saved: number;
  additionalNeeded: number;
}

/**
 * The ONE after-save reminder comparison. Consumes canonical event outputs
 * only — pages must not rebuild targets or coverage. Social Security /
 * Medicare are never counted as savings, and state withholding is the
 * already-capped canonical credit (applied once).
 */
export function buildReminderComparison(
  src: ReminderCanonicalSource,
  reserves: { additionalTaxReserve?: number; actualWithholding?: number } = {},
): ReminderComparison {
  const recommended = src.isFutureOpportunity === false ? 0 : round2(Math.max(0, src.totalSuggestedReserve));
  const creditedWithholding = round2(
    Math.max(0, src.creditedFederalWithholding) + Math.max(0, src.creditedStateWithholding),
  );
  const separatelyReserved = round2(
    Math.max(0, Number(reserves.additionalTaxReserve) || 0) +
      Math.max(0, Number(reserves.actualWithholding) || 0),
  );
  const saved = round2(creditedWithholding + separatelyReserved);
  return {
    recommended,
    creditedWithholding,
    separatelyReserved,
    saved,
    additionalNeeded: resolveAdditionalNeeded(recommended, saved),
  };
}
