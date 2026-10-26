import { describe, it, expect } from "vitest";
import { buildOnboardingIncomePlan, summarizeOnboardingEstimate } from "@/lib/onboardingIncomePlan";

describe("onboarding income plan", () => {
  it("$120k annual, October start, no YTD → $90k estimated earlier, $30k planned", () => {
    const p = buildOnboardingIncomePlan({ annual: 120000, payFrequency: "monthly", today: "2026-10-26" })!;
    expect(p.occurrences).toBe(3);
    expect(p.perOccurrence).toBe(10000);
    expect(p.plannedRemaining).toBe(30000);
    expect(p.earlierInYear).toBe(90000);
    expect(p.earlierInYearSource).toBe("estimated");
    expect(p.startDate).toBe("2026-10-26");
  });

  it("YTD provided spreads the remainder over remaining paychecks", () => {
    const p = buildOnboardingIncomePlan({ annual: 120000, ytd: 100000, payFrequency: "monthly", today: "2026-10-26" })!;
    expect(Math.abs(p.plannedRemaining - 20000)).toBeLessThanOrEqual(0.03); // per-paycheck cents rounding
    expect(p.earlierInYear).toBe(100000);
  });

  it("uses the pay schedule for remaining W-2 paychecks", () => {
    const p = buildOnboardingIncomePlan({ annual: 130000, payFrequency: "biweekly", today: "2026-12-01" })!;
    expect(p.occurrences).toBe(3); // Dec 1, 15, 29
    expect(p.perOccurrence).toBe(5000);
  });

  it("recorded actual income replaces the estimate instead of adding to it", () => {
    const s = summarizeOnboardingEstimate({ annual: 120000, recorded: 90000, planned: 30000 });
    expect(s.earlierEstimate).toBe(0);
    expect(s.total).toBe(120000);
  });
});
