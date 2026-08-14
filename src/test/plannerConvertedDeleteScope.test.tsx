/** Regression coverage for the Planner ownership boundary. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { generateProjectedPaychecks } from "@/hooks/useProjectedIncome";

const baseStream = {
  id: "stream-1",
  user_id: "user-1",
  organization_id: "org-1",
  company: "Hospital",
  company_type: "w2",
  source_id: null,
  paycheck_amount: 5000,
  taxes_withheld: 1000,
  retirement_401k: 0,
  pre_tax_deductions: 0,
  federal_withholding: 0,
  state_withholding: 0,
  ss_withholding: 0,
  medicare_withholding: 0,
  healthcare_deduction: 0,
  hsa_contribution: 0,
  additional_tax_reserve: 0,
  pay_frequency: "single",
  custom_interval_days: null,
  start_date: `${new Date().getFullYear()}-01-15`,
  end_date: `${new Date().getFullYear()}-12-31`,
  is_active: true,
  include_in_tax: true,
  created_at: "",
  updated_at: "",
} as const;

describe("converted Planner history", () => {
  it("keeps a historical converted occurrence visible and linked", () => {
    const rows = generateProjectedPaychecks(
      [baseStream as any],
      [],
      [],
      [],
      [{
        id: "conversion-1",
        stream_id: baseStream.id,
        occurrence_date: baseStream.start_date,
        bonus_event_id: null,
        status: "converted",
      } as any],
      [],
    );

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        streamId: baseStream.id,
        date: baseStream.start_date,
        matchStatus: "converted",
      }),
    ]));
  });

  it("has no active Planner mutation that deletes either ledger table", () => {
    const source = readFileSync("src/hooks/useProjectedIncome.ts", "utf8");
    expect(source).not.toMatch(/from\(["']income_entries["']\)\s*\.delete\(/s);
    expect(source).not.toMatch(/from\(["']transactions["']\)\s*\.delete\(/s);
    expect(source).not.toContain("useDeleteConvertedOccurrence");
  });

  it("does not expose either converted-occurrence delete choice", () => {
    const source = readFileSync("src/pages/ProjectedIncome.tsx", "utf8");
    expect(source).not.toContain("Delete from Planner & Ledger");
    expect(source).not.toContain("Delete from Planner only");
  });
});