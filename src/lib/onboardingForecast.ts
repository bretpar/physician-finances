import { buildOnboardingIncomePlan, readOnboardingPlanMeta } from "@/lib/onboardingIncomePlan";
import { normalizeFilingType } from "@/lib/filingTypes";
import { isSETaxableEntity } from "@/lib/k1TaxTreatment";
import type { ProjectedIncomeStream, ProjectedPaycheck } from "@/hooks/useProjectedIncome";

interface Company {
  id: string; name: string; companyType: string; projectedAnnualGross?: number | null;
  payFrequency?: string | null; advancedFieldVisibility?: unknown; includeInTax?: boolean;
  k1TaxTreatment?: string | null; includeSETaxInRecommendation?: boolean;
}
interface CountedIncome { source_id?: string | null; company?: string | null; vendor?: string | null; date: string; gross: number }
export interface OnboardingForecastRow {
  companyId: string; companyName: string; bucket: "w2" | "se"; recorded: number;
  historical: number; planned: number; total: number; userYtd: boolean;
}
const norm = (s?: string | null) => String(s || "").trim().toLowerCase();
const cents = (n: number) => Math.round(n * 100) / 100;

/** Detailed YTD is a baseline, not an amount to add to simplified YTD. */
export function onboardingYtdBaseline(simplified: number | null | undefined, detailed: number[]) {
  return detailed.length ? Math.max(0, ...detailed) : simplified ?? null;
}

/** Receives only the annual engine's counted records and generated occurrences. */
export function buildOnboardingForecast(args: {
  companies: Company[]; streams: ProjectedIncomeStream[]; paychecks: ProjectedPaycheck[];
  countedIncome: CountedIncome[]; catchups: Array<{ companyId: string; date: string; gross: number }>;
  taxYear: number;
}): OnboardingForecastRow[] {
  const rows: OnboardingForecastRow[] = [];
  for (const c of args.companies) {
    const meta = readOnboardingPlanMeta(c.advancedFieldVisibility);
    const annual = Number(c.projectedAnnualGross) || 0;
    if (!meta || meta.taxYear !== args.taxYear || annual <= 0 || c.includeInTax === false) continue;
    const filing = normalizeFilingType(c.companyType);
    const w2 = filing === "w2" || filing === "scorp_w2";
    // Passive/non-SE K-1 is deliberately deferred: projectedOtherIncome does
    // not provide a separate, safe business-only residual bucket.
    if (!w2 && !isSETaxableEntity({ filingType: filing, k1TaxTreatment: c.k1TaxTreatment as any, includeSETaxInRecommendation: c.includeSETaxInRecommendation })) continue;
    if (!w2 && filing !== "1099_schedule_c" && filing !== "k1_partnership") continue;
    let provenance = meta.originalPlan;
    if (!provenance) {
      // Legacy onboarding metadata: prove the original schedule and amount.
      // Changed/deleted/ambiguous legacy streams get no inferred history.
      const candidates = args.streams.filter((s) => s.source_id === c.id && s.notes === "Estimated from your expected annual income during setup.");
      if (candidates.length !== 1) continue;
      const s = candidates[0];
      const plan = buildOnboardingIncomePlan({ annual: meta.annual, ytd: meta.ytdEntered, payFrequency: w2 ? c.payFrequency : null, today: s.created_at.slice(0, 10) });
      if (!plan || s.start_date !== plan.startDate || s.end_date !== plan.endDate || s.pay_frequency !== plan.plannerFrequency || s.custom_interval_days !== plan.customIntervalDays || Number(s.paycheck_amount) !== plan.perOccurrence) continue;
      provenance = { streamId: s.id, startDate: plan.startDate, historicalGross: Math.max(0, meta.annual - plan.plannedRemaining) };
    }
    if (!Number.isFinite(provenance.historicalGross) || !provenance.startDate.startsWith(String(args.taxYear))) continue;
    const named = args.companies.filter((co) => norm(co.name) === norm(c.name)).length === 1;
    const actuals = args.countedIncome.filter((e) => e.date.startsWith(String(args.taxYear)) &&
      (e.source_id ? e.source_id === c.id : named && norm(e.company || e.vendor) === norm(c.name)));
    const catchups = args.catchups.filter((e) => e.companyId === c.id);
    const recorded = cents(actuals.reduce((sum, e) => sum + e.gross, 0) + catchups.reduce((sum, e) => sum + e.gross, 0));
    const historicalActual = actuals.filter((e) => e.date < provenance.startDate).reduce((sum, e) => sum + e.gross, 0)
      + catchups.filter((e) => e.date < provenance.startDate).reduce((sum, e) => sum + e.gross, 0);
    const sourceStreams = new Set(args.streams.filter((s) => s.source_id === c.id).map((s) => s.id));
    const planned = cents(args.paychecks.filter((p) => sourceStreams.has(p.streamId) && p.matchStatus === "active").reduce((sum, p) => sum + p.grossAmount, 0));
    // A fixed original historical ceiling prevents edited/deleted future pay
    // from becoming new historical income. Converted future actuals do not
    // consume historical income, but all counted income caps the annual target.
    const historical = cents(Math.max(0, Math.min(annual - recorded - planned, provenance.historicalGross - historicalActual)));
    rows.push({ companyId: c.id, companyName: c.name, bucket: w2 ? "w2" : "se", recorded, planned, historical,
      total: cents(recorded + historical + planned), userYtd: meta.ytdEntered != null });
  }
  return rows;
}