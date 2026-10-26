/**
 * Reversible company closure (Stage 1).
 *
 * Closure is a separate, date-ranged record (company_closure_periods). It never
 * deletes, archives, merges or rewrites a company or its records. Closed
 * companies stay fully available to history, summaries and tax calculations;
 * closure only removes them from *new-entry* pickers and defaults.
 */

export interface ClosurePeriod {
  id: string;
  companyId: string;
  closedOn: string; // YYYY-MM-DD
  reopenedOn: string | null;
}

/** True when `date` falls inside a closure period: closedOn <= date < reopenedOn. */
export function isClosedOn(periods: ClosurePeriod[], companyId: string, date: string): boolean {
  return periods.some(
    (p) => p.companyId === companyId && p.closedOn <= date && (p.reopenedOn == null || date < p.reopenedOn),
  );
}

/** The currently open closure period for a company (no reopen date), if any. */
export function openClosurePeriod(periods: ClosurePeriod[], companyId: string): ClosurePeriod | null {
  return periods.find((p) => p.companyId === companyId && p.reopenedOn == null) ?? null;
}

/** Ids of companies closed as of `today`. */
export function closedCompanyIdsOn(periods: ClosurePeriod[], today: string): Set<string> {
  const ids = new Set<string>();
  for (const p of periods) if (isClosedOn(periods, p.companyId, today)) ids.add(p.companyId);
  return ids;
}

/**
 * Companies offered in a new-entry picker. Closed companies are hidden unless
 * the user deliberately asks for them (late payments) or the entry being
 * edited already belongs to one (historical records keep their company).
 */
export function selectableForEntry<T extends { id: string }>(
  companies: T[],
  closedIds: Set<string>,
  opts: { currentId?: string | null; includeClosed?: boolean } = {},
): T[] {
  return companies.filter(
    (c) => !closedIds.has(c.id) || opts.includeClosed || (opts.currentId != null && c.id === opts.currentId),
  );
}
