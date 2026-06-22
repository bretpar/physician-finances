/**
 * Tax Prep PDF export.
 *
 * Lightweight formatter that takes pre-computed report data already shown
 * on the Annual Tax Summary page and renders it as a PDF using jsPDF +
 * jspdf-autotable. NO independent tax calculations live here — everything
 * comes from the calling page, which reuses the in-app tax engine outputs.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export interface IncomeSummaryRows {
  w2: number;
  income1099: number;
  k1: number;
  /** Optional split — when present, rendered as separate lines. */
  k1Active?: number;
  k1Passive?: number;
  investment: number;
  interest: number;
  dividend: number;
  total: number;
}

export interface BusinessSummaryRows {
  grossReceipts: number;
  categories: Array<{ label: string; amount: number }>;
  totalExpenses: number;
  netProfit: number;
}

export interface DeductionRows {
  hsa: number;
  retirement401k: number;
  mileage: number;
  homeOffice: number;
  healthcare: number;
}

export interface TaxSummaryRows {
  totalLiability: number;
  federal: number;
  state: number;
  selfEmployment: number;
  withheld: number;
  reserveSaved: number;
  paymentsMade: number;
  remaining: number;
}

export interface QuarterRow {
  quarter: "Q1" | "Q2" | "Q3" | "Q4";
  recommended: number;
  paid?: number;
  remaining?: number;
}

export interface TransactionRow {
  date: string;
  vendor: string;
  category: string;
  amount: number;
  type: "income" | "expense";
}

export interface TaxPrepPdfInput {
  taxYear: string;
  companyLabel: string;
  income: IncomeSummaryRows;
  business: BusinessSummaryRows;
  deductions: DeductionRows;
  tax: TaxSummaryRows;
  quarters: QuarterRow[];
  includeAppendix?: boolean;
  transactions?: TransactionRow[];
}

export function exportTaxPrepPdf(data: TaxPrepPdfInput) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let y = 50;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("Tax Prep Summary", marginX, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Tax Year: ${data.taxYear}`, marginX, y);
  doc.text(`Company: ${data.companyLabel}`, marginX + 200, y);
  doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth - marginX - 130, y);
  y += 18;

  const section = (title: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(title, marginX, y);
    y += 6;
  };

  const moneyRows = (rows: Array<[string, number, boolean?]>) =>
    rows.map(([label, amt, bold]) => [
      bold ? { content: label, styles: { fontStyle: "bold" as const } } : label,
      bold
        ? { content: fmt(amt), styles: { fontStyle: "bold" as const, halign: "right" as const } }
        : { content: fmt(amt), styles: { halign: "right" as const } },
    ]);

  const renderTable = (body: any[]) => {
    autoTable(doc, {
      startY: y + 4,
      body,
      theme: "plain",
      styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: { 1: { halign: "right", cellWidth: 120 } },
      margin: { left: marginX, right: marginX },
    });
    // @ts-expect-error autotable attaches lastAutoTable to doc
    y = doc.lastAutoTable.finalY + 16;
  };

  // ── 1. Income Summary
  section("1. Income Summary");
  const hasK1Split =
    data.income.k1Active !== undefined || data.income.k1Passive !== undefined;
  const incomeRows: Array<[string, number, boolean?]> = [
    ["W-2 Income", data.income.w2],
    ["1099 Income", data.income.income1099],
  ];
  if (hasK1Split) {
    incomeRows.push(["K-1 Income (Active)", data.income.k1Active ?? 0]);
    incomeRows.push(["K-1 Income (Passive)", data.income.k1Passive ?? 0]);
  } else {
    incomeRows.push(["K-1 Income", data.income.k1]);
  }
  incomeRows.push(
    ["Investment Income (capital gains)", data.income.investment],
    ["Interest Income", data.income.interest],
    ["Dividend Income", data.income.dividend],
    ["Total Gross Income", data.income.total, true],
  );
  renderTable(moneyRows(incomeRows));

  // ── 2. Business Summary (Schedule C)
  section("2. Business Summary (Schedule C)");
  const bizRows: any[] = [
    ...moneyRows([["Gross receipts / sales", data.business.grossReceipts]]),
    ...data.business.categories
      .filter((c) => c.amount > 0)
      .map((c) => [c.label, { content: fmt(c.amount), styles: { halign: "right" as const } }]),
    ...moneyRows([
      ["Total Expenses", data.business.totalExpenses, true],
      ["Net Profit / Loss", data.business.netProfit, true],
    ]),
  ];
  renderTable(bizRows);

  // ── 3. Deductions Summary
  section("3. Deductions Summary");
  const dedTotal =
    data.deductions.hsa +
    data.deductions.retirement401k +
    data.deductions.mileage +
    data.deductions.homeOffice +
    data.deductions.healthcare;
  renderTable(
    moneyRows([
      ["HSA Contributions", data.deductions.hsa],
      ["401(k) / Retirement Contributions", data.deductions.retirement401k],
      ["Mileage Deduction", data.deductions.mileage],
      ["Home Office Deduction", data.deductions.homeOffice],
      ["Healthcare Deduction", data.deductions.healthcare],
      ["Total Deductions", dedTotal, true],
    ]),
  );

  // page break if low
  if (y > 650) {
    doc.addPage();
    y = 50;
  }

  // ── 4. Tax Summary
  section("4. Tax Summary");
  renderTable(
    moneyRows([
      ["Federal Tax Estimate", data.tax.federal],
      ["State Tax Estimate", data.tax.state],
      ["Self-Employment Tax Estimate", data.tax.selfEmployment],
      ["Estimated Annual Tax Liability", data.tax.totalLiability, true],
      ["Taxes Already Withheld", data.tax.withheld],
      ["Tax Reserve Saved", data.tax.reserveSaved],
      ["Quarterly Payments Made", data.tax.paymentsMade],
      ["Remaining Estimated Liability", data.tax.remaining, true],
    ]),
  );

  // ── 5. Quarterly Tax Summary
  section("5. Quarterly Tax Summary");
  autoTable(doc, {
    startY: y + 4,
    head: [["Quarter", "Recommended", "Paid", "Remaining"]],
    body: data.quarters.map((q) => [
      q.quarter,
      fmt(q.recommended),
      q.paid !== undefined ? fmt(q.paid) : "—",
      q.remaining !== undefined ? fmt(q.remaining) : "—",
    ]),
    theme: "striped",
    headStyles: { fillColor: [240, 240, 240], textColor: 20 },
    styles: { fontSize: 10, cellPadding: 4 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    margin: { left: marginX, right: marginX },
  });
  // @ts-expect-error
  y = doc.lastAutoTable.finalY + 16;

  // Disclaimer
  if (y > 720) {
    doc.addPage();
    y = 50;
  }
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(
    "This tax-prep summary is generated from data tracked in the app. It is a worksheet for reference, not an official IRS form.",
    marginX,
    y,
  );

  // ── Optional Appendix: Transactions
  if (data.includeAppendix && data.transactions && data.transactions.length > 0) {
    doc.addPage();
    y = 50;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Appendix: Transaction Detail", marginX, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`${data.transactions.length} transactions for ${data.taxYear}`, marginX, y);

    autoTable(doc, {
      startY: y + 8,
      head: [["Date", "Vendor", "Category", "Type", "Amount"]],
      body: data.transactions.map((t) => [
        t.date,
        t.vendor,
        t.category,
        t.type === "income" ? "Income" : "Expense",
        fmt(t.amount),
      ]),
      theme: "grid",
      headStyles: { fillColor: [240, 240, 240], textColor: 20 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 4: { halign: "right" } },
      margin: { left: marginX, right: marginX },
    });
  }

  doc.save(`tax-prep-${data.taxYear}.pdf`);
}
