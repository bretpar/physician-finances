import type { EmployerW4Recommendation } from "@/lib/w4CurrentWithholding";

type SummaryRecommendation = Pick<
  EmployerW4Recommendation,
  "row" | "change"
>;

export type W4SummaryPresentation =
  | {
      kind: "per_paycheck";
      amount: number;
      employerName: string | null;
    }
  | { kind: "review" }
  | {
      kind: "annual_fallback";
      amount: number;
    };

/**
 * Selects presentation values from the canonical per-employer W-4 output.
 * This intentionally performs no tax or allocation math.
 */
export function selectW4SummaryPresentation(
  recommendations: SummaryRecommendation[],
  remainingAnnualTax: number,
): W4SummaryPresentation {
  const active = recommendations.filter(
    (recommendation) =>
      Number(recommendation.row.remainingPaychecks) > 0 &&
      Number.isFinite(recommendation.change.recommendedExtraPerPaycheck),
  );

  if (active.length === 1) {
    const recommendation = active[0];
    const employerName = recommendation.row.company?.trim() || null;
    return {
      kind: "per_paycheck",
      amount: recommendation.change.recommendedExtraPerPaycheck,
      employerName,
    };
  }

  if (active.length > 1) return { kind: "review" };

  return {
    kind: "annual_fallback",
    amount: Math.max(0, Number(remainingAnnualTax) || 0),
  };
}