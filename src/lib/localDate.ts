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
