/**
 * Canonical W-4 reconciliation
 * ==========================================================================
 * ONE formula, consumed by the W-4 gap, the employer targets, and the
 * "Calculation details" rows. Every displayed line is a term of this formula,
 * so the visible arithmetic reconciles to the cent — no balancing/plug value.
 *
 *   remaining gap =
 *       total projected liability
 *     − actual W-2 withholding (income tax only, never FICA)
 *     − future baseline W-2 withholding
 *     − future current Step 4(c)
 *     − actual saved reserves
 *     − estimated tax payments
 *     − eligible FUTURE business reserves (only when the option is enabled)
 *     − any other real, separately identified credit
 *
 * Concept separation (audit finding #2)
 * ------------------------------------
 * A *recommendation* for an already-earned 1099/K-1 event is guidance, not
 * money. Only these reduce the gap:
 *   • money the user recorded as actually saved (`actualSavedReserves`)
 *   • estimated tax payments actually made
 *   • withholding (actual + future baseline + future Step 4(c))
 *   • reserves expected from genuinely FUTURE Planner business income, and
 *     only when the "include business reserves" option is enabled
 * Historical/YTD recommendations are never passed in here.
 */

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const pos = (v: unknown) => Math.max(0, num(v));
const cents = (n: number) => Math.round(n * 100) / 100;

export interface W4Credit {
  key: string;
  /** User-facing label. Displayed verbatim — never a generic "other sources". */
  label: string;
  /** Positive = reduces the gap. */
  amount: number;
}

export interface W4ReconciliationInput {
  /** Canonical total projected annual tax liability (same value Tax Overview shows). */
  projectedTotalTax: number;
  /** Actual YTD W-2 federal + state INCOME tax withheld. */
  actualW2WithholdingYtd: number;
  /** Future W-2 withholding at current payroll settings, EXCLUDING Step 4(c). */
  futureBaselineW2Withholding: number;
  /** Step 4(c) already on file × remaining paychecks. Counted exactly once. */
  futureCurrentStep4c: number;
  /** Reserves the user recorded as actually saved. */
  actualSavedReserves: number;
  /** Estimated tax payments actually made. */
  estimatedPaymentsMade: number;
  /** Reserves from genuinely future Planner business income, already gated by the option. */
  eligibleFutureBusinessReserves: number;
  /** Any other real, separately identified credit. Each needs its own label. */
  otherCredits?: W4Credit[];
}

export interface W4Reconciliation {
  projectedTotalTax: number;
  /** Ordered, labelled credit rows — the exact rows the UI must render. */
  credits: W4Credit[];
  totalCredits: number;
  /**
   * Gap before recognizing the Step 4(c) already on file. Step-4(c)-invariant,
   * so employer targets never move when a user edits their current 4(c).
   */
  gapBeforeStep4c: number;
  /** Signed: positive = still under-withheld, negative = over-withheld. */
  signedRemainingGap: number;
  /** Floored at 0 — what we may ask the user to add on their W-4. */
  remainingGap: number;
  /** Total future W-2 withholding required (baseline + target extra). */
  requiredFutureW2Withholding: number;
  /** liability − (credits + Step 4(c) + signed gap). Zero by construction. */
  reconciliationDifference: number;
}

export function buildW4Reconciliation(input: W4ReconciliationInput): W4Reconciliation {
  const projectedTotalTax = cents(pos(input.projectedTotalTax));

  const step4c = cents(pos(input.futureCurrentStep4c));

  const credits: W4Credit[] = [
    { key: "actualW2Withholding", label: "Actual W-2 withholding YTD", amount: cents(pos(input.actualW2WithholdingYtd)) },
    {
      key: "futureBaselineW2Withholding",
      label: "Projected future W-2 withholding",
      amount: cents(pos(input.futureBaselineW2Withholding)),
    },
    { key: "futureCurrentStep4c", label: "Current extra W-4 withholding on remaining paychecks", amount: step4c },
    { key: "actualSavedReserves", label: "Actual tax saved YTD", amount: cents(pos(input.actualSavedReserves)) },
    { key: "estimatedPaymentsMade", label: "Estimated payments already made", amount: cents(pos(input.estimatedPaymentsMade)) },
    {
      key: "eligibleFutureBusinessReserves",
      label: "Planned future 1099/business/K-1 reserves",
      amount: cents(pos(input.eligibleFutureBusinessReserves)),
    },
    ...(input.otherCredits ?? [])
      .filter((c) => c && c.label)
      .map((c) => ({ key: c.key, label: c.label, amount: cents(num(c.amount)) })),
  ];

  const totalCredits = cents(credits.reduce((s, c) => s + c.amount, 0));
  // Every credit except the Step 4(c) already on file.
  const gapBeforeStep4c = cents(projectedTotalTax - (totalCredits - step4c));
  const signedRemainingGap = cents(gapBeforeStep4c - step4c);
  const remainingGap = Math.max(0, signedRemainingGap);
  const requiredFutureW2Withholding = cents(
    Math.max(0, gapBeforeStep4c) + cents(pos(input.futureBaselineW2Withholding)),
  );
  const reconciliationDifference = cents(projectedTotalTax - (totalCredits + signedRemainingGap));

  return {
    projectedTotalTax,
    credits,
    totalCredits,
    gapBeforeStep4c,
    signedRemainingGap,
    remainingGap,
    requiredFutureW2Withholding,
    reconciliationDifference,
  };
}

export interface FutureBusinessReserveInput {
  /** The "include business reserves" option. When false the result is always 0. */
  enabled: boolean;
  /** Gross business income expected from FUTURE (unconverted) Planner income. */
  futureBusinessGross: number;
  /** Canonical business reserve rate (percent). */
  reserveRatePct: number;
  /**
   * Remaining canonical responsibility of the non-W-2 source AFTER its own
   * coverage. Caps the credit so reserves can never exceed what is owed and
   * money is never counted twice.
   */
  nonW2RemainingNeed: number;
}

/**
 * Reserves that may reduce the projected W-4 gap.
 *
 * Only future Planner business income qualifies. Already-earned (YTD)
 * 1099/K-1 recommendations are excluded by construction: `futureBusinessGross`
 * is forecast gross minus actual gross, so converted Planner income — which
 * has become actual income — drops out automatically.
 */
export function computeEligibleFutureBusinessReserves(
  input: FutureBusinessReserveInput,
): number {
  if (!input.enabled) return 0;
  const futureReserve = cents(pos(input.futureBusinessGross) * (pos(input.reserveRatePct) / 100));
  return Math.min(futureReserve, cents(pos(input.nonW2RemainingNeed)));
}
