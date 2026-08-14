import { describe, it, expect } from "vitest";
import { computeEstimatedNet, effectiveFederalWithholding } from "@/lib/estimatedNet";

const base = {
  gross: 0,
  federal: 0,
  ss: 0,
  medicare: 0,
  aggregateFederalPayrollTaxes: 0,
  state: 0,
  retirement: 0,
  otherPreTax: 0,
  healthcare: 0,
  hsa: 0,
};

describe("Personal Income estimated net", () => {
  it("basic converted entry uses aggregate withholding", () => {
    expect(
      computeEstimatedNet({
        ...base,
        gross: 8000,
        aggregateFederalPayrollTaxes: 1000,
        retirement: 400,
        otherPreTax: 200,
      }),
    ).toBe(6400);
  });

  it("detailed converted entry uses detailed components only", () => {
    expect(
      computeEstimatedNet({
        ...base,
        gross: 10000,
        federal: 1500,
        ss: 620,
        medicare: 145,
        // aggregate mirrors the detailed sum; must not be double counted
        aggregateFederalPayrollTaxes: 2265,
        retirement: 500,
        healthcare: 200,
        otherPreTax: 100,
      }),
    ).toBe(6935);
  });

  it("manually entered entry with detailed splits and no aggregate", () => {
    expect(
      computeEstimatedNet({
        ...base,
        gross: 5000,
        federal: 800,
        ss: 310,
        medicare: 72.5,
        state: 100,
      }),
    ).toBe(3717.5);
  });

  it("does not fabricate detailed components", () => {
    expect(
      effectiveFederalWithholding({ federal: 0, ss: 0, medicare: 0, aggregateFederalPayrollTaxes: 1000 }),
    ).toBe(1000);
    expect(
      effectiveFederalWithholding({ federal: 500, ss: 0, medicare: 0, aggregateFederalPayrollTaxes: 1000 }),
    ).toBe(500);
  });

  it("clamps at zero", () => {
    expect(computeEstimatedNet({ ...base, gross: 100, aggregateFederalPayrollTaxes: 500 })).toBe(0);
  });
});
