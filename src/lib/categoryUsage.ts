/**
 * Derive per-user expense category usage from existing saved expense
 * transactions (no new tables). Used to order the expense category selector:
 *   1. most frequently used
 *   2. most recently used (tie-break)
 *   3. remaining categories in the standard catalog order
 */

export interface CategoryUsageRow {
  category: string | null;
  transaction_date?: string | null;
}

export interface CategoryUsage {
  /** category label -> { count, lastUsed (ms epoch) } */
  stats: Record<string, { count: number; lastUsed: number }>;
}

/** Aggregate usage counts / recency from expense rows. */
export function computeCategoryUsage(rows: CategoryUsageRow[]): CategoryUsage {
  const stats: CategoryUsage["stats"] = {};
  for (const row of rows) {
    const cat = (row.category || "").trim();
    if (!cat || cat === "Uncategorized") continue;
    const ts = row.transaction_date ? Date.parse(row.transaction_date) : NaN;
    const entry = stats[cat] || { count: 0, lastUsed: 0 };
    entry.count += 1;
    if (!Number.isNaN(ts)) entry.lastUsed = Math.max(entry.lastUsed, ts);
    stats[cat] = entry;
  }
  return { stats };
}

/**
 * Sort `categories` (the canonical catalog) by usage, preserving catalog order
 * for anything unused. Never returns duplicates, and never returns a category
 * that isn't in `categories` (archived/unavailable ones are dropped).
 */
export function sortCategoriesByUsage(
  categories: string[],
  usage: CategoryUsage | null | undefined,
): string[] {
  const stats = usage?.stats;
  if (!stats || Object.keys(stats).length === 0) return [...categories];
  return [...categories].sort((a, b) => {
    const ua = stats[a];
    const ub = stats[b];
    if (ua && ub) {
      if (ub.count !== ua.count) return ub.count - ua.count;
      if (ub.lastUsed !== ua.lastUsed) return ub.lastUsed - ua.lastUsed;
      return categories.indexOf(a) - categories.indexOf(b);
    }
    if (ua) return -1;
    if (ub) return 1;
    return categories.indexOf(a) - categories.indexOf(b);
  });
}

/**
 * "Frequently used" shortlist — only surfaced when the user has meaningful
 * history (>= 2 distinct used categories). Max 5 entries.
 */
export function frequentlyUsedCategories(
  categories: string[],
  usage: CategoryUsage | null | undefined,
  limit = 5,
): string[] {
  const stats = usage?.stats;
  if (!stats) return [];
  const used = categories.filter((c) => stats[c]?.count);
  if (used.length < 2) return [];
  return sortCategoriesByUsage(used, usage).slice(0, limit);
}
