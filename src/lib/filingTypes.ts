/**
 * Filing Type Registry
 *
 * Single source of truth for the 6 supported tax filing types.
 * Used by Settings, Add/Edit Income forms, and the tax engine.
 */

export type FilingType =
  | "1099_schedule_c"
  | "k1_partnership"
  | "scorp_w2"
  | "scorp_distribution"
  | "w2"
  | "other";

export interface FilingTypeMeta {
  value: FilingType;
  label: string;
  shortLabel: string;
  /** True if income is reported on a W-2 (employer already withholds FICA) */
  isW2: boolean;
  /** True if subject to self-employment tax (Schedule SE) */
  isSelfEmployed: boolean;
  /** Which advanced field set to render */
  advancedFieldSet:
    | "1099"
    | "k1"
    | "scorp_w2"
    | "scorp_distribution"
    | "w2"
    | "other";
}

export const FILING_TYPES: FilingTypeMeta[] = [
  {
    value: "1099_schedule_c",
    label: "1099 / Schedule C",
    shortLabel: "1099",
    isW2: false,
    isSelfEmployed: true,
    advancedFieldSet: "1099",
  },
  {
    value: "k1_partnership",
    label: "K-1 Partnership",
    shortLabel: "K-1",
    isW2: false,
    isSelfEmployed: true,
    advancedFieldSet: "k1",
  },
  {
    value: "scorp_w2",
    label: "S-Corp W-2 Wages",
    shortLabel: "S-Corp W-2",
    isW2: true,
    isSelfEmployed: false,
    advancedFieldSet: "scorp_w2",
  },
  {
    value: "scorp_distribution",
    label: "S-Corp Distribution",
    shortLabel: "S-Corp Dist.",
    // Distributions are not subject to SE tax; treated as ordinary income.
    isW2: false,
    isSelfEmployed: false,
    advancedFieldSet: "scorp_distribution",
  },
  {
    value: "w2",
    label: "W-2 Employment",
    shortLabel: "W-2",
    isW2: true,
    isSelfEmployed: false,
    advancedFieldSet: "w2",
  },
  {
    value: "other",
    label: "Other",
    shortLabel: "Other",
    isW2: false,
    isSelfEmployed: false,
    advancedFieldSet: "other",
  },
];

const META_BY_VALUE = new Map(FILING_TYPES.map((t) => [t.value, t]));

/**
 * Map any historical or unknown filing-type string to a known FilingType.
 * Keeps the app robust if old strings still flow through.
 */
export function normalizeFilingType(raw: string | null | undefined): FilingType {
  if (!raw) return "1099_schedule_c";
  const v = raw.toLowerCase().trim();
  if (META_BY_VALUE.has(v as FilingType)) return v as FilingType;
  // Legacy mappings
  if (v === "1099") return "1099_schedule_c";
  if (v === "w2" || v === "w2_user" || v === "w2_partner") return "w2";
  if (v === "k1") return "k1_partnership";
  return "other";
}

export function getFilingMeta(raw: string | null | undefined): FilingTypeMeta {
  return META_BY_VALUE.get(normalizeFilingType(raw))!;
}

export function isW2FilingType(raw: string | null | undefined): boolean {
  return getFilingMeta(raw).isW2;
}

export function isSelfEmployedFilingType(raw: string | null | undefined): boolean {
  return getFilingMeta(raw).isSelfEmployed;
}

/* ─── Advanced field configuration per filing type ───
 * Determines which inputs the Income form renders inside the Advanced section.
 * `relevantKeys` lists which IncomeFormState fields are used; the rest are
 * cleared on company change before saving so they don't pollute tax math.
 */

export type IncomeFieldKey =
  | "net_received"
  | "taxes_withheld"
  | "federal_withholding"
  | "state_withholding"
  | "ss_withholding"
  | "medicare_withholding"
  | "pre_tax_deductions"
  | "retirement_401k"
  | "owner_healthcare"
  | "actual_withholding"
  | "additional_tax_reserve"
  | "guaranteed_payment"
  | "is_distribution";

export const ADVANCED_FIELDS_BY_TYPE: Record<FilingType, IncomeFieldKey[]> = {
  "1099_schedule_c": [
    "net_received",
    "taxes_withheld",
    "actual_withholding",
    "additional_tax_reserve",
  ],
  "k1_partnership": [
    "net_received",
    "taxes_withheld",
    "owner_healthcare",
    "retirement_401k",
    "pre_tax_deductions",
    "actual_withholding",
    "additional_tax_reserve",
  ],
  "scorp_w2": [
    "net_received",
    "federal_withholding",
    "state_withholding",
    "ss_withholding",
    "medicare_withholding",
    "retirement_401k",
    "owner_healthcare",
    "pre_tax_deductions",
  ],
  "scorp_distribution": [
    "actual_withholding",
    "additional_tax_reserve",
  ],
  "w2": [
    "net_received",
    "federal_withholding",
    "state_withholding",
    "ss_withholding",
    "medicare_withholding",
    "retirement_401k",
    "owner_healthcare",
    "pre_tax_deductions",
  ],
  "other": [
    "net_received",
    "taxes_withheld",
    "actual_withholding",
    "additional_tax_reserve",
  ],
};
