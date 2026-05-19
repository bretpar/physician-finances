/**
 * Timezone-aware "today" helpers.
 *
 * Planner conversion compares planned-income dates (stored as YYYY-MM-DD
 * calendar dates with no time component) against "today". Using
 * `new Date().toISOString().slice(0,10)` returns UTC, which flips a day early
 * for users on the US West Coast in the evening — causing a paycheck dated
 * 5/16 to convert on 5/15 local time.
 *
 * Default timezone is America/Los_Angeles per product spec when we cannot
 * resolve a user-specific zone.
 */

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

/**
 * Return the current calendar date in `timezone` as a YYYY-MM-DD string.
 * Falls back to America/Los_Angeles (and finally UTC) if the timezone is
 * invalid or the runtime lacks Intl support.
 */
export function getTodayLocalDateString(
  timezone: string = DEFAULT_TIMEZONE,
  now: Date = new Date(),
): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    /* fall through */
  }
  if (timezone !== DEFAULT_TIMEZONE) return getTodayLocalDateString(DEFAULT_TIMEZONE, now);
  return now.toISOString().slice(0, 10);
}

/**
 * Best-effort resolution of the browser's IANA timezone. Server/test
 * environments without Intl fall back to the West Coast default.
 */
export function resolveBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) return tz;
  } catch {
    /* ignore */
  }
  return DEFAULT_TIMEZONE;
}

/**
 * Parse a date input as a *local calendar date* (no timezone shift).
 *
 * Accepts:
 *   - `YYYY-MM-DD` strings (treated as local midnight, NOT UTC)
 *   - Full ISO timestamps `YYYY-MM-DDTHH:mm:ss...` (parsed normally)
 *   - `Date` objects (returned as-is)
 *   - `null` / `undefined` / invalid → returns `null`
 *
 * Using `new Date("2026-01-05")` would parse as UTC midnight, which renders
 * as Jan 4 for any user west of UTC. This helper avoids that bug.
 */
export function parseLocalDate(input: string | Date | null | undefined): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return isNaN(input.getTime()) ? null : input;
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s) return null;
  // Pure date: YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

type DateInput = string | Date | null | undefined;

/** "Jan 5, 2026" — app-wide default for displayed dates. */
export function formatDate(input: DateInput): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/** "Jan 5" — compact form for tight table rows where year is contextual. */
export function formatDateShort(input: DateInput): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "January 2026" — for month headers and groupings. */
export function formatMonthYear(input: DateInput): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** "Jan" — short month label for axes/charts. */
export function formatMonthShort(input: DateInput): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleDateString("en-US", { month: "short" });
}

/** "Jan 5, 2026, 3:42 PM" — for timestamps (created_at, generated_at, etc.). */
export function formatDateTime(input: DateInput): string {
  const d = parseLocalDate(input);
  if (!d) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
