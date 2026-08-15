/**
 * Regression: editing SS/Medicare must never change the savings
 * recommendation, and the auto-calculated "Total Federal Payroll Taxes" must
 * reflect the CURRENT breakdown inputs immediately.
 *
 * Production bug: with fed=$0, state=$0, SS=$310, Medicare=$72.50 the
 * recommendation was $392. Clearing SS left it at $392 (correct), but clearing
 * Medicare dropped it to $320 because the aggregate total kept the stale
 * $72.50 and that stale total leaked in as a federal income-tax credit.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { TotalFederalTaxField } from "@/components/TotalFederalTaxField";
import { calculatePaycheckProfileSavings } from "@/lib/paycheckProfileSavings";
import { getFederalIncomeTaxWithheld } from "@/lib/federalWithholding";

function Harness() {
  const [total, setTotal] = useState("382.50");
  const [federal, setFederal] = useState("0");
  const [ss, setSs] = useState("310");
  const [medicare, setMedicare] = useState("72.50");
  return (
    <>
      <TotalFederalTaxField
        total={total}
        onTotalChange={setTotal}
        federal={federal}
        onFederalChange={setFederal}
        ss={ss}
        onSsChange={setSs}
        medicare={medicare}
        onMedicareChange={setMedicare}
      />
      <div data-testid="total-value">{total}</div>
    </>
  );
}

const num = (s: string) => (Number.isFinite(Number(s)) ? Number(s) : 0);

/** Mirrors the PersonalIncome recommendation wiring. */
function recommendationFor(form: {
  total: string;
  federal: string;
  ss: string;
  medicare: string;
}) {
  const totalFederalPayrollTaxes = num(form.total);
  return calculatePaycheckProfileSavings({
    grossPaycheckIncome: 5000,
    eligiblePreTaxDeductions: 0,
    selectedProfileEffectiveTaxRate: 7.84, // → $392 target on $5,000
    totalFederalPayrollTaxes,
    federalIncomeTaxWithheld: getFederalIncomeTaxWithheld({
      taxes_withheld: totalFederalPayrollTaxes,
      federal_withholding: num(form.federal),
      ss_withholding: num(form.ss),
      medicare_withholding: num(form.medicare),
    }),
    socialSecurityAndMedicareWithheld: num(form.ss) + num(form.medicare),
    stateWithholdingIfEnabled: 0,
    stateTaxIncludedInTarget: false,
  }).remainingSavingsNeeded;
}

describe("FICA edit state", () => {
  it("SS and Medicare are excluded from the recommendation at every edit step", () => {
    // Start: fed 0, SS 310, Medicare 72.50 → total 382.50
    expect(
      recommendationFor({ total: "382.50", federal: "0", ss: "310", medicare: "72.50" }),
    ).toBeCloseTo(392, 2);
    // Remove SS → total 72.50, recommendation unchanged
    expect(
      recommendationFor({ total: "72.50", federal: "0", ss: "0", medicare: "72.50" }),
    ).toBeCloseTo(392, 2);
    // Remove Medicare → total cleared, recommendation STILL unchanged
    expect(
      recommendationFor({ total: "", federal: "0", ss: "0", medicare: "0" }),
    ).toBeCloseTo(392, 2);
  });

  it("a stale aggregate total can no longer act as a federal income-tax credit", () => {
    // Even if a stale total somehow survives, the split fields win.
    expect(
      recommendationFor({ total: "72.50", federal: "0", ss: "0", medicare: "0" }),
    ).toBeCloseTo(392, 2);
  });

  it("real federal income tax still reduces the recommendation", () => {
    expect(
      recommendationFor({ total: "482.50", federal: "100", ss: "310", medicare: "72.50" }),
    ).toBeCloseTo(292, 2);
  });

  it("auto-total updates immediately when SS then Medicare are cleared", () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId("paycheck-federal-breakdown-toggle"));
    const ssInput = screen.getByTestId("paycheck-social-security-input");
    const medInput = screen.getByTestId("paycheck-medicare-input");

    fireEvent.change(ssInput, { target: { value: "" } });
    expect(screen.getByTestId("total-value").textContent).toBe("72.50");

    fireEvent.change(medInput, { target: { value: "" } });
    // No stale withholding total left behind.
    expect(screen.getByTestId("total-value").textContent).toBe("");
  });
});
