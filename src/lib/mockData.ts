export type Transaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  account: string;
  entity: string; // company name or "Unassigned"
  companyType?: "1099" | "W2" | "K1";
  deductible: boolean;
  memo: string;
  type: "income" | "expense";
  taxWithheld?: number;
};

export const expenseCategories = [
  "Uncategorized",
  "Meals",
  "Travel",
  "Software / Subscriptions",
  "Medical Equipment",
  "CME / Education",
  "Vehicle / Mileage",
  "Home Office",
  "Supplies",
  "Insurance",
  "Professional Fees",
  "Personal",
];

export const incomeCategories = [
  "1099 Income",
  "K-1 Income",
  "Side Business Income",
  "W-2 Income",
  "Other Income",
];

export const categories = [...expenseCategories, ...incomeCategories];

// Personal category is excluded from business calculations
export const PERSONAL_CATEGORY = "Personal";

export const accounts = [
  "Chase Business Checking",
  "Chase Savings",
  "Amex Business Platinum",
  "Capital One Venture",
];

export const entities = [
  "Medical Practice LLC",
  "Consulting PLLC",
  "Personal",
];

export const mockTransactions: Transaction[] = [
  { id: "1", date: "2026-04-07", merchant: "Hospital System A", amount: 18500, category: "1099 Income", account: "Chase Business Checking", entity: "Medical Practice LLC", deductible: false, memo: "March billing", type: "income" },
  { id: "2", date: "2026-04-05", merchant: "Investment Partnership", amount: 4200, category: "K-1 Income", account: "Chase Business Checking", entity: "Consulting PLLC", deductible: false, memo: "Q1 distribution", type: "income" },
  { id: "3", date: "2026-04-04", merchant: "Telehealth Platform Inc", amount: 3100, category: "Side Business Income", account: "Chase Business Checking", entity: "Consulting PLLC", deductible: false, memo: "March consultations", type: "income" },
  { id: "w2-1", date: "2026-04-01", merchant: "Regional Medical Center", amount: 12000, category: "W-2 Income", account: "Chase Business Checking", entity: "Personal", deductible: false, memo: "Bi-weekly paycheck", type: "income", taxWithheld: 3200 },
  { id: "w2-2", date: "2026-04-15", merchant: "Regional Medical Center", amount: 12000, category: "W-2 Income", account: "Chase Business Checking", entity: "Personal", deductible: false, memo: "Bi-weekly paycheck", type: "income", taxWithheld: 3200 },
  { id: "4", date: "2026-04-06", merchant: "Delta Airlines", amount: -487.50, category: "Travel", account: "Amex Business Platinum", entity: "Medical Practice LLC", deductible: true, memo: "CME conference flight", type: "expense" },
  { id: "5", date: "2026-04-05", merchant: "Marriott Hotels", amount: -312.00, category: "Travel", account: "Amex Business Platinum", entity: "Medical Practice LLC", deductible: true, memo: "Conference hotel", type: "expense" },
  { id: "6", date: "2026-04-04", merchant: "UpToDate Subscription", amount: -519.00, category: "Software / Subscriptions", account: "Chase Business Checking", entity: "Medical Practice LLC", deductible: true, memo: "Annual renewal", type: "expense" },
  { id: "7", date: "2026-04-03", merchant: "Stryker Medical", amount: -2340.00, category: "Medical Equipment", account: "Chase Business Checking", entity: "Medical Practice LLC", deductible: true, memo: "Surgical instruments", type: "expense" },
  { id: "8", date: "2026-04-02", merchant: "AMA CME Course", amount: -895.00, category: "CME / Education", account: "Capital One Venture", entity: "Medical Practice LLC", deductible: true, memo: "Board review course", type: "expense" },
  { id: "9", date: "2026-04-01", merchant: "NORCAL Insurance", amount: -1850.00, category: "Insurance", account: "Chase Business Checking", entity: "Medical Practice LLC", deductible: true, memo: "Monthly premium", type: "expense" },
  { id: "10", date: "2026-04-01", merchant: "Whole Foods Market", amount: -67.30, category: "Meals", account: "Amex Business Platinum", entity: "Medical Practice LLC", deductible: true, memo: "Staff lunch meeting", type: "expense" },
  { id: "11", date: "2026-03-31", merchant: "Shell Gas Station", amount: -54.20, category: "Vehicle / Mileage", account: "Capital One Venture", entity: "Medical Practice LLC", deductible: true, memo: "Hospital commute fuel", type: "expense" },
  { id: "12", date: "2026-03-30", merchant: "Amazon Business", amount: -189.00, category: "Supplies", account: "Amex Business Platinum", entity: "Medical Practice LLC", deductible: true, memo: "Office supplies", type: "expense" },
];

export function getSummary(transactions: Transaction[]) {
  const now = new Date();
  const thisMonth = transactions.filter((t) => {
    const d = new Date(t.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  const totalIncome = thisMonth.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0);
  const totalExpenses = Math.abs(thisMonth.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));

  // W-2 specific
  const w2Income = thisMonth.filter((t) => t.category === "W-2 Income").reduce((s, t) => s + t.amount, 0);
  const w2Withheld = thisMonth.filter((t) => t.category === "W-2 Income").reduce((s, t) => s + (t.taxWithheld || 0), 0);

  // Non-W-2 (self-employment) income
  const selfEmploymentIncome = thisMonth
    .filter((t) => t.type === "income" && t.category !== "W-2 Income")
    .reduce((s, t) => s + t.amount, 0);

  const netProfit = totalIncome - totalExpenses;
  const selfEmploymentProfit = selfEmploymentIncome - totalExpenses;

  const federalRate = 0.32;
  const seRate = 0.153;
  const bnoRate = 0.015;

  // Federal tax on ALL income (including W-2)
  const estimatedTax = netProfit * federalRate;
  // SE tax only on self-employment profit
  const seTax = Math.max(0, selfEmploymentProfit) * seRate * 0.9235;
  // B&O tax only on non-W-2 business income
  const bnoTax = selfEmploymentIncome * bnoRate;

  const totalTaxLiability = estimatedTax + seTax + bnoTax;
  const remainingLiability = Math.max(0, totalTaxLiability - w2Withheld);
  const quarterlyEstimate = remainingLiability / 4;

  return {
    totalIncome,
    totalExpenses,
    netProfit,
    estimatedTax,
    seTax,
    quarterlyEstimate,
    bnoTax,
    w2Income,
    w2Withheld,
    selfEmploymentIncome,
    selfEmploymentProfit,
    totalTaxLiability,
    remainingLiability,
  };
}
