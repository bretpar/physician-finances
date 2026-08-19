/**
 * K-1 Tax Treatment
 * --------------------------------------------------------------------------
 * Per-entity setting for K-1 Partnership companies. Drives whether the
 * recommended tax set-aside includes self-employment (SE) tax for income
 * linked to that entity.
 *
 * Active partnership / LLC member  → SE-taxable (working partner)
 * Guaranteed payments              → SE-taxable
 * Passive K-1                      → NOT SE-taxable
 * S-corp distribution              → NOT SE-taxable
 */
export type K1TaxTreatment =
  | "active_partnership"
  | "guaranteed_payments"
  | "passive"
  | "scorp_distribution";

export const K1_TAX_TREATMENT_DEFAULT: K1TaxTreatment = "active_partnership";

export interface K1TaxTreatmentMeta {
  value: K1TaxTreatment;
  label: string;
  shortLabel: string;
  description: string;
  seTaxable: boolean;
}

export const K1_TAX_TREATMENT_OPTIONS: K1TaxTreatmentMeta[] = [
  {
    value: "active_partnership",
    label: "Active partnership / LLC member",
    shortLabel: "Active partnership",
    description: "Subject to self-employment tax. Use for active working partners.",
    seTaxable: true,
  },
  {
    value: "guaranteed_payments",
    label: "Guaranteed payments",
    shortLabel: "Guaranteed payments",
    description: "Subject to self-employment tax. Treated like earned self-employment income.",
    seTaxable: true,
  },
  {
    value: "passive",
    label: "Passive K-1",
    shortLabel: "Passive K-1",
    description: "Not subject to self-employment tax. Federal/state income tax only.",
    seTaxable: false,
  },
  {
    value: "scorp_distribution",
    label: "S-corp distribution",
    shortLabel: "S-corp distribution",
    description: "Not subject to self-employment tax. Federal/state income tax only.",
    seTaxable: false,
  },
];

const META_BY_VALUE = new Map(K1_TAX_TREATMENT_OPTIONS.map((o) => [o.value, o]));

export function getK1TreatmentMeta(value: K1TaxTreatment | null | undefined): K1TaxTreatmentMeta | null {
  if (!value) return null;
  return META_BY_VALUE.get(value) ?? null;
}

/** Returns true/false when a treatment is set; null when unset (caller decides default). */
export function isK1TreatmentSETaxable(value: K1TaxTreatment | null | undefined): boolean | null {
  const meta = getK1TreatmentMeta(value);
  return meta ? meta.seTaxable : null;
}

/* ── Canonical SE-tax eligibility ────────────────────────────────────────
 * ONE helper that decides whether income linked to a company is subject to
 * self-employment tax. `k1TaxTreatment` is the source of truth for K-1
 * entities; the legacy `includeSETaxInRecommendation` boolean is only a
 * fallback for rows saved before the treatment field existed.
 */

export interface SETaxEligibilityInput {
  /** Company filing type / income type string (any legacy spelling is fine). */
  filingType?: string | null;
  k1TaxTreatment?: K1TaxTreatment | null;
  /** Legacy per-company boolean. Only consulted when treatment is unset. */
  includeSETaxInRecommendation?: boolean | null;
}

/**
 * True when income for this entity belongs in the SE-taxable pool.
 *
 *   1099 / Schedule C                 → SE taxable (legacy boolean may opt out)
 *   K-1 active / guaranteed payments  → SE taxable
 *   K-1 passive / S-corp distribution → NOT SE taxable
 *   W-2, S-corp W-2, other            → NOT SE taxable
 */
export function isSETaxableEntity(input: SETaxEligibilityInput): boolean {
  const raw = (input.filingType ?? "").toLowerCase().trim();
  const isK1 = raw.includes("k1") || raw.includes("k-1") || raw.includes("partnership");
  const is1099 = raw === "1099" || raw.includes("1099") || raw.includes("schedule_c");

  if (isK1) {
    // Treatment field wins whenever it is set.
    const seTaxable = isK1TreatmentSETaxable(input.k1TaxTreatment);
    if (seTaxable !== null) return seTaxable;
    // Legacy fallback only.
    return input.includeSETaxInRecommendation !== false;
  }

  if (is1099) return input.includeSETaxInRecommendation !== false;

  return false;
}

/** The `include_se_tax_in_recommendation` value implied by a K-1 treatment. */
export function seTaxFlagForK1Treatment(value: K1TaxTreatment | null | undefined): boolean {
  return isK1TreatmentSETaxable(value) ?? true;
}
