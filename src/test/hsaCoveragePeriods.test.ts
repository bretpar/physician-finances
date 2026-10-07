import { it, expect } from "vitest";
import { computeHsaContributionSummary } from "@/lib/hsaComputation";
it("partial-year family", () => {
  const s = computeHsaContributionSummary({ taxYear: 2026, coverage: "individual", catchUpEligible: false,
    coveragePeriods: [{ start: "2026-01-01", end: "2026-08-31", tier: "family", hsaEligible: true }, { start: "2026-09-01", end: null, tier: "family", hsaEligible: false }],
    contributions: [{ amount: 1600, source_type: "payroll" }, { amount: 4000, source_type: "individual" }] });
  expect(s.applicableLimit).toBe(5833.33); expect(s.excess).toBe(0); expect(s.remaining).toBeCloseTo(233.33, 2);
});
it("seven-month family edit", () => {
  const s = computeHsaContributionSummary({ taxYear: 2026, coverage: "individual", catchUpEligible: false,
    coveragePeriods: [{ start: "2026-01-01", end: "2026-07-31", tier: "family", hsaEligible: true }, { start: "2026-08-01", end: null, tier: "family", hsaEligible: false }],
    contributions: [{ amount: 1600, source_type: "payroll" }, { amount: 4000, source_type: "individual" }] });
  expect(s.applicableLimit).toBe(5104.17); expect(s.excess).toBeCloseTo(495.83, 2);
});
