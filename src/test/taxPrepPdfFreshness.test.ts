/**
 * Regression tests for Tax Prep PDF download freshness.
 *
 * Every call to `exportTaxPrepPdf` must:
 *   • produce a NEW Blob (no reused instance)
 *   • produce a NEW object URL (revoked after download)
 *   • produce a UNIQUE filename that includes the tax year, a timestamp,
 *     and a per-export id
 *   • embed the current HSA + taxable-income values (no stale numbers)
 *   • embed the export id in the PDF footer
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const textCalls: string[] = [];
const blobs: Blob[] = [];
const createdUrls: string[] = [];
const revokedUrls: string[] = [];
const downloads: { url: string; filename: string }[] = [];

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
    addPage() {}
    setPage() {}
    getNumberOfPages() { return 1; }
    text(t: string | string[]) {
      if (Array.isArray(t)) textCalls.push(...t);
      else textCalls.push(String(t));
    }
    save() {}
    output(kind: string) {
      if (kind === "blob") {
        const b = new Blob([`pdf-${blobs.length}-${Math.random()}`], { type: "application/pdf" });
        blobs.push(b);
        return b;
      }
      return "";
    }
  }
  return { default: FakeDoc };
});

vi.mock("jspdf-autotable", () => ({ default: () => {} }));

import { exportTaxPrepPdf, type TaxPrepPdfInput } from "@/lib/taxPrepPdf";

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  textCalls.length = 0;
  blobs.length = 0;
  createdUrls.length = 0;
  revokedUrls.length = 0;
  downloads.length = 0;

  let counter = 0;
  URL.createObjectURL = ((_blob: Blob) => {
    const url = `blob:mock/${++counter}`;
    createdUrls.push(url);
    return url;
  }) as any;
  URL.revokeObjectURL = ((url: string) => {
    revokedUrls.push(url);
  }) as any;

  const origCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = origCreateElement(tag);
    if (tag === "a") {
      (el as HTMLAnchorElement).click = () => {
        downloads.push({
          url: (el as HTMLAnchorElement).href,
          filename: (el as HTMLAnchorElement).download,
        });
      };
    }
    return el as any;
  });
});

const baseInput = (over: Partial<TaxPrepPdfInput> = {}): TaxPrepPdfInput => ({
  taxYear: "2026",
  companyLabel: "All Companies",
  filingStatus: "single",
  taxableIncome: 80900,
  effectiveRate: 12.5,
  income: {
    w2: 100000, income1099: 0, k1: 0, k1Active: 0, k1Passive: 0,
    investment: 0, interest: 0, dividend: 0, total: 100000,
  },
  business: { grossReceipts: 0, categories: [], totalExpenses: 0, netProfit: 0 },
  deductions: {
    hsa: 6000,
    hsaEmployeePayroll: 3000,
    hsaEmployer: 2000,
    hsaIndividual: 1000,
    hsaDeductible: 3000,
    hsaExcess: 1600,
    hsaLimit: 4400,
    retirement401k: 0,
    mileage: 0,
    homeOffice: 0,
    healthcare: 0,
  },
  tax: {
    totalLiability: 12000, federal: 12000, state: 0, selfEmployment: 0,
    withheld: 5000, reserveSaved: 0, paymentsMade: 0, remaining: 7000,
  },
  quarters: [],
  ...over,
});

async function waitForRevoke() {
  await new Promise((r) => setTimeout(r, 5));
}

describe("Tax Prep PDF — download freshness", () => {
  it("stamps a unique export id + timestamp filename per download", async () => {
    const a = exportTaxPrepPdf(baseInput());
    await waitForRevoke();
    const b = exportTaxPrepPdf(baseInput());
    await waitForRevoke();

    expect(a.exportId).not.toBe(b.exportId);
    expect(a.filename).not.toBe(b.filename);
    expect(a.filename).toMatch(/^PaycheckMD-Tax-Prep-2026-\d{8}-\d{6}-[0-9a-f]{8}\.pdf$/);
    expect(b.filename).toMatch(/^PaycheckMD-Tax-Prep-2026-\d{8}-\d{6}-[0-9a-f]{8}\.pdf$/);
  });

  it("creates a new Blob + object URL for each download and revokes them", async () => {
    exportTaxPrepPdf(baseInput());
    exportTaxPrepPdf(baseInput());
    await waitForRevoke();

    expect(blobs.length).toBe(2);
    expect(blobs[0]).not.toBe(blobs[1]);
    expect(createdUrls).toEqual(["blob:mock/1", "blob:mock/2"]);
    expect(downloads.map((d) => d.url)).toEqual(["blob:mock/1", "blob:mock/2"]);
    expect(revokedUrls.sort()).toEqual(["blob:mock/1", "blob:mock/2"]);
  });

  it("regenerating with updated taxable income renders the new value (no stale reuse)", () => {
    exportTaxPrepPdf(baseInput({ taxableIncome: 78900 }));
    const firstText = textCalls.join(" | ");
    expect(firstText).toContain("$78,900");

    textCalls.length = 0;
    exportTaxPrepPdf(baseInput()); // taxableIncome 80900
    const secondText = textCalls.join(" | ");
    expect(secondText).toContain("$80,900");
    expect(secondText).not.toContain("$78,900");
  });

  it("stamps the export id in the PDF footer for QA verification", () => {
    const r = exportTaxPrepPdf(baseInput());
    const text = textCalls.join(" | ");
    expect(text).toContain(`Export ID: ${r.exportId}`);
    expect(text).toContain("Tax Year 2026");
  });
});
