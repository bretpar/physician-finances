/**
 * YTD Catch-Up ledger dedupe helpers.
 *
 * CANONICAL MODEL:
 *   • personal (W-2 / other) catch-up → ONE row in income_entries per
 *     ytd_catchup_entries parent (linked_ytd_catchup_id).
 *   • business (1099 / K-1) catch-up → up to TWO rows in transactions
 *     per parent: one income mirror for gross revenue, and (when
 *     business_expenses > 0) one expense mirror for deductible YTD
 *     business expenses. Both share `origin_ytd_catchup_id` but differ
 *     on `transaction_type`.
 *
 *   Dedupe is a final UI-level guard against transient duplicates. It
 *   is scoped by:
 *     • personal:  parent catch-up id
 *     • business:  (parent catch-up id, transaction_type)
 *   so the income and expense mirrors of the same business catch-up
 *   are NEVER collapsed into a single row (which would hide YTD
 *   business expenses from Business Activity even though the canonical
 *   transaction exists in the database — the regression this scope
 *   fixes).
 *
 *   Within a dedupe key, the earliest-created row wins.
 */

interface YtdMirrorRow {
  id: string;
  transaction_type?: string | null;
  created_at?: string | null;
  linked_ytd_catchup_id?: string | null;
  origin_ytd_catchup_id?: string | null;
}

function pickEarliest<T extends YtdMirrorRow>(rows: T[]): T {
  // Stable: created_at ascending, then id ascending.
  return [...rows].sort((a, b) => {
    const ad = a.created_at || "";
    const bd = b.created_at || "";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  })[0];
}

/**
 * Dedupe personal income ledger entries so each YTD catch-up parent
 * contributes at most one mirror row. Non-YTD rows pass through unchanged.
 */
export function dedupeYtdPersonalMirrors<T extends YtdMirrorRow>(rows: readonly T[]): T[] {
  const byParent = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const r of rows) {
    const parent = r.linked_ytd_catchup_id || null;
    if (!parent) {
      passthrough.push(r);
      continue;
    }
    const list = byParent.get(parent) ?? [];
    list.push(r);
    byParent.set(parent, list);
  }
  const winners: T[] = [];
  for (const list of byParent.values()) {
    winners.push(pickEarliest(list));
  }
  // Preserve original order: walk rows once and emit each id at most once.
  const allowedIds = new Set<string>([...passthrough.map((r) => r.id), ...winners.map((r) => r.id)]);
  return rows.filter((r) => allowedIds.has(r.id));
}

/**
 * Dedupe business transaction ledger rows so each (catch-up parent,
 * transaction_type) pair contributes at most one mirror tx. The income
 * mirror (gross revenue) and expense mirror (deductible YTD business
 * expense) of the same parent both survive — they are semantically
 * distinct rows that Business Activity needs to render separately.
 * Non-YTD rows pass through unchanged.
 */
export function dedupeYtdBusinessMirrors<T extends YtdMirrorRow>(rows: readonly T[]): T[] {
  const byKey = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const r of rows) {
    const parent = r.origin_ytd_catchup_id || null;
    if (!parent) {
      passthrough.push(r);
      continue;
    }
    const txType = (r.transaction_type || "expense").toString();
    const key = `${parent}::${txType}`;
    const list = byKey.get(key) ?? [];
    list.push(r);
    byKey.set(key, list);
  }
  const winners: T[] = [];
  for (const list of byKey.values()) {
    winners.push(pickEarliest(list));
  }
  const allowedIds = new Set<string>([...passthrough.map((r) => r.id), ...winners.map((r) => r.id)]);
  return rows.filter((r) => allowedIds.has(r.id));
}


/**
 * Returns true iff the given personal income ledger row is a mirror of a
 * YTD catch-up entry (i.e. has a parent catch-up id). Use for badge/label
 * decisions and for asserting the row contributes 0 to tax math
 * (mirror rows are flagged `include_in_tax_estimate=false`).
 */
export function isYtdPersonalMirror(row: YtdMirrorRow): boolean {
  return !!row.linked_ytd_catchup_id;
}

/**
 * Returns true iff the given business transaction is a mirror of a YTD
 * catch-up entry.
 */
export function isYtdBusinessMirror(row: YtdMirrorRow & { origin_type?: string | null }): boolean {
  return row.origin_type === "ytd_catchup" || !!row.origin_ytd_catchup_id;
}
