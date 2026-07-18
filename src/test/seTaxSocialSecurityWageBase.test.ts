/**
 * Regression tests for the SE Social Security wage-base + Additional
 * Medicare audit fixes. See PR discussion for context.
 *
 * Covers:
 *  - Legacy saved wage caps (e.g. 168600) must not override the active-year
 *    Social Security wage base.
 *  - The deductible half of SE tax excludes Additional Medicare Tax.
 *  - Actual-Only and Planned-Income physician scenarios reproduce the
 *    expected SS / Medicare / remaining wage-base numbers.
 *  - Box-3 / FICA-taxable wages are preferred over gross W-2 when supplied.
 */
import { describe, it, expect } from "vitest";
import {
  calculateSETax,
  calculateFullEstimate,
  SE_INCOME_FACTOR,
} from "@/lib/taxEngine";
import { SS_WAGE_BASE, ACTIVE_TAX_YEAR } from "@/lib/taxBrackets";

// Sanity — these tests are pinned to the 2026 wage base.
describe("Active tax year assumption", () => {
  it("uses the 2026 Social Security wage base of $184,500", () => {
    expect(ACTIVE_TAX_YEAR).toBe(2026);
    expect(SS_WAGE_BASE).toBe(184_500);
  });
});

// ── Scenario A: Actual Only ───────────────────────────────────────────
describe("Physician audit — Scenario A (Actual Only)", () => {
  const w2SsWages = 70_467;
  const netSe = 152_294;
  const seBase = netSe * SE_INCOME_FACTOR;       // ≈ 140,643.51
  const ssRemaining = SS_WAGE_BASE - w2SsWages;  // 114,033
  const ssTaxable = Math.min(seBase, ssRemaining);
  const expectedSsTax = ssTaxable * 0.124;       // ≈ 14,140.09
  const expectedMedicare = seBase * 0.029;       // ≈ 4,078.66

  it("produces the audit's expected SS / Medicare numbers", () => {
    const r = calculateSETax(netSe, "single", SS_WAGE_BASE, w2SsWages, w2SsWages);
    expect(r.seBase).toBeCloseTo(140_643.51, 1);
    expect(r.ssRemainingBase).toBe(114_033);
    expect(r.ssTaxableBase).toBeCloseTo(ssTaxable, 2);
    expect(r.ssTax).toBeCloseTo(expectedSsTax, 1);
    expect(r.ssTax).toBeCloseTo(14_140.09, 0);
    expect(r.medicareTax).toBeCloseTo(expectedMedicare, 1);
    expect(r.medicareTax).toBeCloseTo(4_078.66, 0);
  });

  it("does NOT produce the stale-cap SS tax of ~$12,484", () => {
    const r = calculateSETax(netSe, "single", SS_WAGE_BASE, w2SsWages, w2SsWages);
    // With the 2024 wage base of $168,600, ssRemaining would be $98,133 and
    // ssTax ≈ 12,168. We must be materially higher than that (and definitely
    // not $12,484 as the audit reported).
    expect(r.ssTax).toBeGreaterThan(13_500);
  });
});

// ── Scenario B: Planned Income ────────────────────────────────────────
describe("Physician audit — Scenario B (Planned Income)", () => {
  const combinedW2 = 70_467 + 130_739; // 201,206 → exceeds $184,500 cap
  const netSeCombined = 152_294 + 42_980; // actual SE + planned SE
  const seBase = netSeCombined * SE_INCOME_FACTOR;

  it("SS wage base is exhausted by combined W-2 wages → SS tax = $0", () => {
    const r = calculateSETax(
      netSeCombined,
      "single",
      SS_WAGE_BASE,
      combinedW2,
      combinedW2,
    );
    expect(r.ssRemainingBase).toBe(0);
    expect(r.ssTaxableBase).toBe(0);
    expect(r.ssTax).toBe(0);
  });

  it("Medicare still applies to planned business earnings (≈ $5,229.73)", () => {
    const r = calculateSETax(
      netSeCombined,
      "single",
      SS_WAGE_BASE,
      combinedW2,
      combinedW2,
    );
    expect(r.medicareTax).toBeCloseTo(seBase * 0.029, 2);
    expect(r.medicareTax).toBeCloseTo(5_229.73, 0);
  });
});

// ── Legacy stale wage-cap behavior ────────────────────────────────────
describe("Legacy stale wage-cap does not override active year", () => {
  // The `resolveEffectiveSsWageCap` helper lives inside useTaxSettings.ts
  // (private). We validate the engine-facing invariant here: even if a
  // caller passes a stale saved cap through calculateFullEstimate, the
  // *default* used when none is passed is the active-year SS_WAGE_BASE.
  it("engine default equals active-year SS_WAGE_BASE (no more 168600)", () => {
    // No ssWageCap passed → default kicks in and should be SS_WAGE_BASE.
    const result = calculateFullEstimate({
      totalIncome: 200_000,
      w2Income: 150_000,
      seIncome: 50_000,
      preTaxDeductions: 0,
      retirement401k: 0,
      businessDeductions: 0,
      mileageDeduction: 0,
      taxesWithheld: 0,
      filingStatus: "single",
      lastYearTax: 0,
    });
    // ssRemaining should be SS_WAGE_BASE − 150000, not 168600 − 150000.
    expect(result.seTax.ssWageCap).toBe(SS_WAGE_BASE);
    expect(result.seTax.ssRemainingBase).toBe(SS_WAGE_BASE - 150_000);
  });
});

// ── Deductible half excludes Additional Medicare ──────────────────────
describe("Deductible half of SE tax", () => {
  it("excludes Additional Medicare Tax (IRC §164(f))", () => {
    // Very high SE income → triggers 0.9% surtax.
    const r = calculateSETax(400_000, "single", SS_WAGE_BASE, 0, 0);
    expect(r.additionalMedicare).toBeGreaterThan(0);

    const expected = (r.ssTax + r.medicareTax) / 2;
    expect(r.deductibleHalf).toBeCloseTo(expected, 2);
    // And strictly less than the naive total/2 (which incorrectly includes it).
    expect(r.deductibleHalf).toBeLessThan(r.total / 2);
    expect(r.total / 2 - r.deductibleHalf).toBeCloseTo(
      r.additionalMedicare / 2,
      2,
    );
  });

  it("Additional Medicare Tax is still included in total SE tax", () => {
    const r = calculateSETax(400_000, "single", SS_WAGE_BASE, 0, 0);
    expect(r.total).toBeCloseTo(
      r.ssTax + r.medicareTax + r.additionalMedicare,
      2,
    );
  });
});

// ── Box-3 / FICA wages preference vs gross W-2 fallback ───────────────
describe("W-2 Social Security wages input", () => {
  it("uses the Box-3-equivalent (FICA) value when supplied", () => {
    const grossW2 = 100_000;
    const box3 = 92_000; // gross − Section 125
    const r = calculateSETax(50_000, "single", SS_WAGE_BASE, grossW2, box3);
    expect(r.w2SsWagesUsed).toBe(box3);
    expect(r.ssRemainingBase).toBe(SS_WAGE_BASE - box3);
  });

  it("falls back to gross W-2 wages when no Box-3 value is supplied", () => {
    const grossW2 = 100_000;
    const r = calculateSETax(50_000, "single", SS_WAGE_BASE, grossW2);
    expect(r.w2SsWagesUsed).toBe(grossW2);
    expect(r.ssRemainingBase).toBe(SS_WAGE_BASE - grossW2);
  });
});

// ── Resolver: explicit custom SS wage-cap opt-in ─────────────────────────
import { resolveEffectiveSsWageCap } from "@/hooks/useTaxSettings";

describe("resolveEffectiveSsWageCap — explicit opt-in gate", () => {
  it("missing flag + missing value → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(undefined, undefined)).toBe(SS_WAGE_BASE);
  });
  it("missing flag + positive saved value → statutory cap (numeric value alone is NOT intent)", () => {
    expect(resolveEffectiveSsWageCap(200_000, undefined)).toBe(SS_WAGE_BASE);
  });
  it("flag false + positive saved value → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(200_000, false)).toBe(SS_WAGE_BASE);
  });
  it("flag true + valid positive value → custom value honored", () => {
    expect(resolveEffectiveSsWageCap(210_000, true)).toBe(210_000);
  });
  it("flag true + invalid (NaN) value → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(NaN, true)).toBe(SS_WAGE_BASE);
    expect(resolveEffectiveSsWageCap("abc", true)).toBe(SS_WAGE_BASE);
    expect(resolveEffectiveSsWageCap(null, true)).toBe(SS_WAGE_BASE);
  });
  it("flag true + zero or negative → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(0, true)).toBe(SS_WAGE_BASE);
    expect(resolveEffectiveSsWageCap(-5, true)).toBe(SS_WAGE_BASE);
  });
  it("legacy $168,600 without flag → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(168_600, undefined)).toBe(SS_WAGE_BASE);
    expect(resolveEffectiveSsWageCap(168_600, false)).toBe(SS_WAGE_BASE);
  });
  it("legacy $168,600 WITH flag → still statutory cap (known-stale sentinel)", () => {
    expect(resolveEffectiveSsWageCap(168_600, true)).toBe(SS_WAGE_BASE);
  });
  it("unexplained $171,145 without flag → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(171_145, undefined)).toBe(SS_WAGE_BASE);
  });
  it("unexplained $200,000 without flag → statutory cap", () => {
    expect(resolveEffectiveSsWageCap(200_000, undefined)).toBe(SS_WAGE_BASE);
  });
});

// ── Engine: FICA wage split (actual vs planned) for the SE tax UI ────────
describe("calculateSETax — actual/planned FICA wage split", () => {
  it("echoes actual+planned FICA offsets and sums to totalW2SsWagesUsed", () => {
    // Gross ≠ FICA due to Section 125 (e.g. payroll HSA + premiums)
    const actualFica = 90_000;   // actual YTD Box-3 wages
    const plannedFica = 40_000;  // planned rest-of-year Box-3 wages
    const grossW2 = 150_000;     // gross W-2 (unused for SS-cap math when FICA split provided)

    const r = calculateSETax(
      60_000,
      "single",
      SS_WAGE_BASE,
      grossW2,
      /* w2FicaWages */ undefined,
      actualFica,
      plannedFica,
    );

    expect(r.actualW2SsWagesUsed).toBe(actualFica);
    expect(r.plannedW2SsWagesUsed).toBe(plannedFica);
    expect(r.totalW2SsWagesUsed).toBe(actualFica + plannedFica);
    expect(r.w2SsWagesUsed).toBe(actualFica + plannedFica); // NOT gross W-2
    expect(r.ssRemainingBase).toBe(SS_WAGE_BASE - (actualFica + plannedFica));
  });

  it("planned-mode: gross W-2 is NOT used as the SS wage offset when FICA split is provided", () => {
    const grossW2 = 200_000;
    const actualFica = 100_000;
    const plannedFica = 50_000;
    const r = calculateSETax(
      30_000, "single", SS_WAGE_BASE, grossW2, undefined, actualFica, plannedFica,
    );
    expect(r.w2SsWagesUsed).not.toBe(grossW2);
    expect(r.w2SsWagesUsed).toBe(150_000);
  });

  it("backward-compat: no split → actual echoes total, planned is 0", () => {
    const r = calculateSETax(50_000, "single", SS_WAGE_BASE, 100_000, 95_000);
    expect(r.actualW2SsWagesUsed).toBe(95_000);
    expect(r.plannedW2SsWagesUsed).toBe(0);
    expect(r.totalW2SsWagesUsed).toBe(95_000);
  });
});
