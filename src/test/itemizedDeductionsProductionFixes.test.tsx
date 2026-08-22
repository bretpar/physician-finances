import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MORTGAGE_DEBT_LIMIT,
  MORTGAGE_DEBT_LIMIT_MFS,
  computeItemizedDeductions,
  resolveItemizedDeductionInputs,
} from "@/lib/saltDeduction";
import { STANDARD_DEDUCTION, type FilingStatus } from "@/lib/taxBrackets";

const settingsSource = readFileSync("src/pages/Settings.tsx", "utf8");
const estimateSource = readFileSync("src/hooks/useTaxEstimate.ts", "utf8");

/* ─── 1. Married Filing Separately in the real filing-status UI ─── */

describe("Married Filing Separately in the Settings filing-status UI", () => {
  it("offers the canonical MFS value in the Tax Profile filing-status select", () => {
    expect(settingsSource).toContain('<SelectItem value="married_filing_separately"');
    // Exactly one MFS representation — no second value/label variant.
    expect(settingsSource.match(/married_filing_separately/g)?.length).toBe(1);
  });

  it("gives the filing-status combobox an accessible name", () => {
    expect(settingsSource).toContain('aria-label="Filing Status"');
    expect(settingsSource).toContain('id="settings-filing-status"');
  });
});

/* ─── 2. Mortgage limit + filing-status reactivity ─── */

const mortgageInput = (filingStatus: FilingStatus) => ({
  propertyTax: 0,
  stateIncomeTaxMode: "manual" as const,
  stateIncomeTaxEstimate: 0,
  stateIncomeTaxManual: 0,
  salesTaxBase: 0,
  salesTaxLargePurchases: 0,
  personalPropertyTax: 0,
  forceSalesTaxElection: false,
  saltCapOverride: null,
  otherItemizedDeductions: 0,
  mortgageInterest: 30_000,
  mortgageBalance: 1_500_000,
  filingStatus,
  magi: 0,
});

describe("mortgage acquisition-debt limit by filing status", () => {
  it("uses $375,000 for married filing separately", () => {
    expect(MORTGAGE_DEBT_LIMIT_MFS).toBe(375_000);
    const r = computeItemizedDeductions(mortgageInput("married_filing_separately"));
    expect(r.mortgageDebtLimit).toBe(375_000);
    // Existing proration formula, unchanged: 30,000 × 375k / 1.5M
    expect(r.mortgageInterestDeductible).toBeCloseTo(7_500, 6);
    expect(r.mortgageInterestDisallowed).toBeCloseTo(22_500, 6);
  });

  it("uses $750,000 for every other filing status", () => {
    for (const fs of ["single", "married_filing_jointly", "head_of_household"] as FilingStatus[]) {
      const r = computeItemizedDeductions(mortgageInput(fs));
      expect(r.mortgageDebtLimit).toBe(MORTGAGE_DEBT_LIMIT);
      expect(r.mortgageInterestDeductible).toBeCloseTo(15_000, 6);
    }
  });

  it("reacts immediately when the filing status changes", () => {
    const statuses: FilingStatus[] = [
      "single",
      "married_filing_jointly",
      "married_filing_separately",
      "head_of_household",
    ];
    const results = statuses.map((fs) => ({
      fs,
      standard: STANDARD_DEDUCTION[fs],
      ...computeItemizedDeductions({
        ...mortgageInput(fs),
        propertyTax: 30_000,
        stateIncomeTaxManual: 30_000,
        magi: 600_000,
      }),
    }));
    const mfs = results.find((r) => r.fs === "married_filing_separately")!;
    const mfj = results.find((r) => r.fs === "married_filing_jointly")!;
    expect(mfs.baseCap).toBeLessThan(mfj.baseCap);
    expect(mfs.mortgageDebtLimit).toBeLessThan(mfj.mortgageDebtLimit);
    expect(mfs.totalItemized).toBeLessThan(mfj.totalItemized);
  });
});

/* ─── 3. Entitlement downgrade must stop hidden deductions ─── */

describe("entitlement downgrade cannot silently reduce taxable income", () => {
  const rates = {
    filingStatus: "single",
    deductionType: "standard" as const,
    itemizedDeductionAmount: 0,
    itemizedDeductionsEnabled: true,
    saltPropertyTax: 30_000,
    saltStateIncomeTaxMode: "manual" as const,
    saltStateIncomeTaxManual: 30_000,
    itemizedMortgageInterest: 40_000,
    itemizedMortgageBalance: null,
  };

  it("applies itemized deductions when the feature is accessible", () => {
    const r = resolveItemizedDeductionInputs({
      rates,
      stateWithheldEstimate: 0,
      magiApprox: 300_000,
      hasFeatureAccess: true,
    });
    expect(r.deductionType).toBe("itemized");
    expect(r.itemizedDeductionAmount).toBeGreaterThan(STANDARD_DEDUCTION.single);
  });

  it("ignores saved itemized values once the user loses access", () => {
    const r = resolveItemizedDeductionInputs({
      rates,
      stateWithheldEstimate: 0,
      magiApprox: 300_000,
      hasFeatureAccess: false,
    });
    expect(r).toEqual({ deductionType: "standard", itemizedDeductionAmount: 0 });
  });

  it("restores the deduction when access comes back — saved values are preserved", () => {
    const denied = resolveItemizedDeductionInputs({ rates, stateWithheldEstimate: 0, magiApprox: 300_000, hasFeatureAccess: false });
    const restored = resolveItemizedDeductionInputs({ rates, stateWithheldEstimate: 0, magiApprox: 300_000, hasFeatureAccess: true });
    expect(denied.deductionType).toBe("standard");
    expect(restored.deductionType).toBe("itemized");
  });

  it("wires the single authoritative access decision into the tax engine hook", () => {
    expect(estimateSource).toContain('featureAccessStatus("itemizedDeductions") === "allowed"');
    expect(estimateSource).toContain("hasFeatureAccess: itemizedDeductionsAllowed");
  });
});

/* ─── 4 + 5. Card validation and accessible names ─── */

const taxSettings = {
  id: "ts-1",
  filingStatus: "single",
  standardDeductionOverride: null,
  personalStateTaxAnnualEstimate: 0,
  itemizedDeductionsEnabled: true,
};
const mutate = vi.fn();

vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({ data: taxSettings }),
  useUpdateTaxSettings: () => ({ mutate, isPending: false }),
}));
vi.mock("@/hooks/useTaxEstimate", () => ({
  useTaxEstimate: () => ({ estimate: { stateWithheld: 0, agi: 200_000 } }),
}));

import { ItemizedDeductionsCard } from "@/components/tax-savings/ItemizedDeductionsCard";

describe("Itemized Deductions card validation + accessibility", () => {
  it("rejects negative mortgage interest with an inline message and blocks save", async () => {
    mutate.mockClear();
    render(<ItemizedDeductionsCard />);
    const input = screen.getByTestId("itemized-mortgageInterest") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "-500" } });

    expect(screen.getByTestId("itemized-mortgageInterest-error")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const save = screen.getByTestId("itemized-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await userEvent.click(save);
    expect(mutate).not.toHaveBeenCalled();
    // The visible value is never silently replaced by 0.
    expect(input.value).toBe("-500");
  });

  it("accepts zero and decimal dollar amounts", () => {
    render(<ItemizedDeductionsCard />);
    const input = screen.getByTestId("itemized-mortgageInterest") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0" } });
    expect(screen.queryByTestId("itemized-mortgageInterest-error")).toBeNull();
    fireEvent.change(input, { target: { value: "1234.56" } });
    expect(screen.queryByTestId("itemized-mortgageInterest-error")).toBeNull();
    expect((screen.getByTestId("itemized-save") as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps the mortgage test IDs and exposes accessible switch names", () => {
    render(<ItemizedDeductionsCard />);
    expect(screen.getByTestId("itemized-mortgageInterest")).toBeTruthy();
    expect(screen.getByTestId("itemized-mortgageBalance")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Use itemized deductions" })).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Always elect sales tax" })).toBeTruthy();
  });
});

/* ─── 5. No conflicting "Coming soon" mortgage card ─── */

describe("Tax Savings mortgage-interest presentation", () => {
  it("no longer shows a standalone Mortgage Interest coming-soon card", () => {
    const source = readFileSync("src/pages/Mileage.tsx", "utf8");
    expect(source).not.toContain('value: "mortgage-interest"');
  });
});
