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
