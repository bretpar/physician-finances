/**
 * Pure helpers for W-2 paycheck recommendation display.
 *
 * Personal Income's per-paycheck guide can show either:
 *  - "paycheck_target": per-paycheck target = gross × effective rate (existing)
 *  - "annual_w4": annual W-4 gap based messaging that references the W-4 card
 *
 * Setting is `w2PaycheckRecMethod` on tax_settings. Default is "annual_w4" so
 * W-2-only users no longer see confusing "save extra hundreds on this paycheck"
 * messaging when their W-4 is already on track.
 */
import type { W2PaycheckRecMethod } from "@/hooks/useTaxSettings";

export interface W2PaycheckRecInput {
  method: W2PaycheckRecMethod;
  isW2: boolean;
  /** Signed annual W-4 federal gap. Positive = under-withheld. */
  signedAnnualGap: number;
  /** Extra per-paycheck recommended by the W-4 calculator for this employer. */
  extraPerPaycheck: number;
}

export type W2PaycheckRecMode =
  | "paycheck_target"   // show existing per-paycheck target UI
  | "w4_on_track"       // annual_w4 + gap ≤ 0
  | "w4_extra_needed";  // annual_w4 + gap > 0

export interface W2PaycheckRecDisplay {
  mode: W2PaycheckRecMode;
  /** Section heading shown in the per-paycheck guide. */
  heading: string;
  /** Primary headline message. */
  primary: string;
  /** Supporting description shown beneath the headline. */
  secondary: string;
  /** Amount to show large on the right side; null = hide. */
  amount: number | null;
  /** Right-side label under the amount. */
  rightLabel: string;
}

const fmtMoney = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString()}`;

/**
 * Decide what to display for a W-2 paycheck guide. Non-W-2 entries always
 * fall back to the existing paycheck-target behaviour (the caller renders it).
 */
export function decideW2PaycheckRecDisplay(
  input: W2PaycheckRecInput,
): W2PaycheckRecDisplay | null {
  const { method, isW2, signedAnnualGap, extraPerPaycheck } = input;

  // Non-W-2 income or paycheck_target mode → caller keeps the existing
  // effective-rate target card. Return null to signal "use legacy display".
  if (!isW2 || method === "paycheck_target") return null;

  // Annual W-4 method:
  if (signedAnnualGap <= 0) {
    return {
      mode: "w4_on_track",
      heading: "W-4 adjustment",
      primary: "No extra W-4 withholding recommended",
      secondary:
        "Your projected W-2 withholding appears to cover your annual federal tax estimate. See the W-4 Calculator tab for details.",
      amount: null,
      rightLabel: "On track",
    };
  }

  const perPaycheck = Math.max(0, Math.round(extraPerPaycheck));
  return {
    mode: "w4_extra_needed",
    heading: "W-4 adjustment",
    primary: `W-4 adjustment recommended: ${fmtMoney(perPaycheck)} extra per paycheck`,
    secondary:
      "Based on your annual federal tax gap after counting W-2 withholding, estimated payments, and savings. See the W-4 Calculator tab for full details.",
    amount: perPaycheck,
    rightLabel: "Extra per paycheck",
  };
}
