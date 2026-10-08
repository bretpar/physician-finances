import { it, expect } from "vitest";
import { computeHsaContributionSummary } from "@/lib/hsaComputation";
it("keeps the 2025 legacy family limit when coverage history starts in 2026", () => {
  const s = computeHsaContributionSummary({ taxYear: 2025, coverage: "family", catchUpEligible: false,
    coveragePeriods: [{ start: "2026-01-01", end: null, tier: "family", hsaEligible: true }],
    contributions: [{ amount: 1600, source_type: "payroll" }, { amount: 4000, source_type: "individual" }] });
  expect(s.applicableLimit).toBe(8550);
  expect(s.deductibleTotal).toBe(5600);
  expect(s.excess).toBe(0);
});
it("preserves explicitly ineligible historical coverage", () => {
  const s = computeHsaContributionSummary({ taxYear: 2025, coverage: "family", catchUpEligible: false,
    coveragePeriods: [{ start: "2025-01-01", end: "2025-12-31", tier: "family", hsaEligible: false },
      { start: "2026-01-01", end: null, tier: "family", hsaEligible: true }],
    contributions: [{ amount: 5600, source_type: "individual" }] });
  expect(s.applicableLimit).toBe(0);
  expect(s.excess).toBe(5600);
});
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
