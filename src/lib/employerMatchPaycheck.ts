/**
 * Per-paycheck employer match estimates from the company's saved
 * employer_contribution_formula (src/lib/employerContributionFormula.ts).
 *
 * - match / tiered: applied to THIS paycheck's gross and employee deferral
 *   (per-pay-period matching), so changing the deferral recomputes the match.
 * - flat annual: never spread per paycheck (deposit cadence is unknown); it
 *   stays an annual estimate in the Retirement Planner only.
 * Only W-2 / S-corp W-2 employers; K-1 and Schedule C plans are never touched.
 * Estimates are display/projection values and never edit saved records.
 */
import { estimateEmployerContribution, readEmployerContributionFormula, type EmployerContributionFormula } from "@/lib/employerContributionFormula";
import { normalizeFilingType } from "@/lib/filingTypes";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function isPerPaycheckFormula(f: EmployerContributionFormula | null | undefined): f is Exclude<EmployerContributionFormula, { kind: "flat" }> {
  return !!f && (f.kind === "match" || f.kind === "tiered");
}

/** Employer match for one paycheck, or null when no per-paycheck estimate applies. */
export function estimatePaycheckEmployerMatch(
  formula: EmployerContributionFormula | null | undefined,
  gross: number,
  employeeDeferral: number,
): number | null {
  if (!isPerPaycheckFormula(formula)) return null;
  if (!(gross > 0)) return null;
  return round2(estimateEmployerContribution(formula, gross, employeeDeferral));
}

export function isW2CompanyType(companyType: string | null | undefined): boolean {
  const ft = normalizeFilingType(companyType);
  return ft === "w2" || ft === "scorp_w2";
}

/** Per-paycheck formula for a company, or null (non-W-2, flat, or none). */
export function paycheckFormulaForCompany(company: { companyType?: string | null; advancedFieldVisibility?: unknown } | null | undefined) {
  if (!company || !isW2CompanyType(company.companyType)) return null;
  const f = readEmployerContributionFormula(company.advancedFieldVisibility);
  return isPerPaycheckFormula(f) ? f : null;
}

/** streamId → per-paycheck employer formula (W-2 streams only). */
export function employerMatchFormulaByStream(
  streams: Array<{ id: string; source_id?: string | null }>,
  companies: Array<{ id: string; companyType?: string | null; advancedFieldVisibility?: unknown }>,
): Record<string, EmployerContributionFormula> {
  const out: Record<string, EmployerContributionFormula> = {};
  for (const s of streams) {
    const f = paycheckFormulaForCompany(s.source_id ? companies.find((c) => c.id === s.source_id) : null);
    if (f) out[s.id] = f;
  }
  return out;
}

export type EmployerAmountMode = "auto" | "manual";

/**
 * Paycheck-form precedence: an explicit / saved amount (manual mode) always
 * wins; otherwise the formula estimate; otherwise leave the field as is.
 */
export function resolvePaycheckEmployerAmount(args: {
  mode: EmployerAmountMode;
  current: string;
  formula: EmployerContributionFormula | null;
  gross: number;
  employeeDeferral: number;
}): string {
  if (args.mode === "manual") return args.current;
  const est = estimatePaycheckEmployerMatch(args.formula, args.gross, args.employeeDeferral);
  return est == null ? args.current : est > 0 ? String(est) : "";
}
