/**
 * Shared display helper for the user-facing "Effective Tax Rate".
 *
 * One implementation, used by:
 *   - Tax Overview top card (src/pages/Taxes.tsx)
 *   - Tax Breakdown summary cards & summary table
 *     (src/components/tax-breakdown/*, src/hooks/useTaxBreakdown.ts)
 *
 * Rules:
 *   - If withholdingMethod === "flat_estimate", show the selected flat
 *     federal profile rate.
 *   - Otherwise, prefer the engine's effectiveRate FOR THE CURRENTLY
 *     SELECTED MODE (Actual Only vs Planned Income). Fall back to the
 *     profile's canonical effective tax rate when the engine value is
 *     unavailable.
 *
 * Returns a value in percent units (e.g. 14.6), suitable for direct
 * `.toFixed(1)` rendering in the UI.
 */
import type { TaxEstimate } from "@/lib/taxEngine";
import type {
  SavingsRateSettingsLike,
  WithholdingProfileRateResult,
} from "@/lib/savingsRateSelection";
import { getSelectedWithholdingProfileRate } from "@/lib/savingsRateSelection";

export interface DisplayedEffectiveRateInput {
  taxSettings: SavingsRateSettingsLike | null | undefined;
  /** Tax estimate for the currently selected display mode (actual vs forecast). */
  modeEstimate: TaxEstimate | null | undefined;
  /** Pre-resolved profile (optional). When omitted, derived from the estimates. */
  profile?: WithholdingProfileRateResult;
  /** Used to derive profile when one isn't provided. */
  actualEstimate?: TaxEstimate | null | undefined;
  currentPaceEstimate?: TaxEstimate | null | undefined;
  forecastEstimate?: TaxEstimate | null | undefined;
}

/**
 * Returns the displayed effective tax rate as a PERCENT (0-100).
 */
export function getDisplayedEffectiveRatePct(input: DisplayedEffectiveRateInput): number {
  const settings = input.taxSettings ?? {};
  const profile =
    input.profile ??
    getSelectedWithholdingProfileRate({
      taxSettings: settings,
      actualEstimate: input.actualEstimate ?? input.modeEstimate ?? null,
      currentPaceEstimate: input.currentPaceEstimate ?? null,
      forecastEstimate: input.forecastEstimate ?? input.modeEstimate ?? null,
    });

  if (settings.withholdingMethod === "flat_estimate") {
    return Number(profile.federalProfileRate) || 0;
  }

  const engineRate = input.modeEstimate?.effectiveRate;
  if (engineRate != null && Number.isFinite(Number(engineRate))) {
    const n = Number(engineRate);
    // engine returns percent (0-100); guard against any 0-1 callers.
    return n <= 1 ? n * 100 : n;
  }
  return Number(profile.canonicalEffectiveTaxRate) || 0;
}
