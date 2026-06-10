/**
 * Canonical builder for `buildQuarterRecommendation` inputs.
 *
 * Both the Dashboard Q-payment callout AND the Tax Overview QuarterlyTracker
 * must call `buildQuarterRecommendation` with identical inputs so the
 * "Recommended quarterly payment" amount cannot drift between screens.
 *
 * This hook produces the canonical input object — everything except `year`
 * and `quarter` (which the consumer chooses based on `getActivePaymentTarget`
 * or the user-selected view).
 *
 * Root cause of the historical $251 drift between Dashboard ($10,197) and
 * Tax Overview ($10,448): each screen built `projectedPaychecks` from a
 * different argument set (Dashboard included overrides + planner
 * conversions + business txs; Taxes did not). Those projected paychecks
 * feed `quarterTarget` in dynamic mode, producing different totals. Going
 * through this single builder removes that class of bug entirely.
 */
import { useMemo } from "react";
import { useTaxSettings } from "@/hooks/useTaxSettings";
import { useTaxEstimate } from "@/hooks/useTaxEstimate";
import { useTransactions } from "@/hooks/useTransactions";
import { useIncomeEntries } from "@/hooks/useIncome";
import { usePersonalIncomeEntries } from "@/hooks/usePersonalIncome";
import { useInvestmentIncomeEntries } from "@/hooks/useInvestmentIncome";
import { useTaxPayments, type TaxPayment } from "@/hooks/useTaxPayments";
import { useTaxSavings } from "@/hooks/useTaxSavings";
import {
  useProjectedStreams,
  useProjectedBonuses,
  useStreamOverrides,
  usePlannerConversions,
  generateProjectedPaychecks,
} from "@/hooks/useProjectedIncome";
import type { QuarterRecommendationInput } from "@/lib/quarterRecommendation";

export interface QuarterRecommendationSharedInput
  extends Omit<QuarterRecommendationInput, "year" | "quarter" | "payments"> {
  /** Annual liability selected from the active tax-mode estimate. */
  annualTaxLiability: number;
  /** Full TaxPayment rows so consumers like QuarterlyTracker keep their typed shape. */
  payments: TaxPayment[];
  isLoading: boolean;
}

/**
 * Returns the canonical input object for `buildQuarterRecommendation`.
 * Consumers add `{ year, quarter }` themselves — typically via
 * `getActivePaymentTarget(now)` on the Dashboard or the user-selected
 * tracker view in Tax Overview.
 */
export function useQuarterRecommendationInput(): QuarterRecommendationSharedInput {
  const { data: rates, isLoading: ratesLoading } = useTaxSettings();
  const {
    actualEstimate,
    currentPaceEstimate,
    forecastEstimate,
    isLoading: estLoading,
  } = useTaxEstimate();
  const { data: transactions, isLoading: txLoading } = useTransactions();
  const { data: incomeEntries, isLoading: incLoading } = useIncomeEntries();
  const { data: personalEntries, isLoading: piLoading } = usePersonalIncomeEntries();
  const { data: investmentEntries } = useInvestmentIncomeEntries();
  const { data: payments = [] } = useTaxPayments();
  const { data: taxSavings = [] } = useTaxSavings();
  const { data: streams } = useProjectedStreams();
  const { data: bonuses } = useProjectedBonuses();
  const { data: overrides } = useStreamOverrides();
  const { data: plannerConversions } = usePlannerConversions();

  // Match Dashboard's full-fidelity projected paychecks: include overrides
  // + planner conversions + business income txs so converted/skipped
  // occurrences don't double-count toward Planned. Tax Overview previously
  // omitted these args, producing a different quarterTarget.
  const businessTxsForMatching = useMemo(() => {
    return (transactions || [])
      .filter((t) => t.transaction_type === "income")
      .map((t) => ({
        id: t.id,
        transaction_date: t.transaction_date,
        vendor: (t as any).vendor ?? "",
        amount: Number(t.amount),
        source_id: (t as any).source_id ?? null,
        status: t.status,
        transaction_type: t.transaction_type,
        origin_type: (t as any).origin_type ?? null,
        origin_planner_conversion_id: (t as any).origin_planner_conversion_id ?? null,
      }));
  }, [transactions]);

  const projectedPaychecks = useMemo(
    () =>
      generateProjectedPaychecks(
        streams || [],
        bonuses || [],
        incomeEntries,
        overrides || [],
        plannerConversions || [],
        businessTxsForMatching,
      ),
    [streams, bonuses, incomeEntries, overrides, plannerConversions, businessTxsForMatching],
  );

  const manualSavings = useMemo(
    () => taxSavings.map((s) => ({ savings_date: s.savings_date, amount: Number(s.amount) })),
    [taxSavings],
  );

  // Choose annual liability by withholding method — identical formula for
  // Dashboard and Tax Overview.
  const method = rates?.withholdingMethod ?? "dynamic_planner";
  const baseEstimate =
    method === "dynamic_planner"
      ? forecastEstimate ?? actualEstimate
      : currentPaceEstimate ?? actualEstimate;
  const annualTaxLiability = Math.max(0, Number(baseEstimate?.totalTaxLiability || 0));
  const quarterMethod = rates?.quarterlyTrackerMethod ?? "even";

  return {
    annualTaxLiability,
    quarterMethod,
    incomeEntries: incomeEntries || [],
    personalEntries: personalEntries || [],
    transactions: transactions || [],
    investmentEntries: investmentEntries || [],
    projectedPaychecks,
    payments,
    manualSavings,
    isLoading: ratesLoading || estLoading || txLoading || incLoading || piLoading,
  };
}
