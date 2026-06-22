/**
 * Regression test for the Tax Preparation Summary header values in the
 * Tax Prep PDF export. Specifically guards the effective-rate formatter
 * against a double-percent bug (engine emits percent units, PDF used to
 * multiply by 100 again, producing values like "1619.37%").
 */
import { describe, it, expect, vi } from "vitest";

// Capture the jsPDF doc so we can grep the text it rendered.
const textCalls: string[] = [];
const addPage = vi.fn();
const save = vi.fn();

vi.mock("jspdf", () => {
  class FakeDoc {
    internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 }, getNumberOfPages: () => 1 };
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setDrawColor() {}
    setFillColor() {}
    setLineWidth() {}
    line() {}
    roundedRect() {}
    rect() {}
    addPage = addPage;
    setPage() {}
    getNumberOfPages() { return 1; }
    text(t: string | string[]) {
      if (Array.isArray(t)) textCalls.push(...t);
      else textCalls.push(String(t));
    }
    save = save;
  }
  return { default: FakeDoc };
});

vi.mock("jspdf-autotable", () => ({ default: () => {} }));

import { exportTaxPrepPdf, type TaxPrepPdfInput } from "@/lib/taxPrepPdf";

const baseInput = (over: Partial<TaxPrepPdfInput> = {}): TaxPrepPdfInput => ({
  taxYear: "2026",
  companyLabel: "All Companies",
  filingStatus: "married_filing_jointly",
  taxableIncome: 353852,
  effectiveRate: 16.1937, // engine emits percent units
  income: {
    w2: 200000, income1099: 40000, k1: 8632, k1Active: 8632, k1Passive: 0,
    investment: 0, interest: 0, dividend: 0, total: 248632,
  },
  business: { grossReceipts: 40000, categories: [], totalExpenses: 5000, netProfit: 35000 },
  deductions: { hsa: 0, retirement401k: 0, mileage: 0, homeOffice: 0, healthcare: 0 },
  tax: {
    totalLiability: 69835, federal: 50000, state: 0, selfEmployment: 5000,
    withheld: 40000, reserveSaved: 0, paymentsMade: 0, remaining: 29835,
  },
  quarters: [],
  ...over,
});

describe("Tax Prep PDF — summary header values", () => {
  it("renders effective rate in percent units exactly once (no double-multiply)", () => {
    textCalls.length = 0;
    exportTaxPrepPdf(baseInput());
    const text = textCalls.join(" | ");
    expect(text).toContain("16.19%");
    expect(text).not.toMatch(/1619\.\d+%/);
  });

  it("handles a fractional effective rate (0-1) by scaling to percent once", () => {
    textCalls.length = 0;
    exportTaxPrepPdf(baseInput({ effectiveRate: 0.281 }));
    const text = textCalls.join(" | ");
    expect(text).toContain("28.10%");
  });

  it("renders the supplied gross income, taxable income, and liability verbatim", () => {
    textCalls.length = 0;
    exportTaxPrepPdf(baseInput());
    const text = textCalls.join(" | ");
    expect(text).toContain("$248,632"); // gross income
    expect(text).toContain("$353,852"); // taxable income (from engine)
    expect(text).toContain("$69,835");  // total liability
  });
});
