/**
 * Shared reporting aggregation helpers.
 *
 * Single source of truth for which companies count as "business reporting"
 * entities in the Reports page (Annual Tax Summary, Profit & Loss, Schedule C
 * worksheet, CSV / Tax Prep PDF exports).
 *
 * Rules:
 *   - 1099 / Schedule C            → business reporting
 *   - Active K-1 (active_partnership, guaranteed_payments)
 *                                  → business reporting
 *   - Passive K-1 / S-corp distribution → NOT business reporting; shown
 *     separately as passive income.
 *   - W-2 (any flavor)             → NOT business reporting
 *   - other / unknown              → NOT business reporting
 *
 * K-1 classification fallback:
 *   When `k1TaxTreatment` is null/unset (e.g. companies created before the
 *   field existed, or onboarding stored only the SE flag), fall back to
 *   `includeSETaxInRecommendation`:
 *     - true  → active K-1
 *     - false → passive K-1
 *   This keeps Reports correct without requiring a backfill migration.
 */
import type { Company } from "@/contexts/CompanyContext";

type K1ClassifyInput = Pick<
  Company,
  "companyType" | "k1TaxTreatment" | "includeSETaxInRecommendation"
>;

const ACTIVE_K1_TREATMENTS = new Set<string>([
  "active_partnership",
  "guaranteed_payments",
]);

const PASSIVE_K1_TREATMENTS = new Set<string>([
  "passive",
  "scorp_distribution",
]);

/**
 * Resolve a K-1 company to "active" | "passive". Treatment field wins when
 * set; otherwise fall back to the SE-tax flag (true = active, false = passive).
 */
function classifyK1(company: K1ClassifyInput): "active" | "passive" {
  const t = company.k1TaxTreatment;
  if (t && ACTIVE_K1_TREATMENTS.has(t)) return "active";
  if (t && PASSIVE_K1_TREATMENTS.has(t)) return "passive";
  // Fallback: onboarding may have stored only the SE-tax flag.
  return company.includeSETaxInRecommendation === false ? "passive" : "active";
}

/** True if income/expenses for this company should flow into business reports. */
export function isBusinessReportingCompany(
  company: K1ClassifyInput | null | undefined,
): boolean {
  if (!company) return false;
  if (company.companyType === "1099_schedule_c") return true;
  if (company.companyType === "k1_partnership") {
    return classifyK1(company) === "active";
  }
  return false;
}

/** True if this company is a K-1 entity that is passive (not business). */
export function isPassiveK1Company(
  company: K1ClassifyInput | null | undefined,
): boolean {
  if (!company) return false;
  if (company.companyType !== "k1_partnership") return false;
  return classifyK1(company) === "passive";
}

/** True if this company is an active K-1 (subset of business reporting). */
export function isActiveK1Company(
  company: K1ClassifyInput | null | undefined,
): boolean {
  if (!company) return false;
  if (company.companyType !== "k1_partnership") return false;
  return classifyK1(company) === "active";
}

/** Set of company names that count as business reporting entities. */
export function getBusinessReportingCompanyNames(
  companies: ReadonlyArray<
    Pick<Company, "name" | "companyType" | "k1TaxTreatment" | "includeSETaxInRecommendation">
  >,
): Set<string> {
  const out = new Set<string>();
  for (const c of companies) {
    if (isBusinessReportingCompany(c)) out.add(c.name);
  }
  return out;
}

/** Set of company names that are passive K-1 entities. */
export function getPassiveK1CompanyNames(
  companies: ReadonlyArray<
    Pick<Company, "name" | "companyType" | "k1TaxTreatment" | "includeSETaxInRecommendation">
  >,
): Set<string> {
  const out = new Set<string>();
  for (const c of companies) {
    if (isPassiveK1Company(c)) out.add(c.name);
  }
  return out;
}
