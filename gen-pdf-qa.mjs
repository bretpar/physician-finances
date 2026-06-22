import { writeFileSync } from "node:fs";
import jsPDFMod from "jspdf";
const jsPDF = jsPDFMod.jsPDF || jsPDFMod.default || jsPDFMod;
const origSave = jsPDF.prototype.save;
jsPDF.prototype.save = function(name) {
  const buf = this.output("arraybuffer");
  writeFileSync("/tmp/pdfqa/out.pdf", Buffer.from(buf));
  console.error("saved", name, buf.byteLength, "bytes");
};
const { exportTaxPrepPdf } = await import("./src/lib/taxPrepPdf.ts");
exportTaxPrepPdf({
  taxYear: "2026",
  companyLabel: "All Companies",
  filingStatus: "married_filing_jointly",
  taxableIncome: 412345,
  effectiveRate: 0.243,
  income: { w2: 250000, income1099: 180000, k1: 60000, k1Active: 40000, k1Passive: 20000, investment: 12000, interest: 3500, dividend: 2200, total: 487700 },
  business: {
    grossReceipts: 180000,
    categories: [
      { label: "Advertising", amount: 1200 },
      { label: "Car and truck expenses", amount: 4200 },
      { label: "Insurance (other than health)", amount: 2800 },
      { label: "Legal and professional services", amount: 5400 },
      { label: "Office expense", amount: 3100 },
      { label: "Supplies", amount: 7600 },
      { label: "Travel", amount: 4800 },
      { label: "Meals", amount: 1900 },
      { label: "Utilities", amount: 2200 },
      { label: "Home office (Form 8829)", amount: 3600 },
    ],
    totalExpenses: 36800, netProfit: 143200,
  },
  businessEntityRows: [
    { entity: "WWEP", type: "1099 / Schedule C", income: 130000, expenses: 28000, net: 102000 },
    { entity: "Vituity", type: "K-1 (Active)", income: 50000, expenses: 8800, net: 41200 },
  ],
  passiveK1Rows: [
    { entity: "Real Estate Partners LP", income: 18000 },
    { entity: "Surgery Center Holdings", income: 22000 },
  ],
  deductions: { hsa: 8300, retirement401k: 23000, mileage: 4200, homeOffice: 3600, healthcare: 6800 },
  tax: { totalLiability: 118400, federal: 82000, state: 14000, selfEmployment: 22400, withheld: 56000, reserveSaved: 18000, paymentsMade: 22000, remaining: 22400 },
  quarters: [
    { quarter: "Q1", recommended: 5600, paid: 5600, remaining: 0 },
    { quarter: "Q2", recommended: 5600, paid: 5600, remaining: 0 },
    { quarter: "Q3", recommended: 5600, paid: 5600, remaining: 0 },
    { quarter: "Q4", recommended: 5600, paid: 0, remaining: 5600 },
  ],
  includeAppendix: true,
  transactions: [
    { date: "2026-01-15", vendor: "Hospital A", category: "1099 Income", amount: 12000, type: "income", entity: "WWEP" },
    { date: "2026-02-10", vendor: "Office Depot", category: "Office expense", amount: 220, type: "expense", entity: "WWEP" },
    { date: "2026-03-04", vendor: "United Airlines", category: "Travel", amount: 480, type: "expense", entity: "WWEP" },
    { date: "2026-04-22", vendor: "Vituity Payroll", category: "K-1 Income", amount: 18000, type: "income", entity: "Vituity" },
    { date: "2026-05-13", vendor: "Conference Fee", category: "Legal and professional services", amount: 1200, type: "expense", entity: "Vituity" },
  ],
});
console.error("done");
