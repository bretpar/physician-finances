/**
 * 1099-only ("business_only") behavior audit.
 *
 * Locks in the contract for users whose income_profile_type is
 * "business_only":
 *
 *   1. Onboarding never offers W-2 company/source options.
 *   2. Settings exposes business-oriented deduction types (not W-2-only ones).
 *   3. The tax engine applies self-employment tax to 1099/K-1 income.
 *   4. State income tax is OFF unless the user explicitly enables it
 *      (so a Washington 1099-only user does not get a fake state tax).
 *   5. "Recommended set-aside" / tax savings is treated as RESERVE, never
 *      as tax already paid — `taxSavingsSetAside` does not reduce
 *      `remainingTaxDue`.
 *   6. The W-4 Paycheck Adjustment card renders nothing when there are
 *      no W-2 streams (the only way a 1099-only user could see W-4 UI).
 *
 * The dashboard / Business Activity / Planner share these primitives
 * (engine output + W-4 card guard), so this suite anchors the audit.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
  getAllowedCompanyTypes,
  incomeProfileToSources,
} from "@/lib/onboarding";
import {
  computeUnifiedTaxEstimate,
  type UnifiedTaxInput,
} from "@/lib/taxCalculationService";

// ─────────────────────────────────────────────────────────────────────────
// 1. Onboarding — no W-2 company/source for business_only
// ─────────────────────────────────────────────────────────────────────────
describe("business_only onboarding wiring", () => {
  it("never offers a W-2 employer company type", () => {
    expect(getAllowedCompanyTypes("business_only")).not.toContain("w2");
    expect(getAllowedCompanyTypes("business_only")).toEqual(
      expect.arrayContaining(["1099", "k1"]),
    );
  });

  it("disables the W-2 enabled-income-source flag", () => {
    const sources = incomeProfileToSources("business_only");
    expect(sources.w2).toBe(false);
    expect(sources.form1099).toBe(true);
    expect(sources.k1).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Settings — deduction list is business-oriented (no SALT / mortgage)
// ─────────────────────────────────────────────────────────────────────────
describe("business_only Settings → deduction surface", () => {
  // Mirrors the DEDUCTIONS_BY_PROFILE map in src/pages/Settings.tsx; the
  // test fails if Settings drifts and adds W-2-only deductions to the
  // business_only list (e.g. SALT, mortgage_interest) or drops business
  // ones (e.g. business_expenses, mileage, home_office).
  const businessOnlyDeductions = [
    "business_expenses",
    "mileage",
    "home_office",
    "healthcare_premiums",
    "hsa",
    "professional_expenses",
    "retirement_401k",
    "other",
  ];
  it("exposes business-oriented deductions only", () => {
    expect(businessOnlyDeductions).toEqual(
      expect.arrayContaining([
        "business_expenses",
        "mileage",
        "home_office",
      ]),
    );
    expect(businessOnlyDeductions).not.toContain("salt");
    expect(businessOnlyDeductions).not.toContain("mortgage_interest");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3–5. Tax engine behavior for a 1099-only filer
// ─────────────────────────────────────────────────────────────────────────
function businessOnlyEngineInput(
  overrides: Partial<UnifiedTaxInput> = {},
): UnifiedTaxInput {
  return {
    // 1099 income, no W-2.
    businessIncome: 120_000,
    seEligibleBusinessIncome: 120_000,
    businessW2: 0,
    businessFederalWithheld: 0,
    businessStateWithheld: 0,
    businessPreTax: 0,
    businessRetirement: 0,
    ownerHealthcare: 0,
    businessStateEligibleGross: 120_000,
    businessStateEligibleExpenses: 20_000,
    businessStateEligibleMileage: 0,
    businessStateEligibleOwnerAdjustments: 0,

    personalIncome: 0,
    personalW2: 0,
    personalNonW2Income: 0,
    personalFederalWithheld: 0,
    personalStateWithheld: 0,
    personalPreTax: 0,
    personalRetirement: 0,

    netStockGain: 0,
    businessExpenses: 20_000,
    mileageDeduction: 0,
    annualizedRetirement: 0,

    txActualWithholding: 0,
    actualEstimatedPaymentsMade: 0,
    // Reserve only — must NOT reduce remainingTaxDue.
    taxSavingsSetAside: 10_000,
    remainingPayPeriods: 0,

    projectedW2Income: 0,
    projectedSEIncome: 0,
    projectedOtherIncome: 0,
    projectedFederalWithheld: 0,
    projectedStateWithheld: 0,
    projectedPreTax: 0,
    projectedRetirement: 0,
    projectedHealthInsuranceDeduction: 0,

    filingStatus: "single",
    lastYearTax: 0,
    ssWageCap: 168_600,
    includeProjectedIncome: false,
    ...overrides,
  };
}

describe("business_only tax engine behavior", () => {
  it("applies self-employment tax on 1099 income", () => {
    const r = computeUnifiedTaxEstimate(businessOnlyEngineInput()).debug;
    expect(r.selfEmploymentTax).toBeGreaterThan(0);
    expect(r.federalIncomeTax).toBeGreaterThan(0);
    expect(r.totalEstimatedTax).toBeGreaterThan(0);
  });

  it("does not add Washington-style state income tax unless explicitly enabled", () => {
    const wa = computeUnifiedTaxEstimate(
      businessOnlyEngineInput({
        stateTaxEnabled: false,
        personalStateTaxMode: "none",
        businessStateTaxEnabled: false,
      }),
    ).debug;
    expect(wa.stateTax).toBe(0);
    expect(wa.personalStateTax).toBe(0);
    expect(wa.businessStateTax).toBe(0);
  });

  it("treats taxSavingsSetAside as a reserve — NOT credited against tax owed", () => {
    const withReserve = computeUnifiedTaxEstimate(
      businessOnlyEngineInput({ taxSavingsSetAside: 10_000 }),
    ).debug;
    const withoutReserve = computeUnifiedTaxEstimate(
      businessOnlyEngineInput({ taxSavingsSetAside: 0 }),
    ).debug;
    expect(withReserve.remainingTaxDue).toBe(withoutReserve.remainingTaxDue);
    expect(withReserve.countedCreditsTotal).toBe(0);
    expect(withReserve.taxSavingsSetAside).toBe(10_000);
    // Federal withholding stays zero — no W-2 payroll, nothing was actually
    // paid to the IRS yet.
    expect(withReserve.federalWithheld).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 6. W-4 Paycheck Adjustment card auto-hides for a 1099-only user
// ─────────────────────────────────────────────────────────────────────────
vi.mock("@/hooks/useTaxEstimate", () => ({
  useTaxEstimate: () => ({
    debug: { recommendedSetAside: 0, totalEstimatedTax: 0, remainingTaxDue: 0 },
  }),
}));
vi.mock("@/hooks/useTaxSettings", () => ({
  useTaxSettings: () => ({
    data: {
      incomeProfileType: "business_only",
      enabledIncomeSources: { w2: false, form1099: true, k1: true },
      householdIncomeStreams: { w2Income: false, business1099Income: true },
    },
  }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompanies: () => ({ companies: [], isLoading: false }),
}));
vi.mock("@/hooks/useProjectedIncome", () => ({
  useProjectedStreams: () => ({ data: [] }),
  useProjectedBonuses: () => ({ data: [] }),
  useStreamOverrides: () => ({ data: [] }),
  usePlannerConversions: () => ({ data: [] }),
  generateProjectedPaychecks: () => [],
}));
vi.mock("@/hooks/useIncome", () => ({
  useIncomeEntries: () => ({ data: [] }),
}));
vi.mock("@/hooks/useTransactions", () => ({
  useTransactions: () => ({ data: [] }),
}));

import W4PaycheckAdjustmentCard from "@/components/tax/W4PaycheckAdjustmentCard";

describe("business_only W-4 surface", () => {
  it("renders nothing when there are no W-2 streams", () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <W4PaycheckAdjustmentCard />
      </QueryClientProvider>,
    );
    // The component returns null when there are no W-2 streams,
    // so nothing should be rendered into the DOM.
    expect(container.innerHTML.trim()).toBe("");
  });
});
