/**
 * Presentation helpers for the shared Transaction Detail sheet.
 *
 * PRESENTATION ONLY. These helpers never compute tax figures — they take
 * values that already come from the canonical engines
 * (`useIncomeRecommendation`, `incomeRecommendationSurface`,
 * `canonicalWithholding`, …) and map them to labels/tones for the modal.
 */

import { hasLargeAmountDiff } from "@/lib/linkMergeEngine";
import { resolveAdditionalNeeded } from "@/lib/incomeRecommendationSurface";

export type TxStatusLevel = "ok" | "attention" | "error";

const fmt = (n: number) =>
  Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Deposit-variance copy. Uses the app's existing reconciliation tolerance
 * (`hasLargeAmountDiff`) instead of inventing a new threshold.
 */
export function describeDepositVariance(
  bankDeposit: number | null | undefined,
  calculatedNet: number | null | undefined,
): { material: boolean; text: string; variance: number } | null {
  const bank = Number(bankDeposit);
  const calc = Number(calculatedNet);
  if (!Number.isFinite(bank) || !Number.isFinite(calc) || bank <= 0 || calc <= 0) return null;
  const variance = bank - calc;
  if (Math.abs(variance) < 0.01) return { material: false, text: "Deposit matched exactly", variance: 0 };
  const material = hasLargeAmountDiff(bank, calc);
  return {
    material,
    variance,
    text: material
      ? `Deposit differs by ${variance >= 0 ? "+" : "−"}${fmt(variance)}`
      : `Deposit matched within ${fmt(variance)}`,
  };
}

export interface IncomeTaxStatusInput {
  /** True for W-2 paychecks — their gap is handled by the annual W-4 strategy. */
  isW2: boolean;
  /** Canonical recommended reserve for this transaction (gross basis), if known. */
  recommended?: number | null;
  /** Total the user withheld/saved for this transaction. */
  saved: number;
}

export interface IncomeTaxStatus {
  level: TxStatusLevel;
  title: string;
  description: string;
  ctaLabel: string;
}

/**
 * Compact tax-savings status for a single income transaction.
 *
 * W-2 paychecks are never labelled underfunded — the remaining annual gap is
 * intentionally addressed by the W-4 calculator, not per paycheck (see
 * `paycheckProfileSavings.isW2PaycheckTarget`).
 */
export function resolveIncomeTaxStatus(input: IncomeTaxStatusInput): IncomeTaxStatus | null {
  const saved = Number(input.saved) || 0;

  if (input.isW2) {
    return {
      level: "ok",
      title: "Tax savings on track",
      description:
        "Payroll withholding covers this paycheck. Any remaining annual gap is handled by your W-4 plan.",
      ctaLabel: "View tax recommendation",
    };
  }

  const recommended = Number(input.recommended);
  if (!Number.isFinite(recommended) || recommended <= 0) return null;

  const additional = resolveAdditionalNeeded(recommended, saved);
  if (additional <= 0) {
    return {
      level: "ok",
      title: "Tax savings on track",
      description: "Your withholding and reserves meet the current tax target for this income.",
      ctaLabel: "View tax recommendation",
    };
  }

  return {
    level: "attention",
    title: "Tax savings may be low",
    description: "Your current withholding/savings is below the current tax target.",
    ctaLabel: "View tax recommendation",
  };
}

const TYPE_CHIP_LABELS: Record<string, string> = {
  w2: "W-2",
  w2_employee: "W-2",
  "1099": "1099",
  "1099_nec": "1099",
  "1099_schedule_c": "1099",
  k1: "K-1",
  k1_partnership: "K-1",
  scorp_distribution: "S-Corp",
  capital_gain: "Capital gain",
  capital_gains: "Capital gain",
  dividend: "Dividend",
  interest: "Interest",
  rental: "Rental",
  loss: "Loss",
  other_income: "Other income",
  income: "Income",
  expense: "Expense",
};

/**
 * Short, human chip label for a raw income/expense/investment type.
 * Falls back to the provided default, then to a title-cased version of the raw value.
 */
export function shortTypeChip(
  raw: string | null | undefined,
  fallback = "Other",
): string {
  const key = String(raw ?? "").toLowerCase().trim();
  if (!key) return fallback;
  if (TYPE_CHIP_LABELS[key]) return TYPE_CHIP_LABELS[key];
  if (key.startsWith("w2") || key.startsWith("w-2")) return "W-2";
  if (key.startsWith("1099")) return "1099";
  if (key.startsWith("k1") || key.startsWith("k-1")) return "K-1";
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

