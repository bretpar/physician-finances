/**
 * Household Income Profile — single source of truth for which income entry
 * types the user is allowed to create across the app.
 *
 * The Household Income Profile (set in Onboarding / Settings) is stored on
 * `taxSettings.householdIncomeStreams`. Each form that lets the user add or
 * edit an income entry should call `getAllowedIncomeEntryTypes(streams)` and
 * filter its options accordingly.
 *
 * Existing entries whose type is no longer enabled remain visible in the
 * ledger (we never delete data). When editing such an entry, callers should
 * pass `currentValue` to `filterIncomeTypeOptions` so the form doesn't break.
 */
import type { HouseholdIncomeStreams } from "@/hooks/useTaxSettings";

/** Canonical UI/entry-type keys used across all income forms. */
export type IncomeEntryTypeKey =
  // Personal Income / Income Planner subtypes
  | "w2_user"
  | "w2_partner"
  | "additional_w2"
  | "interest"
  | "rental"
  | "other_income"
  | "loss"
  // Investment subtypes (Investments page + planner)
  | "short_term_gain"
  | "long_term_gain"
  | "dividend"
  // Business / filing-type entries
  | "1099_schedule_c"
  | "k1_partnership"
  | "scorp_w2"
  | "scorp_distribution";

/**
 * Permissive default: when streams are missing (e.g. before settings load) we
 * allow everything so the UI doesn't accidentally hide options.
 */
export function getAllowedIncomeEntryTypes(streams?: HouseholdIncomeStreams | null): Set<IncomeEntryTypeKey> {
  const allowed = new Set<IncomeEntryTypeKey>();
  if (!streams) {
    return new Set<IncomeEntryTypeKey>([
      "w2_user", "w2_partner", "additional_w2",
      "interest", "rental", "other_income", "loss",
      "short_term_gain", "long_term_gain", "dividend",
      "1099_schedule_c", "k1_partnership", "scorp_w2", "scorp_distribution",
    ]);
  }
  if (streams.w2Income) allowed.add("w2_user");
  if (streams.spouseW2Income) allowed.add("w2_partner");
  if (streams.additionalW2Job) allowed.add("additional_w2");
  if (streams.business1099Income) allowed.add("1099_schedule_c");
  if (streams.k1PartnershipIncome) allowed.add("k1_partnership");
  if (streams.sCorpIncome) {
    allowed.add("scorp_w2");
    allowed.add("scorp_distribution");
  }
  if (streams.rentalIncome) allowed.add("rental");
  if (streams.investmentIncome) {
    allowed.add("short_term_gain");
    allowed.add("long_term_gain");
    allowed.add("dividend");
  }
  if (streams.otherIncome) {
    allowed.add("other_income");
    allowed.add("interest");
  }
  // "loss" is always allowed — it's an adjustment, not a new income stream.
  allowed.add("loss");
  return allowed;
}

export function isIncomeEntryTypeAllowed(
  streams: HouseholdIncomeStreams | undefined | null,
  value: string,
): boolean {
  return getAllowedIncomeEntryTypes(streams).has(value as IncomeEntryTypeKey);
}

/**
 * Filter a list of {value,...} options for an income-type Select.
 * Always preserves `currentValue` even when disabled, so editing an existing
 * entry whose type was later turned off still works.
 */
export function filterIncomeTypeOptions<T extends { value: string }>(
  options: T[],
  streams: HouseholdIncomeStreams | undefined | null,
  currentValue?: string,
): T[] {
  const allowed = getAllowedIncomeEntryTypes(streams);
  return options.filter((o) => allowed.has(o.value as IncomeEntryTypeKey) || o.value === currentValue);
}

/** True when an existing entry is for a stream the user has since disabled. */
export function isIncomeEntryTypeDisabled(
  streams: HouseholdIncomeStreams | undefined | null,
  value: string,
): boolean {
  if (!streams) return false;
  return !getAllowedIncomeEntryTypes(streams).has(value as IncomeEntryTypeKey);
}

/**
 * Visibility rules for the deduction tool tabs (Mileage, Home Office,
 * Retirement, HSA). Mileage and Home Office only apply when the user has any
 * self-employed / business income (1099, K-1, S-corp). Retirement and HSA are
 * always available because they exist for both W-2 and 1099/K-1 households.
 */
export interface DeductionToolVisibility {
  showMileage: boolean;
  showHomeOffice: boolean;
  showRetirement: boolean;
  showHsa: boolean;
}

export function getDeductionToolVisibility(
  streams: HouseholdIncomeStreams | undefined | null,
): DeductionToolVisibility {
  const hasW2 = !!(streams && (streams.w2Income || streams.spouseW2Income || streams.additionalW2Job));
  const hasSelfEmployed = !!(streams && (streams.business1099Income || streams.k1PartnershipIncome || streams.sCorpIncome));
  // W-2 only = has W-2 income and no self-employed income.
  const isW2Only = hasW2 && !hasSelfEmployed;
  return {
    showMileage: !isW2Only,
    showHomeOffice: !isW2Only,
    showRetirement: true,
    showHsa: true,
  };
}

