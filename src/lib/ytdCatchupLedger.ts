/**
 * YTD Catch-Up ledger dedupe helpers.
 *
 * CANONICAL MODEL:
 *   One ytd_catchup_entries row (the source of truth for tax math) is
 *   mirrored into exactly ONE row in the user-facing ledger:
 *     • personal (W-2 / other) → income_entries (linked_ytd_catchup_id)
 *     • business (1099 / K-1)  → transactions    (origin_ytd_catchup_id)
 *
 *   The mirror is the row the user sees in Personal Income / Business
 *   Activity. The catch-up entry is shown ONCE separately in the YTD
 *   Catch-Up card. A user therefore traces the same YTD contribution
 *   in exactly two places (canonical card + ledger mirror) — never twice
 *   in the same ledger.
 *
 *   The sync function (`syncCatchupMirror`) and a DB unique index defend
 *   the 1:1 invariant. These helpers are a final, deterministic UI-level
 *   guard so a transient duplicate from a failed sync, partial write,
 *   or replication lag can never render as two semantic income events.
 *
 *   Dedupe key: the parent catch-up id. When multiple rows share the
 *   same parent id, the earliest-created row wins (oldest origin), which
 *   matches `syncCatchupMirror`'s own ordering.
 */

interface YtdMirrorRow {
  id: string;
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
 * Dedupe business transaction ledger rows so each YTD catch-up parent
 * contributes at most one mirror tx. Non-YTD rows pass through unchanged.
 */
export function dedupeYtdBusinessMirrors<T extends YtdMirrorRow>(rows: readonly T[]): T[] {
  const byParent = new Map<string, T[]>();
  const passthrough: T[] = [];
  for (const r of rows) {
    const parent = r.origin_ytd_catchup_id || null;
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
