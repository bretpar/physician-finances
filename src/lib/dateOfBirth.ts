/**
 * Date-of-birth handling — date-only, never timezone shifted.
 *
 * DOB is a calendar date (`YYYY-MM-DD`). It must never be round-tripped through
 * `new Date(...).toISOString()`, which converts local midnight to UTC and can
 * move the stored day by one. Everything here works on the string form.
 */

const DOB_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Earliest plausible birth year — guards typos like `0197-06-15`. */
const MIN_YEAR = 1900;

/**
 * Normalize a DOB input to a date-only `YYYY-MM-DD` string.
 * Returns `null` for empty, partial, or invalid values (safe no-op) so users
 * without a DOB keep working exactly as before.
 */
export function normalizeDateOfBirthInput(
  raw: string | Date | null | undefined,
  now: Date = new Date(),
): string | null {
  if (raw == null) return null;
  let s: string;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    // Local calendar parts — no UTC conversion.
    s = `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(
      raw.getDate(),
    ).padStart(2, "0")}`;
  } else {
    s = String(raw).trim().slice(0, 10);
  }
  const m = DOB_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (year < MIN_YEAR || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible days (e.g. 2026-02-31) using UTC construction, which has
  // no DST/offset edge cases for pure date arithmetic.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  if (year > now.getFullYear()) return null;
  return `${y}-${mo}-${d}`;
}

/** True when the two DOB values represent the same calendar date (or both empty). */
export function sameDateOfBirth(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return (normalizeDateOfBirthInput(a) ?? "") === (normalizeDateOfBirthInput(b) ?? "");
}
