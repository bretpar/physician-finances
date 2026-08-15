/**
 * Source-level funding plan
 * ==========================================================================
 * The canonical annual allocation (src/lib/taxAllocation.ts) answers
 * "how much of the annual liability does each source OWE?".
 *
 * This module answers the next question:
 *   "how much of that owed amount is each source still responsible for
 *    FUNDING, after the coverage that legitimately belongs to it?"
 *
 * Why this exists
 * ---------------
 * The W-4 card used to compute its gap as a HOUSEHOLD residual:
 *
 *   gap = annual liability
 *       − all withholding − all savings − all estimated payments
 *       − (future business gross × a business rate)
 *
 * Any business responsibility that the business-rate term under-estimated
 * silently spilled into W-2 withholding, producing a W-4 ask many times larger
 * than the W-2 source's real deficit. Source funding must be computed per
 * source, from the canonical allocation, never as a leftover.
 *
 * Invariants (enforced by tests):
 *   I1. w2.allocated + nonW2.allocated + unallocatedTax = annual liability.
 *   I2. Each source's remaining need = its allocated responsibility − only the
 *       coverage attributed to it. No cross-source spill.
 *   I3. Household-level money (estimated payments, generic tax savings) is
 *       credited EXACTLY once: sum of source credits === amount counted.
 *   I4. Household reconciliation still holds:
 *       total coverage + total remaining need ≈ annual liability.
 */

import type { AnnualTaxAllocation } from "@/lib/taxAllocation";
import { ALLOCATION_BUCKETS } from "@/lib/canonicalEventRecommendation";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pos = (v: unknown) => Math.max(0, num(v));
const round2 = (n: number) => Math.round(n * 100) / 100;

export type FundingSourceKey = "w2" | "nonW2";

export interface SourceFunding {
  key: FundingSourceKey;
  label: string;
  /** Canonical allocated annual tax responsibility for this source. */
  allocatedResponsibility: number;
  /** Coverage that belongs to this source alone (withholding, own reserves). */
  directCoverage: number;
  /** Share of household estimated payments credited here. */
  estimatedPaymentCredit: number;
  /** Share of household generic tax savings credited here. */
  savingsCredit: number;
  /** directCoverage + estimatedPaymentCredit + savingsCredit. */
  totalCoverage: number;
  /** Still unfunded. Floored at 0 — this is what we may ask the user for. */
  remainingNeed: number;
  /** Signed (negative = over-funded). */
  signedNeed: number;
}

export interface SourceFundingPlan {
  annualLiability: number;
  w2: SourceFunding;
  nonW2: SourceFunding;
  /** Liability no bucket could carry (rounding / unmapped). Reported, never hidden. */
  unallocatedTax: number;
  /** Household estimated payments actually credited across the sources. */
  estimatedPaymentsCredited: number;
  /** Estimated payments beyond the uncovered responsibility (over-payment). */
  estimatedPaymentsUnapplied: number;
  savingsCredited: number;
  savingsUnapplied: number;
  totalCoverage: number;
  totalRemainingNeed: number;
  /** annualLiability − (totalCoverage + totalRemainingNeed). ~0 by construction. */
  householdReconciliationDifference: number;
}

export interface SourceFundingPlanInput {
  allocation: AnnualTaxAllocation;

  /** W-2 federal + state INCOME tax withheld YTD. Never FICA. */
  w2ActualWithheldYtd: number;
  /** Baseline withholding expected from remaining W-2 paychecks (no W-4 change). */
  w2ExpectedFutureBaselineWithholding: number;
  /** Reserves already set aside specifically against W-2 income. */
  w2ReservesSaved?: number;

  /** Taxes already PAID that are attributable to business/1099 income. */
  nonW2ActualPaidYtd?: number;
  /** Reserves already set aside specifically against business/1099 income. */
  nonW2ReservesSaved?: number;

  /** Household estimated tax payments made YTD (not source-attributed). */
  estimatedPaymentsMade?: number;
  /** Household "tax savings set aside" not attributable to one source. */
  householdSavingsSetAside?: number;
}

/**
 * Split `total` across `weights` pro-rata, capped at the sum of weights, so the
 * credit is used exactly once and never exceeds what is uncovered.
 */
function creditProRata(total: number, weights: number[]): { parts: number[]; used: number; unapplied: number } {
  const parts = weights.map(() => 0);
  const amount = pos(total);
  const capacity = weights.reduce((a, w) => a + pos(w), 0);
  if (amount <= 0 || capacity <= 0) {
    return { parts, used: 0, unapplied: round2(amount) };
  }
  const applied = Math.min(amount, capacity);
  let running = 0;
  let largest = 0;
  for (let i = 0; i < weights.length; i += 1) {
    if (pos(weights[i]) > pos(weights[largest])) largest = i;
  }
  for (let i = 0; i < weights.length; i += 1) {
    const w = pos(weights[i]);
    if (w <= 0) continue;
    parts[i] = round2((applied * w) / capacity);
    running = round2(running + parts[i]);
  }
  const residual = round2(applied - running);
  if (residual !== 0) parts[largest] = round2(parts[largest] + residual);
  return { parts, used: round2(applied), unapplied: round2(amount - applied) };
}

function bucketResponsibility(allocation: AnnualTaxAllocation, ids: string[]): number {
  return round2(
    (allocation?.sources ?? [])
      .filter((s) => ids.includes(s.sourceId))
      .reduce((a, s) => a + pos(s.totalAllocatedTaxResponsibility), 0),
  );
}

/**
 * Build the source funding plan. The ONLY supported way to derive a W-4 ask or
 * a business reserve plan.
 */
export function buildSourceFundingPlan(input: SourceFundingPlanInput): SourceFundingPlan {
  const allocation = input.allocation;
  const annualLiability = round2(pos(allocation?.projectedTaxLiability));

  const w2Allocated = bucketResponsibility(allocation, [ALLOCATION_BUCKETS.w2]);
  const nonW2Allocated = bucketResponsibility(allocation, [
    ALLOCATION_BUCKETS.business,
    ALLOCATION_BUCKETS.investment,
    ALLOCATION_BUCKETS.other,
  ]);
  const unallocatedTax = round2(annualLiability - w2Allocated - nonW2Allocated);

  const w2Direct = round2(
    pos(input.w2ActualWithheldYtd) +
      pos(input.w2ExpectedFutureBaselineWithholding) +
      pos(input.w2ReservesSaved),
  );
  const nonW2Direct = round2(pos(input.nonW2ActualPaidYtd) + pos(input.nonW2ReservesSaved));

  // Uncovered responsibility AFTER source-specific coverage. Household money is
  // then credited proportionally to what is still uncovered — a single,
  // predictable policy applied once.
  const uncovered = [Math.max(0, w2Allocated - w2Direct), Math.max(0, nonW2Allocated - nonW2Direct)];

  const est = creditProRata(input.estimatedPaymentsMade ?? 0, uncovered);
  const afterEst = [
    Math.max(0, uncovered[0] - est.parts[0]),
    Math.max(0, uncovered[1] - est.parts[1]),
  ];
  const sav = creditProRata(input.householdSavingsSetAside ?? 0, afterEst);

  const build = (
    key: FundingSourceKey,
    label: string,
    allocated: number,
    direct: number,
    idx: number,
  ): SourceFunding => {
    const estimatedPaymentCredit = est.parts[idx];
    const savingsCredit = sav.parts[idx];
    const totalCoverage = round2(direct + estimatedPaymentCredit + savingsCredit);
    const signedNeed = round2(allocated - totalCoverage);
    return {
      key,
      label,
      allocatedResponsibility: allocated,
      directCoverage: direct,
      estimatedPaymentCredit,
      savingsCredit,
      totalCoverage,
      remainingNeed: Math.max(0, signedNeed),
      signedNeed,
    };
  };

  const w2 = build("w2", "W-2 wages", w2Allocated, w2Direct, 0);
  const nonW2 = build("nonW2", "Business & other income", nonW2Allocated, nonW2Direct, 1);

  const totalCoverage = round2(w2.totalCoverage + nonW2.totalCoverage);
  const totalRemainingNeed = round2(w2.remainingNeed + nonW2.remainingNeed);
  // Over-funding on one source shows up as a negative signed need; the
  // household difference reports it rather than moving it to the other source.
  const householdReconciliationDifference = round2(
    annualLiability - (totalCoverage + totalRemainingNeed),
  );

  return {
    annualLiability,
    w2,
    nonW2,
    unallocatedTax,
    estimatedPaymentsCredited: est.used,
    estimatedPaymentsUnapplied: est.unapplied,
    savingsCredited: sav.used,
    savingsUnapplied: sav.unapplied,
    totalCoverage,
    totalRemainingNeed,
    householdReconciliationDifference,
  };
}

/**
 * Per-paycheck Step 4(c) additional withholding needed to close ONLY the W-2
 * source deficit, spread across eligible remaining W-2 paychecks.
 */
export function w2AdditionalWithholdingPerPaycheck(
  plan: SourceFundingPlan,
  remainingPaychecks: number,
): number {
  const n = Math.max(0, Math.floor(num(remainingPaychecks)));
  if (n <= 0) return 0;
  return round2(plan.w2.remainingNeed / n);
}
