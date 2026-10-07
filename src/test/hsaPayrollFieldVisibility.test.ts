import { describe, it, expect } from "vitest";
import { resolveAdvancedVisibility, withHsaTrackingVisibility, normalizeFilingType } from "@/lib/filingTypes";

const vis = (type: string, saved: Record<string, boolean>, on: boolean) => {
  const ft = normalizeFilingType(type);
  return withHsaTrackingVisibility(ft, resolveAdvancedVisibility(ft, saved), on);
};

describe("HSA payroll field visibility", () => {
  it("HSA tracking on shows employee + employer HSA for W-2 with empty saved visibility", () => {
    const v = vis("w2", {}, true);
    expect(v.hsa_contribution).toBe(true);
    expect(v.employer_hsa_contribution).toBe(true);
  });
  it("HSA tracking off keeps per-company behavior", () => {
    expect(vis("w2", {}, false)).toEqual(resolveAdvancedVisibility(normalizeFilingType("w2"), {}));
    expect(vis("w2", { hsa_contribution: true }, false).hsa_contribution).toBe(true);
  });
  it("non-W-2 forms do not gain HSA payroll fields", () => {
    const ft = normalizeFilingType("1099_schedule_c");
    expect(vis("1099_schedule_c", {}, true)).toEqual(resolveAdvancedVisibility(ft, {}));
  });
});
