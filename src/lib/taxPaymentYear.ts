/**
 * Estimated-payment tax-year scoping. A payment counts toward the year it was
 * APPLIED to (applied_tax_year), not the calendar year it was paid in — e.g.
 * a January 15 payment for last year's Q4 belongs to last year.
 * Falls back to the payment date's year for legacy rows without the field.
 */
export function paymentAppliesToTaxYear(
  p: { applied_tax_year?: number | null; payment_date: string },
  taxYear: number,
): boolean {
  const applied = p.applied_tax_year ?? Number(String(p.payment_date).slice(0, 4));
  return applied === taxYear;
}
