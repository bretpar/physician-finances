import { describe, it, expect } from "vitest";
import { deriveOtherPreTax, sumDetailedDeductions } from "@/pages/ProjectedIncome";

/**
 * `pre_tax_deductions` is persisted as an aggregate that already includes
 * health insurance and HSA. These tests cover cases where HSA and several
 * other pre-tax components are stored separately, and assert that repeated
 * reopen/save cycles never double-count the aggregate.
 */

/** Helper mirroring the editor: hydrate from stored aggregate, then re-aggregate on save. */
function roundTrip(aggregate: number, healthcare: number, hsa: number) {
  const other = deriveOtherPreTax(aggregate, healthcare, hsa);
  const nextAggregate = sumDetailedDeductions({
    healthcare_deduction: String(healthcare),
    hsa_contribution: String(hsa),
    pre_tax_deductions: String(other),
  });
  return { other, nextAggregate };
}

describe("pre-tax components stored separately — HSA present", () => {
  it("derives Other when HSA is the only separate component", () => {
    expect(deriveOtherPreTax(450, 0, 450)).toBe(0);
    expect(deriveOtherPreTax(500, 0, 450)).toBe(50);
  });

  it("derives Other with both health insurance and HSA stored", () => {
    const { other, nextAggregate } = roundTrip(1000, 250, 400);
    expect(other).toBe(350);
    expect(nextAggregate).toBe(1000);
  });

  it("handles HSA larger than the aggregate by clamping Other to zero", () => {
    expect(deriveOtherPreTax(300, 0, 500)).toBe(0);
  });

  it("keeps cents precision without floating point drift", () => {
    const { other, nextAggregate } = roundTrip(456.78, 120.33, 200.45);
    expect(other).toBe(136);
    expect(nextAggregate).toBe(456.78);
  });
});

describe("multiple other pre-tax components rolled into Other", () => {
  it("treats commuter + union dues + parking as a single Other remainder", () => {
    const commuter = 120;
    const unionDues = 65;
    const parking = 40;
    const healthcare = 250;
    const hsa = 300;
    const aggregate = healthcare + hsa + commuter + unionDues + parking;

    const { other, nextAggregate } = roundTrip(aggregate, healthcare, hsa);
    expect(other).toBe(commuter + unionDues + parking);
    expect(nextAggregate).toBe(aggregate);
  });

  it("never double-counts across five reopen/save cycles", () => {
    let aggregate = 1075;
    const healthcare = 250;
    const hsa = 300;
    for (let i = 0; i < 5; i++) {
      const result = roundTrip(aggregate, healthcare, hsa);
      expect(result.other).toBe(525);
      aggregate = result.nextAggregate;
      expect(aggregate).toBe(1075);
    }
  });

  it("stays consistent when the user edits HSA on reopen", () => {
    // Saved: healthcare 250 + hsa 300 + other 525 = 1075
    const first = roundTrip(1075, 250, 300);
    expect(first.other).toBe(525);

    // User raises HSA to 400 and saves; Other is untouched.
    const savedAfterEdit = sumDetailedDeductions({
      healthcare_deduction: "250",
      hsa_contribution: "400",
      pre_tax_deductions: String(first.other),
    });
    expect(savedAfterEdit).toBe(1175);

    // Reopening reflects the new HSA without inflating Other.
    expect(deriveOtherPreTax(savedAfterEdit, 250, 400)).toBe(525);
  });

  it("zeroing HSA on reopen leaves the remaining components intact", () => {
    const cleared = sumDetailedDeductions({
      healthcare_deduction: "250",
      hsa_contribution: "0",
      pre_tax_deductions: "525",
    });
    expect(cleared).toBe(775);
    expect(deriveOtherPreTax(cleared, 250, 0)).toBe(525);
  });

  it("handles an aggregate made up only of Other components", () => {
    const { other, nextAggregate } = roundTrip(310, 0, 0);
    expect(other).toBe(310);
    expect(nextAggregate).toBe(310);
  });
});
