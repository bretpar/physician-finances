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

// ── Stage 2: date-based eligibility for forward-looking inputs ─────────────
//
// Shared rule: `closed_on` is the first inactive date and `reopened_on` the
// first active date again. An occurrence is ineligible when its own effective
// date falls inside any closure period of its company. The same rule is
// duplicated (byte-for-byte logic) in supabase/functions/planner-convert-daily.

export interface ClosureLookup {
  periods: ClosurePeriod[];
  companies: Array<{ id: string; name: string }>;
}

const normName = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/** Stream → company: `source_id` first, else a unique case-insensitive name match. */
export function resolveClosureCompanyId(
  stream: { source_id?: string | null; company?: string | null },
  companies: Array<{ id: string; name: string }>,
): string | null {
  if (stream.source_id) return stream.source_id;
  const n = normName(stream.company);
  if (!n) return null;
  const matches = companies.filter((c) => normName(c.name) === n);
  return matches.length === 1 ? matches[0].id : null;
}

/** True when the planned occurrence on `date` belongs to a closed period. */
export function isOccurrenceClosed(
  lookup: ClosureLookup | null | undefined,
  stream: { source_id?: string | null; company?: string | null } | null | undefined,
  date: string,
): boolean {
  if (!lookup || !stream || lookup.periods.length === 0) return false;
  const id = resolveClosureCompanyId(stream, lookup.companies);
  return !!id && isClosedOn(lookup.periods, id, date);
}

/**
 * Split [start, end] (inclusive YYYY-MM-DD) into the sub-ranges where the
 * company is open. No periods → the original range unchanged.
 */
export function openSegments(
  periods: ClosurePeriod[],
  companyId: string | null | undefined,
  start: string,
  end: string,
): Array<{ start: string; end: string }> {
  const mine = companyId ? periods.filter((p) => p.companyId === companyId).sort((a, b) => a.closedOn.localeCompare(b.closedOn)) : [];
  if (mine.length === 0) return [{ start, end }];
  const out: Array<{ start: string; end: string }> = [];
  let cursor = start;
  for (const p of mine) {
    if (p.closedOn > cursor) {
      const segEnd = dayBefore(p.closedOn) < end ? dayBefore(p.closedOn) : end;
      if (segEnd >= cursor) out.push({ start: cursor, end: segEnd });
    }
    if (p.reopenedOn == null) return out;
    if (p.reopenedOn > cursor) cursor = p.reopenedOn;
    if (cursor > end) return out;
  }
  if (cursor <= end) out.push({ start: cursor, end });
  return out;
}

function dayBefore(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day - 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * Rest-of-year open-day window for a company with closure periods touching
 * `taxYear`; null when the company has none (callers keep existing behavior).
 */
export function closureWindowForYear(
  periods: ClosurePeriod[],
  companyId: string,
  today: string,
  taxYear: number,
): { openRemainingDays: number; remainingDays: number; yearDays: number } | null {
  const yStart = `${taxYear}-01-01`;
  const yEnd = `${taxYear}-12-31`;
  const touches = periods.some((p) => p.companyId === companyId && p.closedOn <= yEnd && (p.reopenedOn == null || p.reopenedOn > yStart));
  if (!touches) return null;
  const from = today > yStart ? today : yStart;
  const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
  const yearDays = days(yStart, yEnd);
  if (from > yEnd) return { openRemainingDays: 0, remainingDays: 0, yearDays };
  const openRemainingDays = openSegments(periods, companyId, from, yEnd).reduce((s, g) => s + days(g.start, g.end), 0);
  return { openRemainingDays, remainingDays: days(from, yEnd), yearDays };
}
