/**
 * Shared reporting aggregation helpers.
 *
 * Single source of truth for which companies count as "business reporting"
 * entities in the Reports page (Annual Tax Summary, Profit & Loss, Schedule C
 * worksheet, CSV / Tax Prep PDF exports).
 *
 * Rules:
 *   - 1099 / Schedule C            → business reporting
 *   - Active K-1 (active_partnership, guaranteed_payments, or unset default)
 *                                  → business reporting (income + expenses
 *                                    grouped with the same company)
 *   - Passive K-1 / S-corp distribution → NOT business reporting; shown
 *     separately as passive income.
 *   - W-2 (any flavor)             → NOT business reporting
 *   - other / unknown              → NOT business reporting
 */
import type { Company } from "@/contexts/CompanyContext";
import { K1_TAX_TREATMENT_DEFAULT } from "@/lib/k1TaxTreatment";

const ACTIVE_K1_TREATMENTS = new Set<string>([
  "active_partnership",
  "guaranteed_payments",
]);

const PASSIVE_K1_TREATMENTS = new Set<string>([
  "passive",
  "scorp_distribution",
]);

/** Treat null/unset K-1 treatment as the app-wide default (active). */
function effectiveK1Treatment(company: Pick<Company, "k1TaxTreatment">): string {
  return (company.k1TaxTreatment ?? K1_TAX_TREATMENT_DEFAULT) as string;
}

/** True if income/expenses for this company should flow into business reports. */
export function isBusinessReportingCompany(
  company: Pick<Company, "companyType" | "k1TaxTreatment"> | null | undefined,
): boolean {
  if (!company) return false;
  if (company.companyType === "1099_schedule_c") return true;
  if (company.companyType === "k1_partnership") {
    return ACTIVE_K1_TREATMENTS.has(effectiveK1Treatment(company));
  }
  return false;
}

/** True if this company is a K-1 entity that is passive (not business). */
export function isPassiveK1Company(
  company: Pick<Company, "companyType" | "k1TaxTreatment"> | null | undefined,
): boolean {
  if (!company) return false;
  if (company.companyType !== "k1_partnership") return false;
  return PASSIVE_K1_TREATMENTS.has(effectiveK1Treatment(company));
}

/** True if this company is an active K-1 (subset of business reporting). */
export function isActiveK1Company(
  company: Pick<Company, "companyType" | "k1TaxTreatment"> | null | undefined,
): boolean {
  if (!company) return false;
  if (company.companyType !== "k1_partnership") return false;
  return ACTIVE_K1_TREATMENTS.has(effectiveK1Treatment(company));
}

/** Set of company names that count as business reporting entities. */
export function getBusinessReportingCompanyNames(
  companies: ReadonlyArray<Pick<Company, "name" | "companyType" | "k1TaxTreatment">>,
): Set<string> {
  const out = new Set<string>();
  for (const c of companies) {
    if (isBusinessReportingCompany(c)) out.add(c.name);
  }
  return out;
}

/** Set of company names that are passive K-1 entities. */
export function getPassiveK1CompanyNames(
  companies: ReadonlyArray<Pick<Company, "name" | "companyType" | "k1TaxTreatment">>,
): Set<string> {
  const out = new Set<string>();
  for (const c of companies) {
    if (isPassiveK1Company(c)) out.add(c.name);
  }
  return out;
}
