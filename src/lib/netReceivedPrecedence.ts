/**
 * Net Received precedence for linked business income transactions.
 *
 * Source of truth: an explicit user-saved `income_entries.deposited_amount`
 * MUST always beat any imported Plaid/sibling amount. The Plaid amount is
 * only used as the initial fallback when no saved deposited amount exists,
 * so the linked transaction card can still surface the raw bank deposit
 * separately without overwriting a manual correction on reopen.
 *
 * Order:
 *   1) explicit saved deposited_amount on the linked income_entry
 *   2) linked Plaid sibling amount (cash truth fallback)
 *   3) denormalized linked_plaid_amount on the canonical row
 *   4) calculated take-home (gross − withholding − pre-tax − 401k − HSA − …)
 *   5) gross (final fallback so the user always sees a number)
 *
 * A deposited_amount that exactly equals gross is treated as a planner
 * placeholder (the planner conversion writes gross there by default) and
 * skipped so the real bank deposit still surfaces.
 */
export type NetReceivedInputs = {
  gross: number;
  savedDeposited?: number | null;
  siblingAmount?: number | null;
  linkedPlaidAmount?: number | null;
  calculatedNet?: number | null;
};

export function resolveNetReceived({
  gross,
  savedDeposited,
  siblingAmount,
  linkedPlaidAmount,
  calculatedNet,
}: NetReceivedInputs): number {
  const g = Math.abs(Number(gross) || 0);
  const dep = Number(savedDeposited) || 0;
  const depUsable = dep > 0 && Math.abs(dep - g) > 0.5 ? dep : 0;
  if (depUsable > 0) return depUsable;
  const sib = Math.abs(Number(siblingAmount) || 0);
  if (sib > 0) return sib;
  const plaid = Math.abs(Number(linkedPlaidAmount) || 0);
  if (plaid > 0) return plaid;
  const calc = Number(calculatedNet) || 0;
  if (calc > 0 && calc < g) return calc;
  return g;
}
