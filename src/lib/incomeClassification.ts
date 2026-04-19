/**
 * Income Classification
 *
 * Resilient classifier for personal income_entries rows. Normalization
 * collapsed `income_type` to canonical values (w2 | 1099 | k1 | other),
 * but tax math needs finer-grained categories (W-2 vs ordinary vs cap
 * gains vs rental vs loss). This helper inspects multiple fields with
 * a fallback chain so old AND new rows classify correctly:
 *
 *   1. ui_income_subtype  (preserved original UI subtype)
 *   2. tax_category       ('capital_gains' | 'ordinary' | 'rental' | 'loss')
 *   3. income_type        (legacy or canonical)
 *   4. realized_gain_loss / cost_basis presence (implies cap-gain row)
 *   5. company / name hints (last-resort)
 *
 * Rows that cannot be confidently classified fall into "ordinary" so
 * they still contribute to taxable income instead of disappearing.
 */

export type PersonalCategory =
  | "w2"
  | "ordinary"
  | "capital_gains"
  | "rental"
  | "loss";

export interface ClassifiableRow {
  income_type?: string | null;
  ui_income_subtype?: string | null;
  tax_category?: string | null;
  realized_gain_loss?: number | null;
  cost_basis?: number | null;
  gross_amount?: number | null;
  company?: string | null;
  name?: string | null;
}

const W2_TOKENS = new Set([
  "w2",
  "w2_user",
  "w2_partner",
  "scorp_w2",
  "wages",
]);

const CAP_GAIN_TOKENS = new Set([
  "short_term_gain",
  "long_term_gain",
  "capital_gain",
  "capital_gains",
  "stock_sale",
]);

const RENTAL_TOKENS = new Set(["rental", "rental_income", "real_estate"]);
const LOSS_TOKENS = new Set(["loss", "capital_loss"]);
const ORDINARY_TOKENS = new Set([
  "dividend",
  "dividends",
  "interest",
  "other_income",
  "ordinary",
  "scorp_distribution",
  "royalty",
  "1099_misc",
  "1099_nec",
]);

function tokenCategory(raw: string | null | undefined): PersonalCategory | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (W2_TOKENS.has(v)) return "w2";
  if (CAP_GAIN_TOKENS.has(v)) return "capital_gains";
  if (RENTAL_TOKENS.has(v)) return "rental";
  if (LOSS_TOKENS.has(v)) return "loss";
  if (ORDINARY_TOKENS.has(v)) return "ordinary";
  return null;
}

function categoryFromTaxCategory(
  raw: string | null | undefined,
): PersonalCategory | null {
  if (!raw) return null;
  const v = raw.toLowerCase().trim();
  if (v === "capital_gains" || v === "capital_gain") return "capital_gains";
  if (v === "rental") return "rental";
  if (v === "loss") return "loss";
  if (v === "w2" || v === "wages") return "w2";
  if (v === "ordinary") return "ordinary";
  return null;
}

/**
 * Classify a personal income row into a tax category.
 * Never returns null — falls back to "ordinary" so the row still counts.
 */
export function classifyPersonalIncome(row: ClassifiableRow): PersonalCategory {
  // 1. Original UI subtype (most specific)
  const fromSubtype = tokenCategory(row.ui_income_subtype);
  if (fromSubtype) return fromSubtype;

  // 2. Explicit tax_category column
  const fromTaxCat = categoryFromTaxCategory(row.tax_category);
  if (fromTaxCat) return fromTaxCat;

  // 3. income_type — only use if it's something specific. Canonical "other"
  // is too vague to trust on its own; fall through to heuristics.
  const fromIncomeType = tokenCategory(row.income_type);
  if (fromIncomeType) return fromIncomeType;

  // 4. Heuristic: a row with cost_basis or non-null realized_gain_loss is a
  // capital-gains/loss row (stock sale style).
  const hasCapHints =
    (row.cost_basis !== null && row.cost_basis !== undefined) ||
    (row.realized_gain_loss !== null && row.realized_gain_loss !== undefined);
  if (hasCapHints) {
    const gl = Number(row.realized_gain_loss ?? 0);
    if (gl < 0) return "loss";
    return "capital_gains";
  }

  // 5. Negative gross with no other hints → treat as a loss
  const gross = Number(row.gross_amount ?? 0);
  if (gross < 0) return "loss";

  // Default: ordinary income (do NOT drop the row)
  return "ordinary";
}

/** Convenience: aggregate gross_amount by classified category. */
export function aggregateByCategory(
  rows: ClassifiableRow[],
): Record<PersonalCategory, number> {
  const out: Record<PersonalCategory, number> = {
    w2: 0,
    ordinary: 0,
    capital_gains: 0,
    rental: 0,
    loss: 0,
  };
  for (const r of rows) {
    const cat = classifyPersonalIncome(r);
    const amt = Number(r.gross_amount ?? 0);
    if (cat === "loss") {
      out.loss += Math.abs(amt);
    } else {
      out[cat] += amt;
    }
  }
  return out;
}
