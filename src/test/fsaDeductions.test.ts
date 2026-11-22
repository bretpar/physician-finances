import { describe, it, expect } from "vitest";
import { fsaDefaultsForDate, getFsaLimits, readFsaConfigs, summarizeFsa, writeFsaConfigs } from "@/lib/fsaDeductions";
import { calcW2PayrollTax } from "@/lib/w2PayrollTax";

const cfg = { health: { enabled: true, perPaycheck: 100, startDate: "2026-02-01", endDate: "2026-11-30", annualElection: 2400 } };

describe("FSA deductions", () => {
  it("uses 2026 IRS limits", () => {
    const l = getFsaLimits(2026);
    expect([l.health, l.dependentCare, l.dependentCareMfs]).toEqual([3400, 7500, 3750]);
  });
  it("round-trips settings without touching other metadata", () => {
    const meta = writeFsaConfigs({ other: 1 }, cfg);
    expect((meta as Record<string, unknown>).other).toBe(1);
    expect(readFsaConfigs(meta).health).toEqual(cfg.health);
  });
  it("applies recurring amounts only inside the effective dates", () => {
    expect(fsaDefaultsForDate(cfg, "2026-01-15").health).toBe(0);
    expect(fsaDefaultsForDate(cfg, "2026-02-01").health).toBe(100);
    expect(fsaDefaultsForDate(cfg, "2026-12-15").health).toBe(0);
  });
  it("Healthcare + Limited Purpose share one employer's health FSA limit", () => {
    const s = summarizeFsa({ year: 2026, filingStatus: "single", configsByCompany: { a: { health: { ...cfg.health, annualElection: null }, limited_purpose: { enabled: true, perPaycheck: 0, startDate: null, endDate: null, annualElection: null } } },
      rows: [{ income_date: "2026-03-01", source_id: "a", fsa_health: 2000, fsa_limited_purpose: 1500 }] });
    expect(s.kinds.find((k) => k.kind === "health")!.limit).toBe(3400);
    expect(s.warnings.some((w) => w.includes("share a $3,400"))).toBe(true);
  });
  it("married filing separately halves the dependent care limit", () => {
    const s = summarizeFsa({ year: 2026, filingStatus: "married_filing_separately", configsByCompany: {}, rows: [{ income_date: "2026-03-01", fsa_dependent_care: 4000 }] });
    expect(s.kinds.find((k) => k.kind === "dependent_care")!.limit).toBe(3750);
    expect(s.warnings.length).toBe(1);
  });
  it("warns that a general Healthcare FSA conflicts with an HSA", () => {
    const s = summarizeFsa({ year: 2026, filingStatus: "single", configsByCompany: { a: cfg }, rows: [], hsaEnabled: true });
    expect(s.warnings.some((w) => w.includes("HSA"))).toBe(true);
  });
  it("FSA money in the pre-tax total lowers Social Security and Medicare wages", () => {
    const r = calcW2PayrollTax({ grossW2Wages: 10000, filingStatus: "single", qualifiedSection125Premiums: 300 });
    expect(r.ficaWages).toBe(9700);
  });
});
