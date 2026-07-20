import { describe, it, expect } from "vitest";
import {
  POVERTY_GUIDELINES,
  computePovertyGuideline,
  getPovertyTable,
  latestPovertyYear,
} from "@/lib/studentLoan/rules/povertyGuidelines";

describe("poverty guidelines registry", () => {
  it("has 2024, 2025, and 2026 entries for the contiguous 48 + DC", () => {
    for (const year of [2024, 2025, 2026]) {
      const t = POVERTY_GUIDELINES.find((g) => g.year === year && g.region === "contiguous_48_dc");
      expect(t, `missing ${year} contiguous_48_dc`).toBeTruthy();
    }
  });

  it("2026 contiguous_48_dc family of 1 = $15,960 per FR notice", () => {
    const t = getPovertyTable(2026, "contiguous_48_dc");
    expect(t.base).toBe(15960);
    expect(t.perAdditionalPerson).toBe(5680);
    expect(t.verification).toBe("confirmed");
  });

  it("Alaska guidelines differ from the 48-state table", () => {
    const ak = getPovertyTable(2026, "alaska");
    const dc = getPovertyTable(2026, "contiguous_48_dc");
    expect(ak.base).toBeGreaterThan(dc.base);
  });

  it("Hawaii 2026 is provisional (verification pending) — do not use in golden tests", () => {
    const hi = getPovertyTable(2026, "hawaii");
    expect(hi.verification).toBe("pending");
  });

  it("computePovertyGuideline scales linearly with family size", () => {
    const one = computePovertyGuideline(1, 2026, "contiguous_48_dc").amount;
    const four = computePovertyGuideline(4, 2026, "contiguous_48_dc").amount;
    expect(four).toBe(one + 3 * 5680);
  });

  it("latestPovertyYear() returns the most recent year in the registry", () => {
    expect(latestPovertyYear()).toBeGreaterThanOrEqual(2026);
  });
});
