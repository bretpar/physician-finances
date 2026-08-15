/**
 * Resolve WHICH income entry a confirmed tax reserve must be written to.
 * --------------------------------------------------------------------------
 * Production bug this fixes: the Business Activity reserve-confirm flow wrote
 * `additional_tax_reserve` to `incomeEntries[0]` — the newest cached row, which
 * is usually a W-2 paycheck. Confirming a $2,305 reserve for a brand-new 1099
 * entry therefore inflated W-2 Saved and left the 1099 recommendation
 * unsatisfied with no 1099 source row at all.
 *
 * Rule: when the flow captured the id of the entry that generated the
 * recommendation, that row is the ONLY valid target. The newest-row fallback is
 * reserved for legacy flows that never captured an id.
 */

export interface ReserveTargetCandidate {
  id: string;
  additional_tax_reserve?: number | string | null;
}

export function resolveReserveTargetEntry<T extends ReserveTargetCandidate>(
  entries: T[] | undefined | null,
  savedEntryId: string | null | undefined,
): T | null {
  if (!entries || entries.length === 0) return null;
  if (savedEntryId) {
    return entries.find((e) => e.id === savedEntryId) ?? null;
  }
  return entries[0] ?? null;
}

/** Reserve value to persist: existing reserve on that row plus the new amount. */
export function nextReserveAmount(
  currentReserve: number | string | null | undefined,
  additional: number,
): number {
  const current = Math.max(0, Number(currentReserve || 0));
  const add = Math.max(0, Number(additional || 0));
  return Math.round((current + add) * 100) / 100;
}
