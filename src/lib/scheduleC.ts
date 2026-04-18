/**
 * IRS Schedule C expense category catalog + a best-effort mapper
 * from free-text categories already in the app.
 */

export type ScheduleCCategory =
  | "advertising"
  | "car_truck"
  | "contract_labor"
  | "depreciation"
  | "insurance"
  | "interest"
  | "legal_professional"
  | "office"
  | "rent_lease"
  | "repairs"
  | "supplies"
  | "taxes_licenses"
  | "travel"
  | "meals"
  | "utilities"
  | "wages"
  | "other";

export interface ScheduleCMeta {
  value: ScheduleCCategory;
  label: string;
  /** Plain-English helper for the dropdown */
  description?: string;
}

export const SCHEDULE_C_CATEGORIES: ScheduleCMeta[] = [
  { value: "advertising", label: "Advertising", description: "Marketing, ads, website" },
  { value: "car_truck", label: "Car and truck", description: "Vehicle expenses, mileage" },
  { value: "contract_labor", label: "Contract labor", description: "1099 contractors, freelancers" },
  { value: "depreciation", label: "Depreciation", description: "Equipment depreciation" },
  { value: "insurance", label: "Insurance", description: "Business insurance (not health)" },
  { value: "interest", label: "Interest", description: "Loan and credit interest" },
  { value: "legal_professional", label: "Legal and professional fees", description: "Lawyers, accountants, consultants" },
  { value: "office", label: "Office expense", description: "Office supplies, software, subscriptions" },
  { value: "rent_lease", label: "Rent or lease", description: "Office, equipment rent" },
  { value: "repairs", label: "Repairs and maintenance" },
  { value: "supplies", label: "Supplies", description: "Materials used in your business" },
  { value: "taxes_licenses", label: "Taxes and licenses", description: "Business taxes, permits" },
  { value: "travel", label: "Travel", description: "Lodging, flights, transportation" },
  { value: "meals", label: "Meals", description: "Business meals (50% deductible)" },
  { value: "utilities", label: "Utilities", description: "Phone, internet, electricity" },
  { value: "wages", label: "Wages", description: "Employee wages (not contractors)" },
  { value: "other", label: "Other expenses", description: "Anything that doesn't fit above" },
];

const META = new Map(SCHEDULE_C_CATEGORIES.map((c) => [c.value, c]));

export function getScheduleCMeta(value: string | null | undefined): ScheduleCMeta {
  if (value && META.has(value as ScheduleCCategory)) return META.get(value as ScheduleCCategory)!;
  return META.get("other")!;
}

/**
 * Best-effort mapper from a free-text category string to a Schedule C bucket.
 * Used for transactions that haven't been explicitly classified yet.
 */
export function mapToScheduleC(raw: string | null | undefined): ScheduleCCategory {
  if (!raw) return "other";
  const v = raw.toLowerCase().trim();

  if (/(ad|advertis|market|promo|seo|google ads|facebook ads)/.test(v)) return "advertising";
  if (/(car|truck|vehicle|gas|fuel|mileage|uber|lyft|parking|toll|auto)/.test(v)) return "car_truck";
  if (/(contractor|contract labor|1099|freelance|subcontract)/.test(v)) return "contract_labor";
  if (/(depreciation|amortization)/.test(v)) return "depreciation";
  if (/(insurance|liability|malpractice)/.test(v)) return "insurance";
  if (/(interest|loan)/.test(v)) return "interest";
  if (/(legal|attorney|lawyer|accountant|cpa|professional|consult|bookkeep)/.test(v)) return "legal_professional";
  if (/(office|software|subscription|saas|app|computer|laptop|printer|stationery)/.test(v)) return "office";
  if (/(rent|lease)/.test(v)) return "rent_lease";
  if (/(repair|maintenance|fix)/.test(v)) return "repairs";
  if (/(supply|supplies|material)/.test(v)) return "supplies";
  if (/(tax|license|permit|registration|fee)/.test(v)) return "taxes_licenses";
  if (/(travel|flight|airfare|hotel|lodging|airbnb)/.test(v)) return "travel";
  if (/(meal|food|restaurant|dining|coffee|lunch|dinner)/.test(v)) return "meals";
  if (/(utility|utilities|phone|internet|electric|water|cell)/.test(v)) return "utilities";
  if (/(wage|salary|payroll|employee)/.test(v)) return "wages";

  return "other";
}
