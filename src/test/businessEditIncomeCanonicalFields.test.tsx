/**
 * Edit Income form (Business Activity) — canonical field rendering.
 *
 * A planner-converted K-1 occurrence writes its ledger row through
 * `buildOccurrenceLedgerFields`. Reopening the Edit Income form must render
 * Health Insurance, Other Pre-Tax, Retirement and Net Received straight from
 * those canonical columns — the aggregate pre-tax amount must never be shown
 * twice (once as Health Insurance and again as Other Pre-Tax), and Net Received
 * must follow the shared precedence helper.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { buildOccurrenceLedgerFields } from "@/lib/plannerOccurrenceLedger";
import { resolveNetReceived } from "@/lib/netReceivedPrecedence";

type LedgerRow = ReturnType<typeof buildOccurrenceLedgerFields>;

/** Mirrors the Edit Income hydration + field markup for the audited fields. */
function EditIncomeFields({
  linked,
  siblingAmount = 0,
}: {
  linked: LedgerRow;
  siblingAmount?: number;
}) {
  const gross = Number(linked.paycheck_amount) || 0;
  const calculatedNet = Math.max(
    0,
    gross -
      linked.federal_withholding -
      linked.state_withholding -
      linked.pre_tax_deductions -
      linked.retirement_401k -
      linked.healthcare_deduction -
      linked.hsa_contribution,
  );
  const netReceived = resolveNetReceived({
    gross,
    savedDeposited: linked.deposited_amount,
    siblingAmount,
    calculatedNet,
  });
  const fmt = (v: number) => (v ? String(v) : "0");
  return (
    <form>
      <label htmlFor="gross_amount">Gross Amount</label>
      <input id="gross_amount" readOnly value={fmt(gross)} />
      <label htmlFor="net_received">Net Received</label>
      <input id="net_received" readOnly value={fmt(netReceived)} />
      <label htmlFor="healthcare_deduction">Health Insurance</label>
      <input id="healthcare_deduction" readOnly value={fmt(linked.healthcare_deduction)} />
      <label htmlFor="hsa_contribution">HSA Contribution</label>
      <input id="hsa_contribution" readOnly value={fmt(linked.hsa_contribution)} />
      <label htmlFor="pre_tax_deductions">Other Pre-Tax</label>
      <input id="pre_tax_deductions" readOnly value={fmt(linked.pre_tax_deductions)} />
      <label htmlFor="retirement_401k">Retirement</label>
      <input id="retirement_401k" readOnly value={fmt(linked.retirement_401k)} />
    </form>
  );
}

const val = (label: string) =>
  (screen.getByLabelText(label) as HTMLInputElement).value;

describe("Business Activity → Edit Income renders canonical ledger fields", () => {
  it("renders the production K-1 case with $7,662 Net Received and no double-counted pre-tax", () => {
    const linked = buildOccurrenceLedgerFields({
      grossAmount: 10675,
      taxesWithheld: 0,
      retirement401k: 320,
      preTaxDeductions: 2693, // aggregate: health 2493 + HSA 200
      healthcareDeduction: 2493,
      hsaContribution: 200,
      hasDetailedBreakdown: true,
    });

    render(<EditIncomeFields linked={linked} />);

    expect(val("Gross Amount")).toBe("10675");
    expect(val("Health Insurance")).toBe("2493");
    expect(val("HSA Contribution")).toBe("200");
    expect(val("Other Pre-Tax")).toBe("0");
    expect(val("Retirement")).toBe("320");
    expect(val("Net Received")).toBe("7662");

    // Totals tie out: gross − retirement − health − HSA − other pre-tax = net.
    expect(
      10675 -
        Number(val("Retirement")) -
        Number(val("Health Insurance")) -
        Number(val("HSA Contribution")) -
        Number(val("Other Pre-Tax")),
    ).toBe(Number(val("Net Received")));
  });

  it("keeps each component once for mixed deductions (health + HSA + other)", () => {
    const linked = buildOccurrenceLedgerFields({
      grossAmount: 9000,
      taxesWithheld: 1000,
      retirement401k: 500,
      preTaxDeductions: 800, // health 300 + HSA 200 + other 300
      healthcareDeduction: 300,
      hsaContribution: 200,
      federalWithholding: 1000,
      hasDetailedBreakdown: true,
    });

    render(<EditIncomeFields linked={linked} />);

    expect(val("Health Insurance")).toBe("300");
    expect(val("HSA Contribution")).toBe("200");
    expect(val("Other Pre-Tax")).toBe("300");
    expect(val("Retirement")).toBe("500");
    expect(
      Number(val("Health Insurance")) +
        Number(val("HSA Contribution")) +
        Number(val("Other Pre-Tax")),
    ).toBe(800);
    expect(val("Net Received")).toBe("6700");
  });

  it("passes stream-level (non-detailed) pre-tax through without subtraction", () => {
    const linked = buildOccurrenceLedgerFields({
      grossAmount: 4000,
      taxesWithheld: 0,
      retirement401k: 0,
      preTaxDeductions: 100,
      healthcareDeduction: 200,
      hsaContribution: 0,
      hasDetailedBreakdown: false,
    });

    render(<EditIncomeFields linked={linked} />);

    expect(val("Other Pre-Tax")).toBe("100");
    expect(val("Health Insurance")).toBe("200");
    expect(val("Net Received")).toBe("3700");
  });

  it("prefers the real bank deposit over the calculated net when a Plaid sibling is linked", () => {
    const linked = buildOccurrenceLedgerFields({
      grossAmount: 10675,
      taxesWithheld: 0,
      retirement401k: 320,
      preTaxDeductions: 2693,
      healthcareDeduction: 2493,
      hsaContribution: 200,
      hasDetailedBreakdown: true,
    });
    // Planner conversion wrote gross into deposited_amount as a placeholder.
    render(<EditIncomeFields linked={{ ...linked, deposited_amount: 10675 }} siblingAmount={7500} />);

    expect(val("Net Received")).toBe("7500");
    expect(val("Health Insurance")).toBe("2493");
    expect(val("Other Pre-Tax")).toBe("0");
  });

  it("never shows a negative or duplicated Other Pre-Tax when components exceed the aggregate", () => {
    const linked = buildOccurrenceLedgerFields({
      grossAmount: 4000,
      taxesWithheld: 0,
      retirement401k: 0,
      preTaxDeductions: 100,
      healthcareDeduction: 500,
      hsaContribution: 0,
      hasDetailedBreakdown: true,
    });

    render(<EditIncomeFields linked={linked} />);

    expect(val("Other Pre-Tax")).toBe("0");
    expect(Number(val("Other Pre-Tax"))).toBeGreaterThanOrEqual(0);
    expect(val("Net Received")).toBe("3500");
  });
});
