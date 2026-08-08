/**
 * Employee vs employer retirement/HSA contribution configuration.
 *
 * Backward compatibility guarantees pinned here:
 *  • A company that already had the retirement toggle enabled keeps the
 *    (now "Employee retirement contribution") field visible.
 *  • Employer toggles default to OFF for existing companies.
 *  • Employee and employer amounts persist as separate columns.
 */
import { describe, it, expect } from "vitest";
import {
  resolveAdvancedVisibility,
  TOGGLE_OPTIONS_BY_TYPE,
} from "@/lib/filingTypes";
import { buildIncomeEntryRow } from "@/hooks/usePersonalIncome";

describe("employer retirement / HSA toggles", () => {
  it("exposes four independent contribution toggles for W-2 companies", () => {
    const keys = TOGGLE_OPTIONS_BY_TYPE.w2.map((o) => o.key);
    expect(keys).toContain("retirement_401k");
    expect(keys).toContain("employer_retirement_contribution");
    expect(keys).toContain("hsa_contribution");
    expect(keys).toContain("employer_hsa_contribution");
  });

  it("keeps a legacy enabled retirement toggle visible and defaults employer off", () => {
    const v = resolveAdvancedVisibility("1099_schedule_c", { retirement_401k: true });
    expect(v.retirement_401k).toBe(true);
    expect(v.employer_retirement_contribution).toBe(false);
    expect(v.employer_hsa_contribution).toBe(false);
  });

  it("allows any combination per company", () => {
    const v = resolveAdvancedVisibility("w2", {
      retirement_401k: false,
      employer_retirement_contribution: true,
      hsa_contribution: true,
      employer_hsa_contribution: false,
    });
    expect(v.retirement_401k).toBe(false);
    expect(v.employer_retirement_contribution).toBe(true);
    expect(v.hsa_contribution).toBe(true);
    expect(v.employer_hsa_contribution).toBe(false);
  });

  it("stores employee and employer retirement amounts separately", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 10_000,
      retirement_401k: 1_000,
      employer_retirement_contribution: 500,
    } as any);
    expect(row.retirement_401k).toBe(1_000);
    expect((row as any).employer_retirement_contribution).toBe(500);
  });

  it("preserves legacy rows with only an employee retirement amount", () => {
    const row = buildIncomeEntryRow({
      income_type: "w2_wages",
      gross_amount: 10_000,
      retirement_401k: 1_500,
    } as any);
    expect(row.retirement_401k).toBe(1_500);
    expect((row as any).employer_retirement_contribution).toBe(0);
  });
});
