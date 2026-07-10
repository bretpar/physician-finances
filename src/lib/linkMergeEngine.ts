/**
 * Field-level merge engine for transaction linking.
 *
 * When a manual/planned income transaction is linked to an imported Plaid
 * transaction, we compare each shared field. Fields that are identical (or
 * where only one side has a value) are merged automatically. Fields with
 * true conflicts are returned so the UI can ask the user which value to keep
 * before persisting the link.
 *
 * The user's choices are then stored as `field_locks` on `transaction_links`
 * so future Plaid resyncs never silently overwrite a value the user picked.
 *
 * NOTE: This module does NOT change tax math, withholding logic, income
 * calculations, or ledger math. It only decides which of two already-computed
 * field values to persist onto the canonical row at link time.
 */

export type ConflictKind = "money" | "date" | "text";
export type ConflictChoice = "current" | "imported" | "custom";

export interface FieldConflict {
  key: FieldKey;
  label: string;
  kind: ConflictKind;
  currentValue: string | number | null;
  importedValue: string | number | null;
  /** What we auto-select if the user just clicks Link Transactions. */
  defaultChoice: "current" | "imported";
  /** Whether the "Enter Custom Value" option should render. */
  allowCustom: boolean;
}

export interface ConflictResolution {
  key: FieldKey;
  choice: ConflictChoice;
  customValue?: string | number | null;
}

export type FieldKey =
  | "gross_amount"
  | "deposited_amount"
  | "transaction_date"
  | "vendor"
  | "category"
  | "notes"
  | "federal_withholding"
  | "state_withholding"
  | "ss_withholding"
  | "medicare_withholding"
  | "retirement_401k"
  | "hsa_contribution"
  | "pre_tax_deductions";

export interface MergeSide {
  gross_amount?: number | null;
  deposited_amount?: number | null;
  transaction_date?: string | null;
  vendor?: string | null;
  category?: string | null;
  notes?: string | null;
  federal_withholding?: number | null;
  state_withholding?: number | null;
  ss_withholding?: number | null;
  medicare_withholding?: number | null;
  retirement_401k?: number | null;
  hsa_contribution?: number | null;
  pre_tax_deductions?: number | null;
}

export interface MergeInput {
  current: MergeSide;
  imported: MergeSide;
}

interface FieldSpec {
  key: FieldKey;
  label: string;
  kind: ConflictKind;
  /**
   * Which side is the natural default when both provide a real value.
   * - "imported" for cash-movement facts the bank owns (deposit amount, date).
   * - "current" for user-entered accounting details (gross, withholdings,
   *   retirement, HSA, category, notes, vendor).
   */
  defaultChoice: "current" | "imported";
  allowCustom: boolean;
}

const FIELD_SPECS: FieldSpec[] = [
  { key: "gross_amount",       label: "Gross Income",              kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "deposited_amount",   label: "Net Received",              kind: "money", defaultChoice: "imported", allowCustom: true },
  { key: "transaction_date",   label: "Transaction Date",          kind: "date",  defaultChoice: "imported", allowCustom: false },
  { key: "vendor",             label: "Description",               kind: "text",  defaultChoice: "current",  allowCustom: true },
  { key: "category",           label: "Category",                  kind: "text",  defaultChoice: "current",  allowCustom: true },
  { key: "notes",              label: "Notes",                     kind: "text",  defaultChoice: "current",  allowCustom: true },
  { key: "federal_withholding",label: "Federal Tax Withheld",      kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "state_withholding",  label: "State Tax Withheld",        kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "ss_withholding",     label: "Social Security",           kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "medicare_withholding",label:"Medicare",                  kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "retirement_401k",    label: "Retirement Contributions",  kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "hsa_contribution",   label: "HSA",                       kind: "money", defaultChoice: "current",  allowCustom: true },
  { key: "pre_tax_deductions", label: "Other Pre-tax Deductions",  kind: "money", defaultChoice: "current",  allowCustom: true },
];

const MONEY_EPS = 0.005;

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return !Number.isFinite(v) || v === 0;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

function normText(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function toIsoDay(v: unknown): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  // YYYY-MM-DD prefix is enough for equality.
  return s.slice(0, 10);
}

function equalByKind(kind: ConflictKind, a: unknown, b: unknown): boolean {
  if (kind === "money") return Math.abs(Number(a ?? 0) - Number(b ?? 0)) < MONEY_EPS;
  if (kind === "date")  return toIsoDay(a) === toIsoDay(b);
  return normText(a) === normText(b);
}

/**
 * Compare every configured field. Return only rows where BOTH sides have a
 * real value AND the values differ. Fields where one side is empty are
 * auto-merged (the non-empty value wins) and never surfaced to the user.
 */
export function computeFieldConflicts(input: MergeInput): FieldConflict[] {
  const out: FieldConflict[] = [];
  for (const spec of FIELD_SPECS) {
    const cur = (input.current as any)[spec.key];
    const imp = (input.imported as any)[spec.key];
    if (isEmpty(cur) || isEmpty(imp)) continue;
    if (equalByKind(spec.kind, cur, imp)) continue;
    out.push({
      key: spec.key,
      label: spec.label,
      kind: spec.kind,
      currentValue: cur ?? null,
      importedValue: imp ?? null,
      defaultChoice: spec.defaultChoice,
      allowCustom: spec.allowCustom,
    });
  }
  return out;
}

/**
 * True when both amounts are real and diverge by more than `tolerance` of the
 * larger side. Used purely to render an informational banner in the modal —
 * not to change matching thresholds anywhere else.
 */
export function hasLargeAmountDiff(
  current: number | null | undefined,
  imported: number | null | undefined,
  tolerance = 0.10,
): boolean {
  const a = Math.abs(Number(current ?? 0));
  const b = Math.abs(Number(imported ?? 0));
  if (a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) > tolerance;
}

/**
 * Apply the user's per-field choices. Returns:
 *   - `appliedValues`: the value to persist for each resolved field, keyed
 *     by FieldKey. Callers decide which columns to actually write.
 *   - `fieldLocks`: the choice made per field, to be stored on the
 *     `transaction_links` row so future syncs respect it.
 *
 * Fields NOT present in `resolutions` are left out of both maps — the caller
 * should skip writing them (auto-merge already happened for identical /
 * one-sided values, and non-conflicting fields don't need a lock).
 */
export function applyResolutions(
  input: MergeInput,
  resolutions: ConflictResolution[],
): {
  appliedValues: Partial<Record<FieldKey, string | number | null>>;
  fieldLocks: Partial<Record<FieldKey, ConflictChoice>>;
} {
  const appliedValues: Partial<Record<FieldKey, string | number | null>> = {};
  const fieldLocks: Partial<Record<FieldKey, ConflictChoice>> = {};
  for (const r of resolutions) {
    let v: string | number | null;
    if (r.choice === "custom") {
      v = r.customValue ?? null;
    } else if (r.choice === "imported") {
      v = ((input.imported as any)[r.key] ?? null) as any;
    } else {
      v = ((input.current as any)[r.key] ?? null) as any;
    }
    appliedValues[r.key] = v;
    fieldLocks[r.key] = r.choice;
  }
  return { appliedValues, fieldLocks };
}

/**
 * Convenience: build default resolutions (one per conflict, using each
 * conflict's `defaultChoice`). Used when the caller wants to "just link"
 * without opening the modal but still wants field_locks written.
 */
export function defaultResolutions(conflicts: FieldConflict[]): ConflictResolution[] {
  return conflicts.map((c) => ({ key: c.key, choice: c.defaultChoice }));
}
