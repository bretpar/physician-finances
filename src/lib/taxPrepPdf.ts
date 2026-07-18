/**
 * Tax Prep PDF export.
 *
 * Accountant/TurboTax-friendly multi-page export. NO independent tax
 * calculations live here — every value is computed upstream and passed
 * in via the shared `exportPayload` in Reports.tsx.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n || 0);

// Accepts a rate that may be a fraction (0.281) OR already in percent (28.1).
// Values <= 1 are treated as fractions and scaled up; values > 1 are assumed
// to already be expressed in percent and rendered as-is. The tax engine emits
// percent units (see calculateEffectiveRate), so this avoids a double-multiply.
export const pct = (n: number) => {
  const v = Number(n) || 0;
  const asPercent = Math.abs(v) <= 1 ? v * 100 : v;
  return `${asPercent.toFixed(2)}%`;
};

export const FILING_STATUS_LABEL: Record<string, string> = {
  single: "Single",
  married_filing_jointly: "Married Filing Jointly",
  married_filing_separately: "Married Filing Separately",
  head_of_household: "Head of Household",
};

// ──────────────────────────────────────────────────────────── Types ────
export interface IncomeSummaryRows {
  w2: number;
  income1099: number;
  k1: number;
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
  /** Per-type HSA breakdown for report/PDF display. */
  hsaEmployeePayroll?: number;
  hsaEmployer?: number;
  hsaIndividual?: number;
  /** Deductible HSA capped at the applicable annual limit. */
  hsaDeductible?: number;
  /** Contributions above the annual limit (non-deductible, may be subject to tax). */
  hsaExcess?: number;
  /** Applicable IRS HSA limit for the tax year and coverage type. */
  hsaLimit?: number;
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

export interface BusinessEntityRow {
  entity: string;
  type?: string; // "1099 / Schedule C" | "K-1 (Active)"
  income: number;
  expenses: number;
  net: number;
}

export interface PassiveK1Row {
  entity: string;
  income: number;
}

export interface TransactionRow {
  date: string;
  vendor: string;
  category: string;
  amount: number;
  type: "income" | "expense";
  entity?: string;
}

export interface BusinessWorksheet {
  entity: string;
  type?: string; // "1099 / Schedule C" | "K-1 (Active)"
  grossReceipts: number;
  categories: Array<{ label: string; amount: number }>;
  totalExpenses: number;
  netProfit: number;
}

export interface TaxPrepPdfInput {
  taxYear: string;
  companyLabel: string;
  filingStatus?: string;
  taxableIncome?: number;
  effectiveRate?: number;
  income: IncomeSummaryRows;
  business: BusinessSummaryRows;
  businessEntityRows?: BusinessEntityRow[];
  businessWorksheets?: BusinessWorksheet[];
  passiveK1Rows?: PassiveK1Row[];
  deductions: DeductionRows;
  tax: TaxSummaryRows;
  quarters: QuarterRow[];
  includeAppendix?: boolean;
  transactions?: TransactionRow[];
  /** Unique per-export identifier (short hex). Stamped in the footer so QA
   *  can confirm each downloaded PDF is a fresh generation. */
  exportId?: string;
  /** Explicit generation timestamp (defaults to now). Stamped in the footer
   *  and used to build the unique filename. */
  generatedAt?: Date;
}

export interface TaxPrepPdfResult {
  filename: string;
  exportId: string;
  generatedAt: Date;
}

function generateExportId(): string {
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis as any).crypto : undefined;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(4);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
}

function formatFilenameStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

// ──────────────────────────────────────────── Layout primitives ────

const MARGIN_X = 48;
const HEADER_Y = 36;
const CONTENT_TOP = 92;
const FOOTER_Y = 760;

function drawPageChrome(
  doc: jsPDF,
  data: TaxPrepPdfInput,
  generatedAt: string,
  pageTitle: string,
) {
  const pageWidth = doc.internal.pageSize.getWidth();

  // Top brand bar
  doc.setDrawColor(220);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, HEADER_Y + 22, pageWidth - MARGIN_X, HEADER_Y + 22);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(40);
  doc.text("Tax Preparation Package", MARGIN_X, HEADER_Y + 12);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(`Tax Year ${data.taxYear}`, pageWidth / 2, HEADER_Y + 12, {
    align: "center",
  });
  doc.text(
    `Generated ${generatedAt}`,
    pageWidth - MARGIN_X,
    HEADER_Y + 12,
    { align: "right" },
  );

  // Page title (large)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(pageTitle, MARGIN_X, HEADER_Y + 50);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `Company: ${data.companyLabel}`,
    pageWidth - MARGIN_X,
    HEADER_Y + 50,
    { align: "right" },
  );

  // Footer (page number drawn later in stampFooters)
  doc.setDrawColor(230);
  doc.line(MARGIN_X, FOOTER_Y, pageWidth - MARGIN_X, FOOTER_Y);
}

function stampFooters(
  doc: jsPDF,
  meta: { generatedAtLabel: string; exportId: string; taxYear: string },
) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(
      "Tax-prep worksheet for reference — not an official IRS form.",
      MARGIN_X,
      FOOTER_Y + 14,
    );
    doc.text(`Page ${i} of ${total}`, w - MARGIN_X, FOOTER_Y + 14, {
      align: "right",
    });
    // Export provenance stamp — lets QA / users confirm the PDF is the
    // freshly generated one and not a stale re-opened download.
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(
      `Tax Year ${meta.taxYear} · Generated ${meta.generatedAtLabel} · Export ID: ${meta.exportId}`,
      MARGIN_X,
      FOOTER_Y + 26,
    );
  }
}

function tableBottom(doc: jsPDF, fallback: number): number {
  // @ts-expect-error attached by jspdf-autotable
  return (doc.lastAutoTable?.finalY ?? fallback) + 18;
}

// ─────────────────────────────────────────────────── Page renderers ────

function renderSummaryCards(doc: jsPDF, data: TaxPrepPdfInput) {
  const cards: Array<{ label: string; value: string; emphasis?: boolean }> = [
    { label: "Tax Year", value: data.taxYear, emphasis: true },
    {
      label: "Filing Status",
      value: data.filingStatus
        ? FILING_STATUS_LABEL[data.filingStatus] ?? data.filingStatus
        : "—",
    },
    { label: "Total Gross Income", value: fmt(data.income.total), emphasis: true },
    {
      label: "Total Taxable Income",
      value: data.taxableIncome !== undefined ? fmt(data.taxableIncome) : "—",
    },
    {
      label: "Effective Tax Rate",
      value: data.effectiveRate !== undefined ? pct(data.effectiveRate) : "—",
    },
    {
      label: "Estimated Annual Tax Liability",
      value: fmt(data.tax.totalLiability),
      emphasis: true,
    },
    { label: "Taxes Already Withheld", value: fmt(data.tax.withheld) },
    { label: "Tax Reserve Saved", value: fmt(data.tax.reserveSaved) },
    {
      label: "Remaining Estimated Liability",
      value: fmt(data.tax.remaining),
      emphasis: true,
    },
  ];

  const pageWidth = doc.internal.pageSize.getWidth();
  const cols = 3;
  const gap = 12;
  const cardW = (pageWidth - 2 * MARGIN_X - gap * (cols - 1)) / cols;
  const cardH = 78;
  let x = MARGIN_X;
  let y = CONTENT_TOP + 8;

  cards.forEach((c, idx) => {
    const col = idx % cols;
    if (col === 0 && idx > 0) {
      x = MARGIN_X;
      y += cardH + gap;
    }
    // Card border
    doc.setDrawColor(225);
    doc.setFillColor(c.emphasis ? 245 : 252, c.emphasis ? 247 : 252, c.emphasis ? 255 : 252);
    doc.roundedRect(x, y, cardW, cardH, 4, 4, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    doc.text(c.label.toUpperCase(), x + 12, y + 18);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(c.value.length > 14 ? 14 : 18);
    doc.setTextColor(c.emphasis ? 25 : 40);
    doc.text(c.value, x + 12, y + 50);

    x += cardW + gap;
  });

  // Quick reading note
  const noteY = y + cardH + 24;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    "Use these summary numbers for quick CPA / TurboTax review. Detailed tables follow.",
    MARGIN_X,
    noteY,
  );
}

function renderTable(
  doc: jsPDF,
  startY: number,
  head: string[][],
  body: any[][],
  opts?: { moneyCols?: number[]; striped?: boolean },
) {
  const money = new Set(opts?.moneyCols ?? []);
  const columnStyles: Record<number, any> = {};
  head[0].forEach((_, i) => {
    if (money.has(i)) columnStyles[i] = { halign: "right", cellWidth: "auto" };
  });
  autoTable(doc, {
    startY,
    head,
    body,
    theme: opts?.striped ? "striped" : "grid",
    headStyles: {
      fillColor: [235, 238, 245],
      textColor: 30,
      fontStyle: "bold",
      fontSize: 9,
    },
    styles: { fontSize: 9, cellPadding: 6, textColor: 30 },
    columnStyles,
    margin: { left: MARGIN_X, right: MARGIN_X },
  });
}

function renderIncomeSummary(doc: jsPDF, data: TaxPrepPdfInput) {
  const rows: any[][] = [
    ["W-2 Income", fmt(data.income.w2)],
    ["1099 Income", fmt(data.income.income1099)],
    ["Active K-1 Income", fmt(data.income.k1Active ?? 0)],
    ["Passive K-1 Income", fmt(data.income.k1Passive ?? 0)],
    ["Investment Income (capital gains)", fmt(data.income.investment)],
    ["Interest Income", fmt(data.income.interest)],
    ["Dividend Income", fmt(data.income.dividend)],
    [
      { content: "Total Gross Income", styles: { fontStyle: "bold" } },
      { content: fmt(data.income.total), styles: { fontStyle: "bold", halign: "right" } },
    ],
  ];
  renderTable(doc, CONTENT_TOP + 8, [["Income Source", "Amount"]], rows, {
    moneyCols: [1],
  });

  const y = tableBottom(doc, CONTENT_TOP + 8);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    "Enter these amounts directly into the matching sections of your tax software.",
    MARGIN_X,
    y,
  );
}

function renderBusinessByEntity(doc: jsPDF, data: TaxPrepPdfInput) {
  const rows = data.businessEntityRows ?? [];
  const body =
    rows.length === 0
      ? [[{ content: "No business entities for this period.", colSpan: 5, styles: { halign: "center", textColor: 120 } }]]
      : rows.map((r) => [
          r.entity,
          r.type ?? "—",
          fmt(r.income),
          fmt(r.expenses),
          fmt(r.net),
        ]);

  const totalIncome = rows.reduce((s, r) => s + r.income, 0);
  const totalExp = rows.reduce((s, r) => s + r.expenses, 0);
  const totalNet = totalIncome - totalExp;

  if (rows.length > 0) {
    body.push([
      { content: "Totals", colSpan: 2, styles: { fontStyle: "bold" } },
      { content: fmt(totalIncome), styles: { fontStyle: "bold", halign: "right" } },
      { content: fmt(totalExp), styles: { fontStyle: "bold", halign: "right" } },
      { content: fmt(totalNet), styles: { fontStyle: "bold", halign: "right" } },
    ] as any);
  }

  renderTable(
    doc,
    CONTENT_TOP + 8,
    [["Business", "Type", "Income", "Expenses", "Net Profit"]],
    body,
    { moneyCols: [2, 3, 4] },
  );

  const y = tableBottom(doc, CONTENT_TOP + 8);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    "Includes 1099 / Schedule C and active K-1 entities. Passive K-1 and W-2 employers are listed separately.",
    MARGIN_X,
    y,
  );
}

function renderScheduleC(doc: jsPDF, data: TaxPrepPdfInput) {
  const cats = data.business.categories.filter((c) => c.amount > 0);
  const body: any[][] = [
    [
      { content: "Gross receipts / sales", styles: { fontStyle: "bold" } },
      { content: fmt(data.business.grossReceipts), styles: { fontStyle: "bold", halign: "right" } },
    ],
    ...cats.map((c) => [c.label, fmt(c.amount)]),
    [
      { content: "Total Expenses", styles: { fontStyle: "bold" } },
      { content: fmt(data.business.totalExpenses), styles: { fontStyle: "bold", halign: "right" } },
    ],
    [
      { content: "Net Profit / Loss", styles: { fontStyle: "bold" } },
      {
        content: fmt(data.business.netProfit),
        styles: { fontStyle: "bold", halign: "right" },
      },
    ],
  ];

  renderTable(doc, CONTENT_TOP + 8, [["Schedule C Line", "Amount"]], body, {
    moneyCols: [1],
  });

  const y = tableBottom(doc, CONTENT_TOP + 8);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    "Categories follow IRS Schedule C labels — transfer values line-by-line into tax software.",
    MARGIN_X,
    y,
  );
}

function renderDeductions(doc: jsPDF, data: TaxPrepPdfInput) {
  const d = data.deductions;
  const hsaDeductible = d.hsaDeductible ?? d.hsa;
  const hsaExcess = d.hsaExcess ?? 0;
  const total = hsaDeductible + d.retirement401k + d.mileage + d.homeOffice + d.healthcare;
  const body: any[][] = [
    ["HSA Contributions (total)", fmt(d.hsa)],
  ];
  if (typeof d.hsaEmployeePayroll === "number") {
    body.push(["  Employee (payroll)", fmt(d.hsaEmployeePayroll)]);
  }
  if (typeof d.hsaEmployer === "number") {
    body.push(["  Employer contribution", fmt(d.hsaEmployer)]);
  }
  if (typeof d.hsaIndividual === "number") {
    body.push(["  Individual", fmt(d.hsaIndividual)]);
  }
  body.push([
    d.hsaLimit && d.hsaLimit > 0
      ? `HSA Deductible (limit ${fmt(d.hsaLimit)})`
      : "HSA Deductible",
    fmt(hsaDeductible),
  ]);
  if (hsaExcess > 0) {
    body.push(["HSA Excess (non-deductible)", fmt(hsaExcess)]);
  }
  body.push(
    ["401(k) / Retirement Contributions", fmt(d.retirement401k)],
    ["Mileage Deduction", fmt(d.mileage)],
    ["Home Office Deduction", fmt(d.homeOffice)],
    ["Healthcare Deduction", fmt(d.healthcare)],
    [
      { content: "Total Deductions", styles: { fontStyle: "bold" } },
      { content: fmt(total), styles: { fontStyle: "bold", halign: "right" } },
    ],
  );
  renderTable(doc, CONTENT_TOP + 8, [["Deduction", "Amount"]], body, {
    moneyCols: [1],
  });
}

function renderK1Summary(doc: jsPDF, data: TaxPrepPdfInput) {
  let y = CONTENT_TOP + 24;

  // Active K-1
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(25);
  doc.text("Active K-1 (included in Business Profit)", MARGIN_X, y);
  y += 6;

  const active = (data.businessEntityRows ?? []).filter(
    (r) => (r.type ?? "").toLowerCase().includes("k-1"),
  );
  const activeBody =
    active.length === 0
      ? [[{ content: "No active K-1 entities.", colSpan: 4, styles: { halign: "center", textColor: 120 } }]]
      : active.map((r) => [r.entity, fmt(r.income), fmt(r.expenses), fmt(r.net)]);
  renderTable(
    doc,
    y + 4,
    [["Entity", "Income", "Expenses", "Net"]],
    activeBody,
    { moneyCols: [1, 2, 3] },
  );
  y = tableBottom(doc, y + 4);

  // Passive K-1
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(25);
  doc.text("Passive K-1 (excluded from Business Profit)", MARGIN_X, y);
  y += 6;

  const passive = data.passiveK1Rows ?? [];
  const passiveBody =
    passive.length === 0
      ? [[{ content: "No passive K-1 entities.", colSpan: 2, styles: { halign: "center", textColor: 120 } }]]
      : passive.map((r) => [r.entity, fmt(r.income)]);
  renderTable(doc, y + 4, [["Entity", "Income"]], passiveBody, {
    moneyCols: [1],
  });
}

function renderQuarterly(doc: jsPDF, data: TaxPrepPdfInput) {
  const body = data.quarters.map((q) => [
    q.quarter,
    fmt(q.recommended),
    q.paid !== undefined ? fmt(q.paid) : "—",
    q.remaining !== undefined ? fmt(q.remaining) : "—",
  ]);
  renderTable(
    doc,
    CONTENT_TOP + 8,
    [["Quarter", "Recommended Payment", "Paid", "Remaining"]],
    body,
    { moneyCols: [1, 2, 3], striped: true },
  );
  let y = tableBottom(doc, CONTENT_TOP + 8);

  const totalsBody: any[][] = [
    ["Estimated Annual Tax", fmt(data.tax.totalLiability)],
    ["Taxes Already Withheld", fmt(data.tax.withheld)],
    ["Taxes Saved (Reserve)", fmt(data.tax.reserveSaved)],
    ["Quarterly Payments Made", fmt(data.tax.paymentsMade)],
    [
      { content: "Remaining Liability", styles: { fontStyle: "bold" } },
      { content: fmt(data.tax.remaining), styles: { fontStyle: "bold", halign: "right" } },
    ],
  ];
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(25);
  doc.text("Annual Totals", MARGIN_X, y + 8);
  renderTable(doc, y + 14, [["Item", "Amount"]], totalsBody, { moneyCols: [1] });
}

function renderAppendix(doc: jsPDF, data: TaxPrepPdfInput, generatedAt: string) {
  const txs = data.transactions ?? [];
  if (txs.length === 0) return;

  doc.addPage();
  drawPageChrome(doc, data, generatedAt, "Appendix — Transaction Detail");

  let y = CONTENT_TOP + 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `${txs.length} transactions for tax year ${data.taxYear}, grouped by entity and category.`,
    MARGIN_X,
    y,
  );
  y += 14;

  // Group by entity → (income source OR expense category)
  const byEntity = new Map<string, TransactionRow[]>();
  for (const t of txs) {
    const key = t.entity || "Unassigned";
    const list = byEntity.get(key) ?? [];
    list.push(t);
    byEntity.set(key, list);
  }

  const sortedEntities = [...byEntity.keys()].sort();
  for (const entity of sortedEntities) {
    const rows = byEntity.get(entity)!;
    const expenses = rows.filter((r) => r.type === "expense");
    const income = rows.filter((r) => r.type === "income");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(25);
    if (y > FOOTER_Y - 60) {
      doc.addPage();
      drawPageChrome(doc, data, generatedAt, "Appendix — Transaction Detail");
      y = CONTENT_TOP + 8;
    }
    doc.text(entity, MARGIN_X, y);
    y += 4;

    const groupAndRender = (
      title: string,
      list: TransactionRow[],
      groupKey: (t: TransactionRow) => string,
    ) => {
      if (list.length === 0) return;
      const groups = new Map<string, TransactionRow[]>();
      for (const t of list) {
        const k = groupKey(t) || "Uncategorized";
        const g = groups.get(k) ?? [];
        g.push(t);
        groups.set(k, g);
      }
      const sortedGroups = [...groups.keys()].sort();

      const body: any[][] = [];
      for (const g of sortedGroups) {
        body.push([
          {
            content: `${title}: ${g}`,
            colSpan: 4,
            styles: { fontStyle: "bold", fillColor: [245, 247, 250] },
          },
        ]);
        let groupTotal = 0;
        const items = groups.get(g)!.sort((a, b) => a.date.localeCompare(b.date));
        for (const t of items) {
          body.push([t.date, t.vendor, t.category, fmt(t.amount)]);
          groupTotal += t.amount;
        }
        body.push([
          { content: "Subtotal", colSpan: 3, styles: { fontStyle: "bold", halign: "right" } },
          { content: fmt(groupTotal), styles: { fontStyle: "bold", halign: "right" } },
        ]);
      }

      autoTable(doc, {
        startY: y + 4,
        head: [["Date", "Description", "Category", "Amount"]],
        body,
        theme: "grid",
        headStyles: { fillColor: [235, 238, 245], textColor: 30, fontSize: 8 },
        styles: { fontSize: 8, cellPadding: 4 },
        columnStyles: { 3: { halign: "right" } },
        margin: { left: MARGIN_X, right: MARGIN_X },
      });
      y = tableBottom(doc, y + 4);
    };

    groupAndRender("Income source", income, (t) => t.category);
    groupAndRender("Expense category", expenses, (t) => t.category);

    y += 6;
  }
}

function renderWorksheetForEntity(doc: jsPDF, w: BusinessWorksheet) {
  const isK1 = (w.type ?? "").toLowerCase().includes("k-1");
  const incomeLabel = isK1 ? "Active K-1 Income" : "Gross receipts / sales";
  const cats = w.categories.filter((c) => c.amount > 0);
  const body: any[][] = [
    [
      { content: incomeLabel, styles: { fontStyle: "bold" } },
      { content: fmt(w.grossReceipts), styles: { fontStyle: "bold", halign: "right" } },
    ],
    ...(cats.length === 0
      ? [[{ content: "No expenses recorded for this entity.", colSpan: 2, styles: { halign: "center", textColor: 120 } }]]
      : cats.map((c) => [c.label, fmt(c.amount)])),
    [
      { content: "Total Expenses", styles: { fontStyle: "bold" } },
      { content: fmt(w.totalExpenses), styles: { fontStyle: "bold", halign: "right" } },
    ],
    [
      { content: "Net Profit / Loss", styles: { fontStyle: "bold" } },
      { content: fmt(w.netProfit), styles: { fontStyle: "bold", halign: "right" } },
    ],
  ];

  // Header line
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(25);
  doc.text(w.entity, MARGIN_X, CONTENT_TOP + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110);
  doc.text(
    `${isK1 ? "Active K-1 Expense Summary" : "Schedule C Worksheet"} · ${w.type ?? "—"}`,
    MARGIN_X,
    CONTENT_TOP + 18,
  );

  renderTable(
    doc,
    CONTENT_TOP + 28,
    [[isK1 ? "Active K-1 Line" : "Schedule C Line", "Amount"]],
    body,
    { moneyCols: [1] },
  );
}

// ─────────────────────────────────────────────────────────── Main ────

export function exportTaxPrepPdf(data: TaxPrepPdfInput): TaxPrepPdfResult {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const generatedAt = data.generatedAt ?? new Date();
  const exportId = data.exportId ?? generateExportId();
  const generatedAtLabel = generatedAt.toLocaleString();

  const pages: Array<{ title: string; render: () => void }> = [
    { title: "Tax Preparation Summary", render: () => renderSummaryCards(doc, data) },
    { title: "Income Summary", render: () => renderIncomeSummary(doc, data) },
    { title: "Business Summary by Entity", render: () => renderBusinessByEntity(doc, data) },
    { title: "Schedule C — Combined Expense Breakdown", render: () => renderScheduleC(doc, data) },
  ];

  // Per-entity worksheet pages (one per 1099 / active K-1 business).
  const worksheets = data.businessWorksheets ?? [];
  if (worksheets.length > 0) {
    pages.push({
      title: "Business Worksheets by Entity",
      render: () => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(80);
        doc.text(
          `${worksheets.length} business ${worksheets.length === 1 ? "entity" : "entities"} — one worksheet per business follows.`,
          MARGIN_X,
          CONTENT_TOP + 8,
        );
        const list = worksheets.map((w, i) => `${i + 1}. ${w.entity}  (${w.type ?? "—"})`);
        list.forEach((line, i) => {
          doc.setFontSize(10);
          doc.setTextColor(40);
          doc.text(line, MARGIN_X, CONTENT_TOP + 36 + i * 16);
        });
      },
    });
    worksheets.forEach((w) => {
      pages.push({
        title: (w.type ?? "").toLowerCase().includes("k-1")
          ? `Active K-1 Worksheet — ${w.entity}`
          : `Schedule C Worksheet — ${w.entity}`,
        render: () => renderWorksheetForEntity(doc, w),
      });
    });
  }

  pages.push(
    { title: "Deductions Summary", render: () => renderDeductions(doc, data) },
    { title: "K-1 Summary", render: () => renderK1Summary(doc, data) },
    { title: "Quarterly Tax Planning", render: () => renderQuarterly(doc, data) },
  );

  pages.forEach((p, i) => {
    if (i > 0) doc.addPage();
    drawPageChrome(doc, data, generatedAtLabel, p.title);
    p.render();
  });

  if (data.includeAppendix && data.transactions && data.transactions.length > 0) {
    renderAppendix(doc, data, generatedAtLabel);
  }

  stampFooters(doc, { generatedAtLabel, exportId, taxYear: data.taxYear });

  const filename = `PaycheckMD-Tax-Prep-${data.taxYear}-${formatFilenameStamp(
    generatedAt,
  )}-${exportId}.pdf`;

  // Generate a fresh Blob + object URL for this export, trigger the
  // download, then revoke the URL so no prior blob/URL can be reused.
  try {
    const blob: Blob = doc.output("blob") as Blob;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke on the next tick so the browser has committed the download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch {
    // Fallback for non-browser environments (tests / SSR).
    doc.save(filename);
  }

  return { filename, exportId, generatedAt };
}
