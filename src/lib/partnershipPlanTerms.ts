/**
 * Partnership-sponsored retirement plan terms (e.g. a K-1 physician group's
 * 401(k)). Stored per company in
 * `companies.advanced_field_visibility.partnership_plan_terms`.
 *
 * Metadata only: these answers decide which follow-up the retirement planner
 * shows. They never create eligible compensation, never override IRS limits,
 * and never turn a conditional earnings-based estimate into confirmed room.
 */
export const PARTNERSHIP_PLAN_TERMS_KEY = "partnership_plan_terms";

export type PlanSponsorship = "partnership" | "independent" | "not_sure";
export type EmployeeDeferralPermission = "permitted" | "not_permitted" | "not_sure";
export type EmployerContributionPermission = "permitted" | "partnership_determined" | "not_permitted" | "not_sure";

export interface PartnershipPlanTerms {
  sponsorship: PlanSponsorship;
  additionalEmployeeDeferrals: EmployeeDeferralPermission;
  additionalEmployerContributions: EmployerContributionPermission;
  /** Optional plan-document ceiling for the partner's employer/discretionary money. */
  planCeiling: number | null;
}

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T => (allowed.includes(v as T) ? (v as T) : ("not_sure" as T));

export function readPartnershipPlanTerms(meta: unknown): PartnershipPlanTerms | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>)[PARTNERSHIP_PLAN_TERMS_KEY];
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const ceiling = Number(r.planCeiling);
  return {
    sponsorship: pick(r.sponsorship, ["partnership", "independent", "not_sure"] as const),
    additionalEmployeeDeferrals: pick(r.additionalEmployeeDeferrals, ["permitted", "not_permitted", "not_sure"] as const),
    additionalEmployerContributions: pick(r.additionalEmployerContributions, ["permitted", "partnership_determined", "not_permitted", "not_sure"] as const),
    planCeiling: r.planCeiling != null && Number.isFinite(ceiling) && ceiling > 0 ? ceiling : null,
  };
}

export function writePartnershipPlanTerms<T extends object>(meta: T | null | undefined, terms: PartnershipPlanTerms | null): T {
  const next = { ...(meta ?? {}) } as Record<string, unknown>;
  if (terms) next[PARTNERSHIP_PLAN_TERMS_KEY] = { ...terms };
  else delete next[PARTNERSHIP_PLAN_TERMS_KEY];
  return next as T;
}

/** True when every answer is known (no "Not sure"). */
export function partnershipTermsComplete(t: PartnershipPlanTerms | null): boolean {
  return !!t && t.sponsorship !== "not_sure" && t.additionalEmployeeDeferrals !== "not_sure" && t.additionalEmployerContributions !== "not_sure";
}

/** Short display summary for the planner card. */
export function partnershipTermsSummary(t: PartnershipPlanTerms): string {
  const s = { partnership: "Partnership-sponsored", independent: "Independently maintained", not_sure: "Sponsor not sure" }[t.sponsorship];
  const e = { permitted: "extra deferrals permitted", not_permitted: "no extra deferrals", not_sure: "extra deferrals not sure" }[t.additionalEmployeeDeferrals];
  const r = { permitted: "employer contributions permitted", partnership_determined: "employer contributions set by partnership", not_permitted: "no extra employer contributions", not_sure: "employer contributions not sure" }[t.additionalEmployerContributions];
  return `${s} · ${e} · ${r}`;
}
