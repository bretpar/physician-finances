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

/**
 * Canonical income_type values accepted by the database constraint for
 * NEW saves. The DB also still accepts legacy values for historical rows,
 * but every new INSERT/UPDATE should funnel through this set.
 */
export type CanonicalIncomeType = "w2" | "1099" | "k1" | "other";

/**
 * Map any UI/legacy income type string to one of the 4 canonical
 * income_type values that pass the income_entries_income_type_check
 * constraint. Never store display labels or company names here.
 */
export function toCanonicalIncomeType(
  raw: string | null | undefined,
): CanonicalIncomeType {
  if (!raw) return "other";
  const v = raw.toLowerCase().trim();
  if (v === "w2" || v === "w2_user" || v === "w2_partner" || v === "scorp_w2") {
    return "w2";
  }
  if (v === "1099" || v === "1099_schedule_c") return "1099";
  if (v === "k1" || v === "k1_partnership") return "k1";
  // dividend / interest / rental / capital gains / loss / scorp_distribution / other_income → "other"
  return "other";
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
    "guaranteed_payment",
    "is_distribution",
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
    "net_received",
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

/* ─── Per-company toggle catalog ───
 * The Settings > Companies > Advanced tax settings section lets users
 * toggle which optional fields appear in the Add/Edit Income form for
 * that company. The available toggles depend on the company's filing
 * type. Each toggle maps to one IncomeFieldKey (or the "notes" pseudo-key).
 */

export type ToggleKey = IncomeFieldKey | "notes";

export interface ToggleOption {
  key: ToggleKey;
  label: string;
}

export const TOGGLE_OPTIONS_BY_TYPE: Record<FilingType, ToggleOption[]> = {
  "1099_schedule_c": [
    { key: "net_received", label: "Net received" },
    { key: "taxes_withheld", label: "Taxes actually withheld" },
    { key: "actual_withholding", label: "Recommended tax set-aside" },
    { key: "notes", label: "Notes" },
  ],
  "k1_partnership": [
    { key: "net_received", label: "Net received" },
    { key: "taxes_withheld", label: "Taxes actually withheld" },
    { key: "owner_healthcare", label: "Partner health insurance deduction" },
    { key: "retirement_401k", label: "Partner retirement / 401(k) contribution" },
    { key: "pre_tax_deductions", label: "Other partner deductions" },
    { key: "guaranteed_payment", label: "Guaranteed payment" },
    { key: "is_distribution", label: "Distribution amount" },
    { key: "notes", label: "Notes" },
  ],
  "scorp_w2": [
    { key: "net_received", label: "Net received" },
    { key: "federal_withholding", label: "Federal tax withheld" },
    { key: "state_withholding", label: "State tax withheld" },
    { key: "ss_withholding", label: "Social Security tax withheld" },
    { key: "medicare_withholding", label: "Medicare tax withheld" },
    { key: "retirement_401k", label: "Employee 401(k) contribution" },
    { key: "owner_healthcare", label: "Health insurance deduction" },
    { key: "pre_tax_deductions", label: "Other pre-tax deductions" },
    { key: "notes", label: "Notes" },
  ],
  "scorp_distribution": [
    { key: "net_received", label: "Distribution amount" },
    { key: "taxes_withheld", label: "Taxes actually withheld" },
    { key: "actual_withholding", label: "Recommended tax set-aside" },
    { key: "notes", label: "Notes" },
  ],
  "w2": [
    { key: "net_received", label: "Net received" },
    { key: "federal_withholding", label: "Federal tax withheld" },
    { key: "state_withholding", label: "State tax withheld" },
    { key: "ss_withholding", label: "Social Security tax withheld" },
    { key: "medicare_withholding", label: "Medicare tax withheld" },
    { key: "retirement_401k", label: "401(k) contribution" },
    { key: "owner_healthcare", label: "Health insurance deduction" },
    { key: "pre_tax_deductions", label: "Other pre-tax deductions" },
    { key: "notes", label: "Notes" },
  ],
  "other": [
    { key: "net_received", label: "Net received" },
    { key: "taxes_withheld", label: "Taxes actually withheld" },
    { key: "actual_withholding", label: "Recommended tax set-aside" },
    { key: "notes", label: "Notes" },
  ],
};

export const DEFAULT_TOGGLES_BY_TYPE: Record<FilingType, ToggleKey[]> = {
  "1099_schedule_c": ["net_received", "actual_withholding", "notes"],
  "k1_partnership": [
    "net_received",
    "owner_healthcare",
    "retirement_401k",
    "pre_tax_deductions",
    "notes",
  ],
  "scorp_w2": [
    "net_received",
    "federal_withholding",
    "state_withholding",
    "retirement_401k",
    "owner_healthcare",
    "pre_tax_deductions",
    "notes",
  ],
  "scorp_distribution": ["net_received", "actual_withholding", "notes"],
  "w2": [
    "net_received",
    "federal_withholding",
    "state_withholding",
    "retirement_401k",
    "owner_healthcare",
    "pre_tax_deductions",
    "notes",
  ],
  "other": ["net_received", "notes"],
};

/** Resolve the effective toggle visibility map for a company. */
export function resolveAdvancedVisibility(
  filingType: FilingType,
  saved: Record<string, boolean> | null | undefined,
): Record<ToggleKey, boolean> {
  const options = TOGGLE_OPTIONS_BY_TYPE[filingType];
  const defaults = new Set(DEFAULT_TOGGLES_BY_TYPE[filingType]);
  const out = {} as Record<ToggleKey, boolean>;
  for (const opt of options) {
    if (saved && Object.prototype.hasOwnProperty.call(saved, opt.key)) {
      out[opt.key] = !!saved[opt.key];
    } else {
      out[opt.key] = defaults.has(opt.key);
    }
  }
  return out;
}
