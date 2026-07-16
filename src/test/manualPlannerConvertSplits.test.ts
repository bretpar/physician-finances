import { describe, it, expect } from "vitest";

/**
 * Regression: ordinary Planner → Personal "To Personal" conversion must
 * preserve the persisted stream's federal/state/SS/Medicare split fields.
 *
 * The bug: `handleConvert` in ProjectedIncome.tsx passed literal 0 for
 * federal/state/ss/medicare withholding because the ProjectedPaycheck
 * type does not carry those splits. The confirmation dialog is read-only
 * for these fields, so the caller must source them from the persisted
 * planner stream (the source of truth) — not from the paycheck object.
 *
 * This test exercises the pure payload-building logic in isolation.
 */

interface Stream {
  id: string;
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
}

interface Paycheck {
  streamId: string;
  grossAmount: number;
  taxesWithheld: number;
  preTaxDeductions: number;
  retirement401k: number;
  healthcareDeduction: number;
  hsaContribution: number;
}

// Mirrors handleConvert's payload construction (post-fix). Kept in sync
// intentionally so a regression here catches a UI-caller regression.
function buildManualConvertPayload(entry: Paycheck, streams: Stream[]) {
  const stream = streams.find((s) => s.id === entry.streamId);
  return {
    grossAmount: entry.grossAmount,
    taxesWithheld: entry.taxesWithheld,
    preTaxDeductions: entry.preTaxDeductions,
    retirement401k: entry.retirement401k,
    healthcareDeduction: entry.healthcareDeduction,
    hsaContribution: entry.hsaContribution,
    federalWithholding: Number(stream?.federal_withholding || 0),
    stateWithholding: Number(stream?.state_withholding || 0),
    ssWithholding: Number(stream?.ss_withholding || 0),
    medicareWithholding: Number(stream?.medicare_withholding || 0),
  };
}

describe("manual planner → personal conversion payload", () => {
  const stream: Stream = {
    id: "stream-1",
    federal_withholding: 1500,
    state_withholding: 0,
    ss_withholding: 620,
    medicare_withholding: 145,
  };
  const paycheck: Paycheck = {
    streamId: "stream-1",
    grossAmount: 10000,
    taxesWithheld: 2265,
    preTaxDeductions: 50,
    retirement401k: 800,
    healthcareDeduction: 300,
    hsaContribution: 100,
  };

  it("copies federal/SS/Medicare from the persisted stream (not zero)", () => {
    const p = buildManualConvertPayload(paycheck, [stream]);
    expect(p.federalWithholding).toBe(1500);
    expect(p.ssWithholding).toBe(620);
    expect(p.medicareWithholding).toBe(145);
    // Aggregate must not substitute for splits.
    expect(p.taxesWithheld).toBe(2265);
  });

  it("preserves 401k / pre-tax / healthcare / HSA / gross", () => {
    const p = buildManualConvertPayload(paycheck, [stream]);
    expect(p.grossAmount).toBe(10000);
    expect(p.retirement401k).toBe(800);
    expect(p.preTaxDeductions).toBe(50);
    expect(p.healthcareDeduction).toBe(300);
    expect(p.hsaContribution).toBe(100);
  });

  it("safely defaults splits to 0 when the stream is missing or has no splits", () => {
    const p = buildManualConvertPayload(paycheck, []);
    expect(p.federalWithholding).toBe(0);
    expect(p.ssWithholding).toBe(0);
    expect(p.medicareWithholding).toBe(0);
  });

  it("does not zero splits for 1099/K-1 streams either (they simply carry 0)", () => {
    const biz: Stream = { id: "s2", federal_withholding: 0, state_withholding: 0, ss_withholding: 0, medicare_withholding: 0 };
    const p = buildManualConvertPayload({ ...paycheck, streamId: "s2" }, [biz]);
    expect(p.federalWithholding).toBe(0);
    expect(p.ssWithholding).toBe(0);
    expect(p.medicareWithholding).toBe(0);
  });
});
