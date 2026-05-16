import { describe, it, expect } from "vitest";
import { getTodayLocalDateString } from "@/lib/localDate";

describe("getTodayLocalDateString", () => {
  it("returns the West Coast calendar date when UTC has already rolled over", () => {
    // 2026-05-16 06:00 UTC === 2026-05-15 23:00 America/Los_Angeles (PDT, -07:00)
    const now = new Date("2026-05-16T06:00:00Z");
    expect(getTodayLocalDateString("America/Los_Angeles", now)).toBe("2026-05-15");
  });

  it("returns the same date once it is actually that day on the West Coast", () => {
    // 2026-05-16 18:00 UTC === 2026-05-16 11:00 America/Los_Angeles
    const now = new Date("2026-05-16T18:00:00Z");
    expect(getTodayLocalDateString("America/Los_Angeles", now)).toBe("2026-05-16");
  });

  it("defaults to America/Los_Angeles when no timezone is supplied", () => {
    const now = new Date("2026-05-16T06:00:00Z");
    expect(getTodayLocalDateString(undefined, now)).toBe("2026-05-15");
  });

  it("falls back to America/Los_Angeles for invalid timezones", () => {
    const now = new Date("2026-05-16T06:00:00Z");
    expect(getTodayLocalDateString("Not/A_Zone", now)).toBe("2026-05-15");
  });
});

describe("planner conversion date gate", () => {
  // Mirrors the comparison used in runPlannerConversionForCurrentUser:
  //   if (paycheck.date > todayLocal) skip
  const shouldConvert = (paycheckDate: string, today: string) => paycheckDate <= today;

  it("does NOT convert a 2026-05-16 paycheck on 2026-05-15 West Coast", () => {
    const today = getTodayLocalDateString(
      "America/Los_Angeles",
      new Date("2026-05-16T06:00:00Z"), // 11pm 5/15 PT
    );
    expect(shouldConvert("2026-05-16", today)).toBe(false);
  });

  it("DOES convert a 2026-05-16 paycheck on 2026-05-16 West Coast", () => {
    const today = getTodayLocalDateString(
      "America/Los_Angeles",
      new Date("2026-05-16T18:00:00Z"), // 11am 5/16 PT
    );
    expect(shouldConvert("2026-05-16", today)).toBe(true);
  });
});
