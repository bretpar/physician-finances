import { describe, it, expect } from "vitest";
import {
  getIrsMileageRate,
  getMileageRateForDate,
  getMileageEntryDeduction,
  IRS_MILEAGE_RATE,
} from "@/hooks/useMileage";

describe("2026 mid-year IRS mileage rate change", () => {
  it("uses $0.725 Jan–Jun 2026 and $0.76 Jul–Dec 2026", () => {
    expect(getIrsMileageRate(2026, 1)).toBeCloseTo(0.725, 6);
    expect(getIrsMileageRate(2026, 6)).toBeCloseTo(0.725, 6);
    expect(getIrsMileageRate(2026, 7)).toBeCloseTo(0.76, 6);
    expect(getIrsMileageRate(2026, 12)).toBeCloseTo(0.76, 6);
  });

  it("resolves the rate from an actual date", () => {
    expect(getMileageRateForDate("2026-06-30")).toBeCloseTo(0.725, 6);
    expect(getMileageRateForDate("2026-07-01")).toBeCloseTo(0.76, 6);
  });

  it("matches the expected per-100-mile deductions", () => {
    expect(getMileageEntryDeduction({ year: 2026, month: 6, miles: 100 })).toBeCloseTo(72.5, 6);
    expect(getMileageEntryDeduction({ year: 2026, month: 7, miles: 100 })).toBeCloseTo(76, 6);
  });

  it("sums split-period mileage to $7,425", () => {
    const total =
      getMileageEntryDeduction({ year: 2026, month: 3, miles: 5000 }) +
      getMileageEntryDeduction({ year: 2026, month: 9, miles: 5000 });
    expect(total).toBeCloseTo(7425, 6);
  });

  it("leaves prior tax years unchanged", () => {
    expect(getIrsMileageRate(2025, 8)).toBeCloseTo(IRS_MILEAGE_RATE, 6);
    expect(getMileageEntryDeduction({ year: 2025, month: 8, miles: 100 })).toBeCloseTo(67, 6);
  });
});
